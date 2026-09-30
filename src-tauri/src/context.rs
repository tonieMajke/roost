//! Context size of an agent conversation, read from the agent's own session file.
//! Read only: nothing is ever written under `~/.claude` or `~/.pi`.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::Serialize;
use serde_json::Value;

/// Only the tail is read: the newest usage is at the end, and session files grow to many MB.
const TAIL_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq)]
enum Kind {
    Claude,
    Pi,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct SessionContext {
    tokens: u64,
    model: Option<String>,
    /// Window of that model when the agent's own config names it (pi); claude: from the model name in TS.
    window: Option<u64>,
    #[serde(skip)]
    provider: Option<String>,
}

/// Session ids are UUIDs; anything else could escape the search (`../x`).
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b) || b == b'-')
}

/// claude: `<root>/<encoded cwd>/<id>.jsonl`; pi: `<root>/<encoded cwd>/<timestamp>_<id>.jsonl`.
fn find_session(root: &Path, kind: Kind, id: &str) -> Option<PathBuf> {
    for dir in fs::read_dir(root).ok()?.flatten() {
        let dir = dir.path();
        match kind {
            Kind::Claude => {
                let file = dir.join(format!("{id}.jsonl"));
                if file.is_file() {
                    return Some(file);
                }
            }
            Kind::Pi => {
                let suffix = format!("_{id}.jsonl");
                let Ok(files) = fs::read_dir(&dir) else { continue };
                for f in files.flatten() {
                    if f.file_name().to_str().is_some_and(|n| n.ends_with(&suffix)) {
                        return Some(f.path());
                    }
                }
            }
        }
    }
    None
}

fn read_tail(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::with_capacity((len - start) as usize);
    file.read_to_end(&mut buf).ok()?;
    let mut text = String::from_utf8_lossy(&buf).into_owned();
    if start > 0 {
        // The seek landed mid-line: that fragment is not JSON.
        text = text.split_once('\n').map(|(_, rest)| rest.to_owned()).unwrap_or_default();
    }
    Some(text)
}

fn num(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(Value::as_u64).unwrap_or(0)
}

/// Newest line with `message.usage`, summed into the size of the context the model saw.
fn last_usage(text: &str, kind: Kind) -> Option<SessionContext> {
    for line in text.lines().rev() {
        if !line.contains("\"usage\"") {
            continue; // cheap skip: most lines are tool output
        }
        let Ok(entry) = serde_json::from_str::<Value>(line) else { continue };
        // Claude subagent turns have their own, smaller context.
        if entry.get("isSidechain").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let Some(message) = entry.get("message") else { continue };
        let Some(usage) = message.get("usage") else { continue };
        let tokens = match kind {
            Kind::Claude => {
                num(usage, "input_tokens") + num(usage, "cache_read_input_tokens") + num(usage, "cache_creation_input_tokens")
            }
            Kind::Pi => num(usage, "input") + num(usage, "cacheRead") + num(usage, "cacheWrite"),
        };
        // Aborted or synthetic turns report zeros; they say nothing about the context.
        if tokens == 0 {
            continue;
        }
        let text = |key| message.get(key).and_then(Value::as_str).map(str::to_owned);
        return Some(SessionContext { tokens, model: text("model"), window: None, provider: text("provider") });
    }
    None
}

fn context_in(root: &Path, kind: Kind, id: &str) -> Option<SessionContext> {
    if !valid_id(id) {
        return None;
    }
    // Found paths are kept: pi needs a directory scan per lookup, and the UI asks every 5 s.
    static FOUND: Mutex<Option<HashMap<PathBuf, PathBuf>>> = Mutex::new(None);
    let key = root.join(id);
    let cached = FOUND.lock().ok()?.as_ref().and_then(|m| m.get(&key).cloned());
    let path = match cached.filter(|p| p.is_file()) {
        Some(p) => p,
        None => {
            let p = find_session(root, kind, id)?;
            FOUND.lock().ok()?.get_or_insert_with(HashMap::new).insert(key, p.clone());
            p
        }
    };
    last_usage(&read_tail(&path)?, kind)
}

/// `contextWindow` of every model pi knows: own `models.json` (`providers.<p>.models[]`) and
/// the fetched catalog `models-store.json` (`<p>.models[]`). Keyed by `(provider, id)`.
fn pi_windows(files: &[(&Path, bool)]) -> HashMap<(String, String), u64> {
    let mut out = HashMap::new();
    for &(file, nested) in files {
        let Ok(text) = fs::read_to_string(file) else { continue };
        let Ok(root) = serde_json::from_str::<Value>(&text) else { continue };
        let providers = if nested { root.get("providers") } else { Some(&root) };
        let Some(providers) = providers.and_then(Value::as_object) else { continue };
        for (provider, entry) in providers {
            for model in entry.get("models").and_then(Value::as_array).into_iter().flatten() {
                let (Some(id), Some(window)) = (model.get("id").and_then(Value::as_str), model.get("contextWindow").and_then(Value::as_u64)) else {
                    continue;
                };
                // Own models.json comes first and wins over the catalog.
                out.entry((provider.clone(), id.to_owned())).or_insert(window);
            }
        }
    }
    out
}

/// Window of a pi model; the provider narrows the match, the bare id is the fallback.
fn pi_window(agent_dir: &Path, provider: Option<&str>, model: &str) -> Option<u64> {
    type Cache = (Vec<Option<SystemTime>>, HashMap<(String, String), u64>);
    // Parsed once per file change: the catalog is ~0.5 MB and the UI asks every 5 s.
    static CACHE: Mutex<Option<(PathBuf, Cache)>> = Mutex::new(None);
    let own = agent_dir.join("models.json");
    let store = agent_dir.join("models-store.json");
    let stamps: Vec<_> = [&own, &store].iter().map(|f| fs::metadata(f).and_then(|m| m.modified()).ok()).collect();
    let mut cache = CACHE.lock().ok()?;
    let fresh = matches!(&*cache, Some((dir, (s, _))) if dir == agent_dir && *s == stamps);
    if !fresh {
        let windows = pi_windows(&[(&own, true), (&store, false)]);
        *cache = Some((agent_dir.to_owned(), (stamps, windows)));
    }
    let windows = &cache.as_ref()?.1 .1;
    if let Some(w) = provider.and_then(|p| windows.get(&(p.to_owned(), model.to_owned()))) {
        return Some(*w);
    }
    windows.iter().find(|((_, id), _)| id == model).map(|(_, w)| *w)
}

/// `None` when the kind is unknown, the file does not exist yet, or no turn has usage.
#[tauri::command]
pub async fn session_context(kind: String, session_id: String) -> Option<SessionContext> {
    let home = PathBuf::from(std::env::var_os("HOME")?);
    if kind == "claude" {
        return context_in(&home.join(".claude/projects"), Kind::Claude, &session_id);
    }
    if kind != "pi" {
        return None;
    }
    let agent_dir = home.join(".pi/agent");
    let mut ctx = context_in(&agent_dir.join("sessions"), Kind::Pi, &session_id)?;
    if let Some(model) = &ctx.model {
        ctx.window = pi_window(&agent_dir, ctx.provider.as_deref(), model);
    }
    Some(ctx)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "3948700d-cd47-43c0-be0d-1db71d5d5e09";

    /// Fresh temp dir per test; never the real `~/.claude` or `~/.pi`.
    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aw-context-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn claude_line(input: u64, read: u64, create: u64) -> String {
        format!(
            r#"{{"type":"assistant","isSidechain":false,"message":{{"model":"claude-opus-5-5","usage":{{"input_tokens":{input},"cache_read_input_tokens":{read},"cache_creation_input_tokens":{create},"output_tokens":99}}}}}}"#
        )
    }

    fn pi_line(input: u64, read: u64, write: u64) -> String {
        format!(
            r#"{{"type":"message","message":{{"role":"assistant","provider":"local","model":"gpt-5","usage":{{"input":{input},"output":7,"cacheRead":{read},"cacheWrite":{write},"totalTokens":1}}}}}}"#
        )
    }

    #[test]
    fn claude_sums_the_newest_usage() {
        let root = temp_dir("claude");
        fs::create_dir_all(root.join("-home-x")).unwrap();
        let text = [
            claude_line(1, 2, 3),
            r#"{"type":"user","message":{"content":"hi"}}"#.to_owned(),
            claude_line(10, 20_000, 300),
            r#"{"type":"user","message":{"content":"tool result"}}"#.to_owned(),
        ]
        .join("\n");
        fs::write(root.join("-home-x").join(format!("{ID}.jsonl")), text).unwrap();
        let got = context_in(&root, Kind::Claude, ID).unwrap();
        assert_eq!((got.tokens, got.model.as_deref()), (20_310, Some("claude-opus-5-5")));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn pi_file_is_found_by_the_id_after_the_timestamp() {
        let root = temp_dir("pi");
        let dir = root.join("--home-x--");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("2026-09-30T17-29-04-910Z_other.jsonl"), pi_line(9, 9, 9)).unwrap();
        fs::write(dir.join(format!("2026-09-30T17-29-04-910Z_{ID}.jsonl")), pi_line(100, 2_000, 30)).unwrap();
        let got = context_in(&root, Kind::Pi, ID).unwrap();
        assert_eq!((got.tokens, got.model.as_deref(), got.provider.as_deref()), (2_130, Some("gpt-5"), Some("local")));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn skips_sidechain_zero_and_broken_lines() {
        let side = r#"{"isSidechain":true,"message":{"usage":{"input_tokens":5}}}"#;
        let zero = claude_line(0, 0, 0);
        let text = [claude_line(1, 1, 1), side.to_owned(), zero, "{\"usage\": broken".to_owned()].join("\n");
        assert_eq!(last_usage(&text, Kind::Claude).unwrap().tokens, 3);
        assert_eq!(last_usage("no usage here", Kind::Claude), None);
    }

    #[test]
    fn reads_only_the_tail_and_drops_the_cut_line() {
        let root = temp_dir("tail");
        let file = root.join("s.jsonl");
        // Usage only at the start, then more than TAIL_BYTES of other lines: out of reach.
        let filler = format!("{{\"type\":\"user\",\"text\":\"{}\"}}\n", "x".repeat(1000));
        let mut text = claude_line(1, 1, 1) + "\n";
        while (text.len() as u64) < TAIL_BYTES + 5000 {
            text.push_str(&filler);
        }
        fs::write(&file, &text).unwrap();
        let tail = read_tail(&file).unwrap();
        assert!(tail.len() as u64 <= TAIL_BYTES);
        assert!(tail.starts_with("{\"type\":\"user\""), "cut first line must be dropped");
        assert_eq!(last_usage(&tail, Kind::Claude), None);
        // A newer usage at the end is found.
        text.push_str(&claude_line(5, 5, 5));
        fs::write(&file, &text).unwrap();
        assert_eq!(last_usage(&read_tail(&file).unwrap(), Kind::Claude).unwrap().tokens, 15);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn pi_window_prefers_own_models_json_and_the_provider() {
        let dir = temp_dir("piwin");
        let own = r#"{"providers":{"local":{"apiKey":"x","models":[{"id":"Flash","contextWindow":262144}]}}}"#;
        let store = r#"{"local":{"models":[{"id":"Flash","contextWindow":1000}]},
            "openrouter":{"models":[{"id":"Flash","contextWindow":64000},{"id":"big","contextWindow":1000000}]}}"#;
        fs::write(dir.join("models.json"), own).unwrap();
        fs::write(dir.join("models-store.json"), store).unwrap();
        assert_eq!(pi_window(&dir, Some("local"), "Flash"), Some(262_144));
        assert_eq!(pi_window(&dir, Some("openrouter"), "Flash"), Some(64_000));
        assert_eq!(pi_window(&dir, Some("gone"), "big"), Some(1_000_000));
        assert_eq!(pi_window(&dir, None, "nope"), None);
        // An edited models.json is read again.
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(dir.join("models.json"), own.replace("262144", "131072")).unwrap();
        assert_eq!(pi_window(&dir, Some("local"), "Flash"), Some(131_072));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_ids_that_are_not_uuids() {
        let root = temp_dir("ids");
        fs::write(root.join("..jsonl"), claude_line(1, 1, 1)).unwrap();
        for id in ["", "..", "../x", "a/b", "ABC"] {
            assert_eq!(context_in(&root, Kind::Claude, id), None, "accepted id {id:?}");
        }
        assert_eq!(context_in(&root, Kind::Claude, ID), None);
        fs::remove_dir_all(&root).unwrap();
    }
}
