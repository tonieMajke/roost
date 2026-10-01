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

#[derive(Deserialize, Clone)]
pub struct SpawnSpec {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// Extra env for the child, applied after own_env removal and TERM/COLORTERM.
    #[serde(default)]
    pub env: Vec<(String, String)>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ExitInfo {
    pub code: u32,
    pub signal: Option<String>,
}

/// Stream callback; returning false means the consumer is gone and reading stops.
pub type DataSink = Box<dyn Fn(&[u8]) -> bool + Send + 'static>;
pub type ExitSink = Box<dyn FnOnce(ExitInfo) + Send + 'static>;

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 }
}

/// `$SHELL` → the variable's value, `~/x` → home-relative.
pub(crate) fn expand(value: &str) -> String {
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
    /// Tauri-free core. `on_data` streams output, `on_exit` fires once when the child is reaped.
    pub fn spawn(&self, spec: SpawnSpec, on_data: DataSink, on_exit: ExitSink) -> Result<u32, String> {
        let pair = native_pty_system().openpty(size(spec.cols, spec.rows)).map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new(expand(&spec.command));
        cmd.args(spec.args.iter().map(|a| expand(a)));
        let cwd = spec.cwd.as_deref().map(expand).filter(|c| !c.is_empty()).unwrap_or_else(|| expand("~"));
        cmd.cwd(cwd);
        for key in crate::own_env() {
            cmd.env_remove(key);
        }
        let (remove, set) = crate::appimage::current_fixes();
        for key in remove {
            cmd.env_remove(key);
        }
        for (key, value) in set {
            cmd.env(key, value);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        for (key, value) in &spec.env {
            cmd.env(expand(key), expand(value));
        }

        let mut child = pair.slave.spawn_command(cmd).map_err(|e| format!("{}: {e}", spec.command))?;
        // Only the child may hold the slave side, or the reader never sees EOF when it exits.
        drop(pair.slave);
        let pid = child.process_id().ok_or("no pid")?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        self.map.lock().unwrap().insert(id, Pty { pid, master: pair.master, writer });

        let map = self.map.clone();
        std::thread::spawn(move || {
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if !on_data(&buf[..n]) {
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
            on_exit(info);
        });
        Ok(id)
    }

    pub fn write(&self, id: u32, data: &[u8]) -> Result<(), String> {
        let mut map = self.map.lock().unwrap();
        let pty = map.get_mut(&id).ok_or("no such terminal")?;
        pty.writer.write_all(data).and_then(|_| pty.writer.flush()).map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let map = self.map.lock().unwrap();
        let pty = map.get(&id).ok_or("no such terminal")?;
        pty.master.resize(size(cols, rows)).map_err(|e| e.to_string())
    }

    /// Asynchronous: SIGHUP the group now, SIGKILL stragglers after a grace period.
    pub fn kill(&self, id: u32) {
        let pid = self.map.lock().unwrap().get(&id).map(|p| p.pid);
        if let Some(pid) = pid {
            std::thread::spawn(move || hang_up(vec![pid], Duration::from_millis(1500)));
        }
    }

    #[cfg(test)] // Stages 2-3 will use it from commands; drop the gate then.
    pub fn pid(&self, id: u32) -> Option<u32> {
        self.map.lock().unwrap().get(&id).map(|p| p.pid)
    }

    /// Hang up every agent; called when the app exits.
    pub fn kill_all(&self) {
        hang_up(self.take_all(), Duration::from_millis(1500));
    }

    /// Like `kill_all`, without blocking the caller (page reload runs on the main thread).
    pub fn kill_all_async(&self) {
        let pids = self.take_all();
        if !pids.is_empty() {
            std::thread::spawn(move || hang_up(pids, Duration::from_millis(1500)));
        }
    }

    fn take_all(&self) -> Vec<u32> {
        self.map.lock().unwrap().drain().map(|(_, p)| p.pid).collect()
    }
}

#[tauri::command]
pub fn pty_spawn(
    state: State<'_, Ptys>,
    spec: SpawnSpec,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<ExitInfo>,
) -> Result<u32, String> {
    let data = move |chunk: &[u8]| on_data.send(InvokeResponseBody::Raw(chunk.to_vec())).is_ok();
    let exit = move |info: ExitInfo| {
        let _ = on_exit.send(info);
    };
    state.spawn(spec, Box::new(data), Box::new(exit))
}

#[tauri::command]
pub fn pty_write(state: State<'_, Ptys>, id: u32, data: String) -> Result<(), String> {
    state.write(id, data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, Ptys>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    state.resize(id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(state: State<'_, Ptys>, id: u32) {
    state.kill(id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{self, Receiver};

    const FIVE: Duration = Duration::from_secs(5);

    fn spec_sh(script: &str) -> SpawnSpec {
        SpawnSpec {
            command: "/bin/sh".into(),
            args: vec!["-c".into(), script.into()],
            cwd: None,
            cols: 80,
            rows: 24,
            env: Vec::new(),
        }
    }

    /// Spawn through the core API and hand back receivers for output and the exit info.
    fn run(ptys: &Ptys, script: &str) -> (u32, Receiver<Vec<u8>>, Receiver<ExitInfo>) {
        run_spec(ptys, spec_sh(script))
    }

    fn run_spec(ptys: &Ptys, spec: SpawnSpec) -> (u32, Receiver<Vec<u8>>, Receiver<ExitInfo>) {
        let (data_tx, data_rx) = mpsc::channel::<Vec<u8>>();
        let (exit_tx, exit_rx) = mpsc::channel();
        let id = ptys
            .spawn(
                spec,
                Box::new(move |chunk| data_tx.send(chunk.to_vec()).is_ok()),
                Box::new(move |info| {
                    let _ = exit_tx.send(info);
                }),
            )
            .unwrap();
        (id, data_rx, exit_rx)
    }

    /// Collect output until the child exits (5 s cap per test step).
    fn read_until_exit(data: &Receiver<Vec<u8>>, exits: &Receiver<ExitInfo>) -> (String, ExitInfo) {
        let mut buf = Vec::new();
        let deadline = Instant::now() + FIVE;
        loop {
            if let Ok(chunk) = data.try_recv() {
                buf.extend_from_slice(&chunk);
                continue;
            }
            if let Ok(info) = exits.recv_timeout(Duration::from_millis(50)) {
                while let Ok(chunk) = data.try_recv() {
                    buf.extend_from_slice(&chunk);
                }
                let text = String::from_utf8_lossy(&buf).replace('\r', "");
                return (text, info);
            }
            assert!(Instant::now() < deadline, "child did not exit within 5 s");
        }
    }

    fn pid_alive(pid: u32) -> bool {
        // SAFETY: signal 0 only probes existence.
        unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
    }

    #[test]
    fn expands_home_and_variables() {
        let home = std::env::var("HOME").unwrap();
        assert_eq!(expand("~"), home);
        assert_eq!(expand("~/x"), format!("{home}/x"));
        assert_eq!(expand("$HOME"), home);
        assert_eq!(expand("claude"), "claude");
        assert_eq!(expand("a~b"), "a~b");
    }

    #[test]
    fn exit_code_reaches_the_callback() {
        let ptys = Ptys::default();
        let (id, data, exits) = run(&ptys, "exit 7");
        let (_, info) = read_until_exit(&data, &exits);
        assert_eq!(info.code, 7);
        // The reader thread removes the entry before reporting; poll briefly for it.
        let deadline = Instant::now() + FIVE;
        while ptys.pid(id).is_some() {
            assert!(Instant::now() < deadline, "entry not removed after exit");
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn cwd_is_passed_to_the_child() {
        let dir = std::env::temp_dir().join(format!("aw-cwd-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let want = dir.canonicalize().unwrap();

        let spec = SpawnSpec { cwd: Some(want.to_string_lossy().into_owned()), ..spec_sh("pwd -P") };
        let (_, data, exits) = run_spec(&Ptys::default(), spec);
        let (out, info) = read_until_exit(&data, &exits);
        std::fs::remove_dir(&dir).ok();
        assert_eq!(info.code, 0);
        assert_eq!(out.trim(), want.to_string_lossy());
    }

    #[test]
    fn kill_reaches_the_whole_process_group() {
        let ptys = Ptys::default();
        // Child sleeps in the background and prints its pid: the marker we watch.
        let (id, data, _exits) = run(&ptys, "sleep 31 & echo MARKER-$!; wait");
        let marker_loop = Instant::now() + FIVE;
        let mut buf = Vec::new();
        let marker_pid: u32 = loop {
            if let Ok(chunk) = data.recv_timeout(FIVE) {
                buf.extend_from_slice(&chunk);
                let text = String::from_utf8_lossy(&buf);
                if let Some(line) = text.lines().find_map(|l| l.strip_prefix("MARKER-")) {
                    break line.trim().parse().expect("marker pid");
                }
            }
            assert!(Instant::now() < marker_loop, "marker never appeared");
        };
        assert!(pid_alive(marker_pid));
        assert!(ptys.pid(id).is_some(), "session leader must be tracked");

        ptys.kill(id);
        let deadline = Instant::now() + FIVE;
        while pid_alive(marker_pid) {
            assert!(Instant::now() < deadline, "sleep survived the group kill");
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn kill_all_async_forgets_every_pane_and_kills_it_later() {
        let ptys = Ptys::default();
        let (a, _da, _ea) = run(&ptys, "sleep 32");
        let (b, _db, _eb) = run(&ptys, "sleep 33");
        let pids = [ptys.pid(a).unwrap(), ptys.pid(b).unwrap()];
        let started = Instant::now();
        ptys.kill_all_async();
        assert!(started.elapsed() < Duration::from_millis(500), "must not wait for the grace period");
        assert_eq!((ptys.pid(a), ptys.pid(b)), (None, None), "old page's panes stay tracked");
        let deadline = Instant::now() + FIVE;
        while pids.iter().any(|&p| pid_alive(p)) {
            assert!(Instant::now() < deadline, "a pane survived the reload");
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn write_reaches_the_childs_stdin() {
        let ptys = Ptys::default();
        let (id, data, _exits) = run(&ptys, "cat");
        // Consume the prompt-less start, then write and expect the line back.
        ptys.write(id, b"hello-pipe\n").unwrap();
        let deadline = Instant::now() + FIVE;
        let mut buf = Vec::new();
        loop {
            if let Ok(chunk) = data.recv_timeout(FIVE) {
                buf.extend_from_slice(&chunk);
                if String::from_utf8_lossy(&buf).contains("hello-pipe") {
                    break;
                }
            }
            assert!(Instant::now() < deadline, "cat never echoed the line");
        }
        ptys.kill(id);
    }
}
