//! Handoff (M4): a digest of an agent conversation, pasted into another pane.
//! Built from the agent's own session file, read only – same files as `context.rs`.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::context::{find_session, read_last, valid_id, Kind};

/// More than the meters read: a handoff wants a few whole turns, not just the last usage.
const TAIL_BYTES: u64 = 1024 * 1024;
const MAX_PROMPTS: usize = 5;
const PROMPT_CHARS: usize = 800;
const MAX_REPLIES: usize = 3;
const REPLY_CHARS: usize = 1500;
const MAX_FILES: usize = 20;
const MAX_COMMANDS: usize = 5;
const COMMAND_CHARS: usize = 120;

#[derive(Debug, Default, Serialize, PartialEq)]
pub struct Handoff {
    /// Newest user prompts, oldest first.
    prompts: Vec<String>,
    /// Newest assistant texts (one per turn line), oldest first.
    replies: Vec<String>,
    /// Paths written or edited, newest first, no repeats.
    files: Vec<String>,
    /// Newest shell commands, one line each, oldest first.
    commands: Vec<String>,
}

/// Cut on a char boundary (Polish letters are 2 bytes) and mark the cut.
fn cut(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let mut out: String = text.chars().take(max - 1).collect();
    out.truncate(out.trim_end().len());
    out.push('…');
    out
}

fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn str_at<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

/// Tool names and argument keys that write files / run commands.
fn tool_effect(kind: Kind, block: &Value) -> (Option<String>, Option<String>) {
    let (block_type, args_key) = match kind {
        Kind::Claude => ("tool_use", "input"),
        Kind::Pi => ("toolCall", "arguments"),
    };
    if str_at(block, "type") != Some(block_type) {
        return (None, None);
    }
    let name = str_at(block, "name").unwrap_or("");
    let args = block.get(args_key).unwrap_or(&Value::Null);
    let file = match (kind, name) {
        (Kind::Claude, "Edit" | "Write" | "MultiEdit") => str_at(args, "file_path"),
        (Kind::Claude, "NotebookEdit") => str_at(args, "notebook_path"),
        (Kind::Pi, "edit" | "write") => str_at(args, "path"),
        _ => None,
    };
    let command = match (kind, name) {
        (Kind::Claude, "Bash") | (Kind::Pi, "bash") => str_at(args, "command"),
        _ => None,
    };
    (file.map(str::to_owned), command.map(|c| cut(&one_line(c), COMMAND_CHARS)))
}

fn digest(text: &str, kind: Kind) -> Handoff {
    let (mut prompts, mut replies, mut files, mut commands) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for line in text.lines() {
        let Ok(entry) = serde_json::from_str::<Value>(line) else { continue };
        let flag = |key| entry.get(key).and_then(Value::as_bool) == Some(true);
        // Subagent turns and injected meta lines are not the conversation the user had.
        if flag("isSidechain") || flag("isMeta") {
            continue;
        }
        let Some(message) = entry.get("message") else { continue };
        let blocks: Vec<&Value> = match message.get("content") {
            Some(Value::Array(b)) => b.iter().collect(),
            _ => Vec::new(),
        };
        let texts: Vec<&str> = match message.get("content") {
            Some(Value::String(s)) => vec![s.as_str()],
            _ => blocks.iter().filter(|b| str_at(b, "type") == Some("text")).filter_map(|b| str_at(b, "text")).collect(),
        };
        match str_at(message, "role") {
            Some("user") => {
                let Some(first) = texts.first().map(|t| t.trim()) else { continue };
                // claude: command output and reminders arrive as user lines starting with a tag.
                if first.is_empty() || (kind == Kind::Claude && first.starts_with('<')) {
                    continue;
                }
                prompts.push(cut(first, PROMPT_CHARS));
            }
            Some("assistant") => {
                let reply = texts.join("\n\n");
                if !reply.trim().is_empty() {
                    replies.push(cut(&reply, REPLY_CHARS));
                }
                for block in &blocks {
                    let (file, command) = tool_effect(kind, block);
                    files.extend(file);
                    commands.extend(command);
                }
            }
            _ => {}
        }
    }
    let newest = |v: Vec<String>, n: usize| v[v.len().saturating_sub(n)..].to_vec();
    let mut seen = std::collections::HashSet::new();
    let files = files.into_iter().rev().filter(|f| seen.insert(f.clone())).take(MAX_FILES).collect();
    Handoff {
        prompts: newest(prompts, MAX_PROMPTS),
        replies: newest(replies, MAX_REPLIES),
        files,
        commands: newest(commands, MAX_COMMANDS),
    }
}

fn handoff_in(root: &Path, kind: Kind, id: &str) -> Option<Handoff> {
    if !valid_id(id) {
        return None;
    }
    let tail = read_last(&find_session(root, kind, id)?, TAIL_BYTES)?;
    let h = digest(&tail, kind);
    (h != Handoff::default()).then_some(h)
}

/// `None` when the kind is unknown, the file does not exist, or the conversation is empty.
#[tauri::command]
pub async fn session_handoff(kind: String, session_id: String) -> Option<Handoff> {
    let home = PathBuf::from(std::env::var_os("HOME")?);
    match kind.as_str() {
        "claude" => handoff_in(&home.join(".claude/projects"), Kind::Claude, &session_id),
        "pi" => handoff_in(&home.join(".pi/agent/sessions"), Kind::Pi, &session_id),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    const ID: &str = "3948700d-cd47-43c0-be0d-1db71d5d5e09";

    fn lines(v: &[Value]) -> String {
        v.iter().map(Value::to_string).collect::<Vec<_>>().join("\n")
    }

    fn claude_user(text: &str) -> Value {
        json!({"type":"user","message":{"role":"user","content":text}})
    }

    fn claude_assistant(content: Value) -> Value {
        json!({"type":"assistant","message":{"role":"assistant","content":content}})
    }

    #[test]
    fn claude_prompts_replies_files_and_commands() {
        let text = lines(&[
            claude_user("napraw testy"),
            claude_user("<command-name>/model</command-name>"),
            json!({"type":"user","isMeta":true,"message":{"role":"user","content":"caveat"}}),
            claude_assistant(json!([{"type":"text","text":"Patrzę."},
                {"type":"tool_use","id":"1","name":"Edit","input":{"file_path":"/p/a.ts"}},
                {"type":"tool_use","id":"2","name":"Read","input":{"file_path":"/p/read-only.ts"}}])),
            json!({"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"1","content":"ok"}]}}),
            claude_assistant(json!([{"type":"tool_use","id":"3","name":"Bash","input":{"command":"pnpm   test\n --run"}}])),
            json!({"type":"assistant","isSidechain":true,"message":{"role":"assistant","content":[{"type":"text","text":"subagent"}]}}),
            claude_assistant(json!([{"type":"tool_use","id":"4","name":"Write","input":{"file_path":"/p/b.ts"}},
                {"type":"tool_use","id":"5","name":"Edit","input":{"file_path":"/p/a.ts"}}])),
            json!({"type":"user","message":{"role":"user","content":[{"type":"text","text":"a teraz lint"},{"type":"image"}]}}),
            claude_assistant(json!([{"type":"text","text":"Gotowe."}])),
            "not json".into(),
        ]);
        let h = digest(&text, Kind::Claude);
        assert_eq!(h.prompts, ["napraw testy", "a teraz lint"]);
        assert_eq!(h.replies, ["Patrzę.", "Gotowe."]);
        assert_eq!(h.files, ["/p/a.ts", "/p/b.ts"]); // newest first, no repeat, Read is not a change
        assert_eq!(h.commands, ["pnpm test --run"]);
    }

    #[test]
    fn pi_messages_and_tool_calls() {
        let text = lines(&[
            json!({"type":"session","id":ID}),
            json!({"type":"message","message":{"role":"user","content":[{"type":"text","text":"dodaj eksport"}]}}),
            json!({"type":"message","message":{"role":"assistant","content":[
                {"type":"text","text":"Dodaję."},
                {"type":"toolCall","id":"c1","name":"write","arguments":{"path":"src/x.ts"}},
                {"type":"toolCall","id":"c2","name":"bash","arguments":{"command":"pnpm build"}}]}}),
            json!({"type":"message","message":{"role":"toolResult","content":[{"type":"text","text":"built"}]}}),
        ]);
        let h = digest(&text, Kind::Pi);
        assert_eq!(h.prompts, ["dodaj eksport"]);
        assert_eq!(h.replies, ["Dodaję."]);
        assert_eq!((h.files.as_slice(), h.commands.as_slice()), (&["src/x.ts".to_owned()][..], &["pnpm build".to_owned()][..]));
    }

    #[test]
    fn keeps_only_the_newest_and_cuts_on_a_char_boundary() {
        let mut v: Vec<Value> = (0..8).map(|i| claude_user(&format!("prompt {i}"))).collect();
        v.push(claude_user(&"ż".repeat(PROMPT_CHARS + 50)));
        for i in 0..MAX_COMMANDS + 3 {
            v.push(claude_assistant(json!([{"type":"tool_use","id":i.to_string(),"name":"Bash","input":{"command":format!("cmd {i}")}}])));
        }
        let h = digest(&lines(&v), Kind::Claude);
        assert_eq!(h.prompts.len(), MAX_PROMPTS);
        assert_eq!(h.prompts[0], "prompt 4");
        let last = h.prompts.last().unwrap();
        assert_eq!(last.chars().count(), PROMPT_CHARS);
        assert!(last.ends_with("ż…"));
        assert_eq!(h.commands.first().map(String::as_str), Some("cmd 3"));
        assert_eq!(h.commands.len(), MAX_COMMANDS);
    }

    #[test]
    fn finds_the_file_and_rejects_empty_or_bad_ids() {
        let root = std::env::temp_dir().join(format!("aw-handoff-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("-home-x")).unwrap();
        fs::write(root.join("-home-x").join(format!("{ID}.jsonl")), lines(&[claude_user("hej")])).unwrap();
        assert_eq!(handoff_in(&root, Kind::Claude, ID).unwrap().prompts, ["hej"]);
        fs::write(root.join("-home-x").join(format!("{ID}.jsonl")), lines(&[claude_user("<x>")])).unwrap();
        assert_eq!(handoff_in(&root, Kind::Claude, ID), None);
        assert_eq!(handoff_in(&root, Kind::Claude, "../x"), None);
        fs::remove_dir_all(&root).unwrap();
    }
}
