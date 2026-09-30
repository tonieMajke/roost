//! Claude subscription limits („Limity Claude” in the dock), from Claude Code's own status line
//! input (`rate_limits`). Claude panes get `--settings` with a `statusLine` whose command is this
//! binary in helper mode; it keeps only `rate_limits` in the app config dir. No token, no network,
//! nothing written under `~/.claude`.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

/// First argument that turns the binary into the status line helper.
const HELPER_FLAG: &str = "--aw-statusline";
const LIMITS_FILE: &str = "claude-limits.json";
/// Status line input is a few KB; anything bigger is not what we expect.
const MAX_INPUT: u64 = 1024 * 1024;

#[derive(Debug, Serialize, Deserialize, PartialEq, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    /// 0–100 (may pass 100 once exceeded).
    pct: f64,
    /// Unix seconds.
    resets_at: u64,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeLimits {
    five_hour: Option<Window>,
    seven_day: Option<Window>,
    /// Unix seconds of the status line update that carried them.
    at: u64,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn window(v: Option<&Value>) -> Option<Window> {
    let v = v?;
    Some(Window { pct: v.get("used_percentage")?.as_f64()?, resets_at: v.get("resets_at")?.as_f64()? as u64 })
}

/// `rate_limits` of one status line input; `None` = not a subscriber, or no API response yet.
fn parse_status(input: &str, at: u64) -> Option<ClaudeLimits> {
    let root: Value = serde_json::from_str(input).ok()?;
    let rl = root.get("rate_limits")?;
    let limits = ClaudeLimits { five_hour: window(rl.get("five_hour")), seven_day: window(rl.get("seven_day")), at };
    (limits.five_hour.is_some() || limits.seven_day.is_some()).then_some(limits)
}

/// Several claude panes run the helper at once: own temp name, then an atomic rename.
fn store(path: &Path, limits: &ClaudeLimits) -> std::io::Result<()> {
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&tmp, serde_json::to_vec(limits)?)?;
    fs::rename(&tmp, path)
}

/// Helper mode (`<exe> --aw-statusline <file>`): read the status line input from stdin, keep the
/// limits. Prints nothing (empty status line) and always exits 0: claude must never see an error.
/// Returns `None` when the binary was started normally.
pub fn statusline_helper() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    if args.next()? != HELPER_FLAG {
        return None;
    }
    let Some(path) = args.next().map(PathBuf::from) else { return Some(0) };
    let mut input = String::new();
    if std::io::stdin().take(MAX_INPUT).read_to_string(&mut input).is_ok() {
        if let Some(limits) = parse_status(&input, now_secs()) {
            let _ = store(&path, &limits);
        }
    }
    Some(0)
}

/// `'x'` for `sh -c`: claude runs the status line command through the shell.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// The user's own status line wins: with one in `~/.claude/settings.json` we add nothing.
fn user_has_status_line(settings: &Path) -> bool {
    let Ok(text) = fs::read_to_string(settings) else { return false };
    serde_json::from_str::<Value>(&text).ok().is_some_and(|v| v.get("statusLine").is_some())
}

fn settings_arg(exe: &Path, file: &Path) -> String {
    let command = format!("{} {HELPER_FLAG} {}", shell_quote(&exe.to_string_lossy()), shell_quote(&file.to_string_lossy()));
    serde_json::json!({ "statusLine": { "type": "command", "command": command } }).to_string()
}

/// JSON for `claude --settings`, or `None` when the user has their own status line.
#[tauri::command]
pub fn claude_settings_arg(app: tauri::AppHandle) -> Option<String> {
    let home = PathBuf::from(std::env::var_os("HOME")?);
    if user_has_status_line(&home.join(".claude/settings.json")) {
        return None;
    }
    let dir = app.path().app_config_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(settings_arg(&std::env::current_exe().ok()?, &dir.join(LIMITS_FILE)))
}

/// Newest limits any claude pane reported; `None` before the first one.
#[tauri::command]
pub fn claude_limits(app: tauri::AppHandle) -> Option<ClaudeLimits> {
    let file = app.path().app_config_dir().ok()?.join(LIMITS_FILE);
    serde_json::from_slice(&fs::read(file).ok()?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_the_windows() {
        let input = r#"{"session_id":"x","cwd":"/secret","rate_limits":{
            "five_hour":{"used_percentage":42.5,"resets_at":1790000000},
            "seven_day":{"used_percentage":18,"resets_at":1790500000}}}"#;
        let got = parse_status(input, 7).unwrap();
        assert_eq!(got.five_hour, Some(Window { pct: 42.5, resets_at: 1_790_000_000 }));
        assert_eq!(got.seven_day.map(|w| w.pct), Some(18.0));
        let json = serde_json::to_string(&got).unwrap();
        assert!(!json.contains("secret") && json.contains("\"resetsAt\""), "{json}");
    }

    #[test]
    fn no_limits_no_record() {
        assert_eq!(parse_status(r#"{"model":{"id":"m"}}"#, 1), None);
        assert_eq!(parse_status(r#"{"rate_limits":{"spend_limit":{"used_percentage":1,"resets_at":2}}}"#, 1), None);
        assert_eq!(parse_status("not json", 1), None);
        let one = parse_status(r#"{"rate_limits":{"seven_day":{"used_percentage":3,"resets_at":9}}}"#, 1).unwrap();
        assert_eq!((one.five_hour, one.seven_day.map(|w| w.resets_at)), (None, Some(9)));
    }

    #[test]
    fn store_round_trips() {
        let dir = std::env::temp_dir().join(format!("aw-limits-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join(LIMITS_FILE);
        let limits = parse_status(r#"{"rate_limits":{"five_hour":{"used_percentage":1,"resets_at":2}}}"#, 3).unwrap();
        store(&file, &limits).unwrap();
        assert_eq!(serde_json::from_slice::<ClaudeLimits>(&fs::read(&file).unwrap()).unwrap(), limits);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "temp file left behind");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn settings_arg_quotes_paths_with_spaces_and_quotes() {
        let arg = settings_arg(Path::new("/a b/agents"), Path::new("/c/it's.json"));
        let v: Value = serde_json::from_str(&arg).unwrap();
        assert_eq!(v["statusLine"]["type"], "command");
        assert_eq!(v["statusLine"]["command"], r#"'/a b/agents' --aw-statusline '/c/it'\''s.json'"#);
    }

    #[test]
    fn user_status_line_is_detected() {
        let dir = std::env::temp_dir().join(format!("aw-limits-user-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("settings.json");
        assert!(!user_has_status_line(&file), "missing file");
        fs::write(&file, r#"{"model":"opus"}"#).unwrap();
        assert!(!user_has_status_line(&file));
        fs::write(&file, r#"{"statusLine":{"type":"command","command":"x"}}"#).unwrap();
        assert!(user_has_status_line(&file));
        fs::remove_dir_all(&dir).unwrap();
    }
}
