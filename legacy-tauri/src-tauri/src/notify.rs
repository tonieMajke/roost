//! Powiadomienie na pulpicie przez `notify-send` (Linux) — bez nowej zależności.

use std::process::{Command, Stdio};

const APP_NAME: &str = "Agents";

/// Argumenty `notify-send`: nazwa aplikacji, tytuł, treść.
pub fn notify_args(title: &str, body: &str) -> Vec<String> {
    vec!["-a".into(), APP_NAME.into(), title.into(), body.into()]
}

#[tauri::command]
pub fn notify(title: String, body: String) {
    let args = notify_args(&title, &body);
    let mut cmd = Command::new("notify-send");
    cmd.args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // Zmienne webviewu (patrz `set_webview_env`) nie są dla procesu z zewnątrz.
    for key in crate::own_env() {
        cmd.env_remove(key);
    }
    match cmd.spawn() {
        // Dziecko żyje ułamek sekundy: sprzątamy je w tle, żeby nie zostały zombie.
        Ok(mut child) => {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
        }
        Err(e) => eprintln!("notify-send: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_maja_nazwe_aplikacji_przed_tytulem_i_trescia() {
        assert_eq!(
            notify_args("Agents: Claude", "skończył pracę w projekt"),
            vec![
                "-a".to_string(),
                "Agents".to_string(),
                "Agents: Claude".to_string(),
                "skończył pracę w projekt".to_string(),
            ]
        );
    }
}
