//! Config files in `app_config_dir()` (`~/.config/dev.majke.agents/`).
//! Rust only stores raw text; the TS side (`src/agents.ts`) parses it.

use std::fs;
use std::path::Path;

use tauri::Manager;

const AGENTS_FILE: &str = "agents.json";
const WORKSPACE_FILE: &str = "workspace.json";

/// Same list as `DEFAULT_AGENTS` in `src/agents.ts`; kept in sync by hand, tested against drift by review.
pub fn default_agents_json() -> String {
    let value: serde_json::Value = serde_json::json!({
        "agents": [
            {
                "id": "claude", "name": "Claude", "command": "claude",
                "session": {
                    "new": ["--session-id", "{session}"],
                    "resume": ["--resume", "{session}"],
                    "check": "claude"
                }
            },
            {
                "id": "pi", "name": "pi", "command": "pi",
                "session": {
                    "new": ["--session-id", "{session}"],
                    "resume": ["--session-id", "{session}"]
                }
            },
            { "id": "shell", "name": "Terminal", "command": "$SHELL" }
        ]
    });
    serde_json::to_string_pretty(&value).unwrap()
}

/// Write via `<file>.tmp` + rename, so a crash never leaves a half-written config.
pub fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let name = path.file_name().ok_or("config path has no file name")?;
    let tmp = path.with_file_name(format!("{}.tmp", name.to_string_lossy()));
    fs::write(&tmp, contents).map_err(|e| format!("{}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Raw text of `agents.json`; a missing file is created with the defaults. A broken file is returned as-is, never overwritten.
#[tauri::command]
pub fn agents_load(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(AGENTS_FILE);
    match fs::read_to_string(&file) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let text = default_agents_json();
            write_atomic(&file, &text)?;
            Ok(text)
        }
        Err(e) => Err(format!("{}: {e}", file.display())),
    }
}

/// Claude stores each conversation as `~/.claude/projects/<encoded path>/<uuid>.jsonl`.
/// Only `[0-9a-f-]` ids pass, so `../x`-style ids can never escape the search.
fn session_exists_in(root: &Path, id: &str) -> bool {
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b) || b == b'-') {
        return false;
    }
    let Ok(entries) = fs::read_dir(root) else { return false };
    entries.flatten().any(|entry| entry.path().join(format!("{id}.jsonl")).is_file())
}

#[tauri::command]
pub fn claude_session_exists(id: String) -> bool {
    let Some(home) = std::env::var_os("HOME") else { return false };
    session_exists_in(Path::new(&home).join(".claude/projects").as_path(), &id)
}

#[tauri::command]
pub fn dir_exists(path: String) -> bool {
    Path::new(&crate::pty::expand(&path)).is_dir()
}

/// Home directory, so TS can store paths as `~/...` (see `tildify` in `src/paths.ts`).
#[tauri::command]
pub fn home_dir() -> Result<String, String> {
    std::env::var("HOME").map_err(|_| "HOME is not set".to_string())
}

/// Raw text of `workspace.json`; `None` when the app starts for the first time.
#[tauri::command]
pub fn workspace_load(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    match fs::read_to_string(dir.join(WORKSPACE_FILE)) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", dir.join(WORKSPACE_FILE).display())),
    }
}

#[tauri::command]
pub fn workspace_save(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(WORKSPACE_FILE), &json)
}

/// Copy `workspace.json` to `workspace.<date>.bak` next to it; never overwrites an
/// existing backup, and a missing source is nothing to back up. `date` is `YYYY-MM-DD`
/// from TS (no date crate); anything else is rejected so it cannot become a path.
#[tauri::command]
pub fn workspace_backup(app: tauri::AppHandle, date: String) -> Result<(), String> {
    if date.len() != 10 || !date.bytes().all(|b| b.is_ascii_digit() || b == b'-') {
        return Err(format!("bad backup date {date:?}"));
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    backup_in(&dir, &date)
}

fn backup_in(dir: &Path, date: &str) -> Result<(), String> {
    let src = dir.join(WORKSPACE_FILE);
    let dst = dir.join(format!("workspace.{date}.bak"));
    if dst.exists() {
        return Ok(());
    }
    match fs::copy(&src, &dst) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{} -> {}: {e}", src.display(), dst.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fresh temp dir per test, removed at the end of the block.
    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("aw-config-{tag}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_a_session_in_any_project_dir() {
        let root = temp_dir("sessions");
        let id = "3f2a1b0c-0000-4000-8000-000000000001";
        fs::create_dir_all(root.join("some-project")).unwrap();
        fs::write(root.join("some-project").join(format!("{id}.jsonl")), "{}\n").unwrap();
        assert!(session_exists_in(&root, id));
        assert!(!session_exists_in(&root, "00000000-0000-4000-8000-000000000000"));
        assert!(!session_exists_in(&root.join("nope"), id));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn rejects_ids_that_are_not_uuids() {
        let root = temp_dir("traversal");
        fs::create_dir_all(root.join("project")).unwrap();
        fs::write(root.join("x.jsonl"), "not a session").unwrap();
        fs::write(root.join("project").join("x.jsonl"), "not a session").unwrap();
        for id in ["../x", "x/../../x", "x.server.com", "ABCDEF", "", "x;rm"] {
            assert!(!session_exists_in(&root, id), "accepted id {id:?}");
        }
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn write_atomic_replaces_and_leaves_no_temp_file() {
        let dir = temp_dir("atomic");
        let file = dir.join(AGENTS_FILE);
        write_atomic(&file, "first").unwrap();
        write_atomic(&file, "second").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "second");
        let leftovers: Vec<_> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(leftovers, vec![std::ffi::OsString::from(AGENTS_FILE)]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn backup_copies_once_and_tolerates_missing_source() {
        let dir = temp_dir("backup");
        // No workspace.json yet: nothing to back up, no error, no empty .bak.
        backup_in(&dir, "2026-09-30").unwrap();
        assert!(!dir.join("workspace.2026-09-30.bak").exists());
        fs::write(dir.join(WORKSPACE_FILE), "one").unwrap();
        backup_in(&dir, "2026-09-30").unwrap();
        assert_eq!(fs::read_to_string(dir.join("workspace.2026-09-30.bak")).unwrap(), "one");
        // An existing backup is never overwritten.
        fs::write(dir.join(WORKSPACE_FILE), "two").unwrap();
        backup_in(&dir, "2026-09-30").unwrap();
        assert_eq!(fs::read_to_string(dir.join("workspace.2026-09-30.bak")).unwrap(), "one");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn default_json_is_valid_and_parses_with_agents() {
        let parsed: serde_json::Value = serde_json::from_str(&default_agents_json()).unwrap();
        let agents = parsed["agents"].as_array().unwrap();
        assert_eq!(agents.len(), 3);
        assert_eq!(agents[0]["id"], "claude");
        assert_eq!(agents[2]["command"], "$SHELL");
    }
}
