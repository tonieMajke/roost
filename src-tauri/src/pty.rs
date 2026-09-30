//! Agent processes in pseudo-terminals. Each one is a session leader (portable-pty calls setsid),
//! so its pid is also its process group and one signal to `-pid` reaches everything it started.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

struct Pty {
    pid: u32,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

#[derive(Default, Clone)]
pub struct Ptys {
    map: Arc<Mutex<HashMap<u32, Pty>>>,
    next: Arc<AtomicU32>,
}

#[derive(Deserialize)]
pub struct SpawnSpec {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
}

#[derive(Serialize, Clone)]
pub struct ExitInfo {
    code: u32,
    signal: Option<String>,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 }
}

/// `$SHELL` → the variable's value, `~/x` → home-relative.
fn expand(value: &str) -> String {
    if let Some(var) = value.strip_prefix('$') {
        return std::env::var(var).unwrap_or_default();
    }
    if value == "~" || value.starts_with("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return format!("{}{}", home.to_string_lossy(), &value[1..]);
        }
    }
    value.to_string()
}

fn signal_group(pid: u32, sig: libc::c_int) -> bool {
    // SAFETY: plain syscall; a negative pid addresses the process group.
    unsafe { libc::kill(-(pid as libc::pid_t), sig) == 0 }
}

/// SIGHUP to the group (what closing a terminal window does), SIGKILL whatever is left after `grace`.
fn hang_up(pids: Vec<u32>, grace: Duration) {
    let alive: Vec<u32> = pids.into_iter().filter(|&pid| signal_group(pid, libc::SIGHUP)).collect();
    let until = Instant::now() + grace;
    while Instant::now() < until && alive.iter().any(|&pid| signal_group(pid, 0)) {
        std::thread::sleep(Duration::from_millis(50));
    }
    for pid in alive {
        signal_group(pid, libc::SIGKILL);
    }
}

impl Ptys {
    /// Hang up every agent; called when the app exits.
    pub fn kill_all(&self) {
        let pids: Vec<u32> = self.map.lock().unwrap().drain().map(|(_, p)| p.pid).collect();
        hang_up(pids, Duration::from_millis(1500));
    }
}

#[tauri::command]
pub fn pty_spawn(
    state: State<'_, Ptys>,
    spec: SpawnSpec,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<ExitInfo>,
) -> Result<u32, String> {
    let pair = native_pty_system().openpty(size(spec.cols, spec.rows)).map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(expand(&spec.command));
    cmd.args(spec.args.iter().map(|a| expand(a)));
    let cwd = spec.cwd.as_deref().map(expand).filter(|c| !c.is_empty()).unwrap_or_else(|| expand("~"));
    cmd.cwd(cwd);
    for key in crate::own_env() {
        cmd.env_remove(key);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| format!("{}: {e}", spec.command))?;
    // Only the child may hold the slave side, or the reader never sees EOF when it exits.
    drop(pair.slave);
    let pid = child.process_id().ok_or("no pid")?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    state.map.lock().unwrap().insert(id, Pty { pid, master: pair.master, writer });

    let map = state.map.clone();
    std::thread::spawn(move || {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if on_data.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
            }
        }
        let status = child.wait();
        // Removed before reporting, so a later kill cannot hit a reused pid.
        map.lock().unwrap().remove(&id);
        let info = match status {
            Ok(s) => ExitInfo { code: s.exit_code(), signal: s.signal().map(str::to_string) },
            Err(e) => ExitInfo { code: 1, signal: Some(e.to_string()) },
        };
        let _ = on_exit.send(info);
    });
    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, Ptys>, id: u32, data: String) -> Result<(), String> {
    let mut map = state.map.lock().unwrap();
    let pty = map.get_mut(&id).ok_or("no such terminal")?;
    pty.writer.write_all(data.as_bytes()).and_then(|_| pty.writer.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, Ptys>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let map = state.map.lock().unwrap();
    let pty = map.get(&id).ok_or("no such terminal")?;
    pty.master.resize(size(cols, rows)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, Ptys>, id: u32) {
    let pid = state.map.lock().unwrap().get(&id).map(|p| p.pid);
    if let Some(pid) = pid {
        std::thread::spawn(move || hang_up(vec![pid], Duration::from_millis(1500)));
    }
}

#[cfg(test)]
mod tests {
    use super::expand;

    #[test]
    fn expands_home_and_variables() {
        let home = std::env::var("HOME").unwrap();
        assert_eq!(expand("~"), home);
        assert_eq!(expand("~/x"), format!("{home}/x"));
        assert_eq!(expand("$HOME"), home);
        assert_eq!(expand("claude"), "claude");
        assert_eq!(expand("a~b"), "a~b");
    }
}
