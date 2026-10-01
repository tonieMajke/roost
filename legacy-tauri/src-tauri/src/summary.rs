//! Streszczenie wyciągu rozmowy przez jednorazowe `claude -p` (M4, Shift przy upuszczeniu).
//! Bez narzędzi, MCP, ustawień i zapisu sesji; katalog tymczasowy, żeby nie czytał CLAUDE.md.

use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(60);
const MODEL: &str = "haiku";

fn summary_args(system: &str) -> Vec<String> {
    [
        "-p",
        "--model",
        MODEL,
        "--no-session-persistence",
        "--tools",
        "",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--setting-sources",
        "",
        "--system-prompt",
        system,
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

/// Uruchamia `program args`, podaje `input` na stdin, zwraca przycięte stdout.
/// Błąd: nie wystartował, przekroczony czas (proces zabity), kod ≠ 0 albo pusta odpowiedź.
fn run(program: &str, args: &[String], input: String, timeout: Duration) -> Result<String, String> {
    let (remove, set) = crate::appimage::current_fixes();
    let mut cmd = Command::new(program);
    for key in crate::own_env().map(String::from).chain(remove) {
        cmd.env_remove(key);
    }
    let mut child = cmd
        .envs(set)
        .args(args)
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("nie uruchomiono `{program}`: {e}"))?;

    let mut stdin = child.stdin.take().expect("piped stdin");
    std::thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes()); // zamknięcie stdin = koniec wejścia
    });
    let mut stdout = child.stdout.take().expect("piped stdout");
    let out = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let mut stderr = child.stderr.take().expect("piped stderr");
    let err = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("brak odpowiedzi po {} s", timeout.as_secs()));
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    let out = out.join().unwrap_or_default();
    let err = err.join().unwrap_or_default();
    if !status.success() {
        let why = err.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
        return Err(match status.code() {
            Some(code) if why.is_empty() => format!("kod {code}"),
            Some(code) => format!("kod {code}: {why}"),
            None => "przerwany sygnałem".into(),
        });
    }
    let out = out.trim();
    if out.is_empty() {
        return Err("pusta odpowiedź".into());
    }
    Ok(out.to_string())
}

/// `command`: program claude z agents.json (zwykle `claude`); `system`: polecenie streszczenia;
/// `input`: wyciąg rozmowy.
#[tauri::command]
pub async fn claude_summary(command: String, system: String, input: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run(&command, &summary_args(&system), input, TIMEOUT))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sh(script: &str) -> Vec<String> {
        vec!["-c".into(), script.into()]
    }

    #[test]
    fn args_disable_tools_settings_and_persistence() {
        let a = summary_args("streść");
        let has = |pair: [&str; 2]| a.windows(2).any(|w| w[0] == pair[0] && w[1] == pair[1]);
        assert!(has(["--model", "haiku"]));
        assert!(has(["--tools", ""]));
        assert!(has(["--setting-sources", ""]));
        assert!(has(["--system-prompt", "streść"]));
        assert!(a.contains(&"--no-session-persistence".to_string()));
    }

    #[test]
    fn stdin_goes_in_and_trimmed_stdout_comes_back() {
        let out = run("sh", &sh("cat; echo"), "  streszczenie\n".into(), Duration::from_secs(5));
        assert_eq!(out, Ok("streszczenie".into()));
    }

    #[test]
    fn failure_reports_the_code_and_first_stderr_line() {
        let out = run("sh", &sh("echo 'nie zalogowano' >&2; exit 3"), String::new(), Duration::from_secs(5));
        assert_eq!(out, Err("kod 3: nie zalogowano".into()));
        let out = run("sh", &sh("true"), String::new(), Duration::from_secs(5));
        assert_eq!(out, Err("pusta odpowiedź".into()));
        assert!(run("/nie/ma/takiego", &[], String::new(), Duration::from_secs(5)).is_err());
    }

    #[test]
    fn timeout_kills_the_process() {
        let started = Instant::now();
        let out = run("sh", &sh("exec sleep 30"), String::new(), Duration::from_millis(300));
        assert!(out.unwrap_err().starts_with("brak odpowiedzi"));
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
