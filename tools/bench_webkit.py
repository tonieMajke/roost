"""Pomiar płynności podglądu Agents w WebKitGTK 4.1 poza ekranem (opis: HANDOFF, „Płynność”).

Wymaga `pnpm dev`. python3 tools/bench_webkit.py [ui-json] [sekundy] [png] [css]
Zmienne: BENCH_SCROLL=1 (przewijanie), BENCH_RESIZE=1 (okno zmienia rozmiar co klatkę), BENCH_W/BENCH_H, BENCH_WORKSPACE, BENCH_HASH=#dom, WEBKIT_*.
"""
import json, os, sys, time, pathlib

for k, v in [("GDK_BACKEND", "x11"), ("WEBKIT_DISABLE_COMPOSITING_MODE", "1"),
             ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"), ("LIBGL_ALWAYS_SOFTWARE", "1")]:
    os.environ.setdefault(k, v)

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GLib

override = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
secs = float(sys.argv[2]) if len(sys.argv) > 2 else 10
png = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
css = sys.argv[4] if len(sys.argv) > 4 else ""
scroll = os.environ.get("BENCH_SCROLL") == "1"
resize = os.environ.get("BENCH_RESIZE") == "1"

ws = json.load(open(os.environ.get("BENCH_WORKSPACE", os.path.expanduser("~/.config/dev.majke.roost/workspace.json"))))
ws["ui"].update(override)
seed = f"""
try {{
  if (!sessionStorage.getItem('seeded')) {{
    localStorage.clear();
    localStorage.setItem('aw-workspace', {json.dumps(json.dumps(ws))});
    localStorage.setItem('aw-bench', '1');
    if (window.location.hash.includes('dom')) localStorage.setItem('aw-renderer', 'dom');
    sessionStorage.setItem('seeded', '1');
  }}
}} catch (e) {{}}
"""

ctx = WebKit2.WebContext.new_ephemeral()
view = WebKit2.WebView.new_with_context(ctx)
ucm = view.get_user_content_manager()
ucm.add_script(WebKit2.UserScript.new(seed, WebKit2.UserContentInjectedFrames.TOP_FRAME,
                                      WebKit2.UserScriptInjectionTime.START, None, None))
if css:
    ucm.add_style_sheet(WebKit2.UserStyleSheet.new(css, WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserStyleLevel.USER, None, None))
win = Gtk.OffscreenWindow()
win.set_default_size(int(os.environ.get("BENCH_W", 1400)), int(os.environ.get("BENCH_H", 900)))
win.add(view)
win.show_all()
view.load_uri("http://localhost:5183/" + os.environ.get("BENCH_HASH", ""))


def web_pids():
    me = str(os.getpid())
    out = []
    for p in pathlib.Path("/proc").iterdir():
        if not p.name.isdigit():
            continue
        try:
            st = (p / "stat").read_text()
            cmd = (p / "cmdline").read_bytes()
        except OSError:
            continue
        ppid = st.rsplit(")", 1)[1].split()[1]
        if ppid == me and b"WebKitWebProcess" in cmd:
            out.append(p.name)
    return out


def ticks(pid):
    f = pathlib.Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    return int(f[11]) + int(f[12])


state = {}
hz = os.sysconf("SC_CLK_TCK")


def start():
    state["pids"] = web_pids() + [str(os.getpid())]
    state["t0"] = time.time()
    state["a"] = {p: ticks(p) for p in state["pids"]}
    GLib.timeout_add(int(secs * 1000), stop)
    return False


def stop():
    dt = time.time() - state["t0"]
    res = {}
    for p in state["pids"]:
        name = "ui" if p == str(os.getpid()) else "web"
        res[name] = round((ticks(p) - state["a"][p]) * 100 / hz / dt, 1)
    print(json.dumps({"ui": override, "css": css[:60], **res}))
    if png:
        surf = win.get_surface()
        surf.write_to_png(png)
    Gtk.main_quit()
    return False



PROBE = """
(() => {
  const gl = document.querySelectorAll('.xterm canvas').length + ' canvas, ' + document.querySelectorAll('.xterm-rows').length + ' dom';
  const noWheel = location.hash.includes('nowheel');
  const el = document.querySelector('.pane.is-focused .xterm-screen') || document.querySelector('.xterm-screen');
  const r = el.getBoundingClientRect();
  const times = [];
  let last = performance.now();
  const t0 = last;
  let dir = -1;
  const step = (now) => {
    times.push(now - last); last = now;
    if (now - t0 > 1500 && dir < 0 && times.length % 60 === 0) dir = -1;
    if (!noWheel && !window.__noWheel) el.dispatchEvent(new WheelEvent('wheel', {deltaY: dir * 120, deltaMode: 0, bubbles: true, cancelable: true, clientX: r.x + 50, clientY: r.y + 50}));
    if (now - t0 < 4000) requestAnimationFrame(step);
    else {
      times.shift();
      const s = [...times].sort((a, b) => a - b);
      window.__res = JSON.stringify({webgl2: gl, frames: times.length, mean: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), max: +s[s.length - 1].toFixed(1)});
    }
  };
  requestAnimationFrame(step);
})();
"""


def js(code, cb):
    view.evaluate_javascript(code, -1, None, None, None, lambda v, res: cb(v.evaluate_javascript_finish(res)), )


def run_scroll():
    if resize:
        # Okno rośnie i maleje o kilka px co ~16 ms, jak przy przeciąganiu krawędzi.
        w0, h0 = win.get_size()
        st = {"i": 0}
        def tick():
            st["i"] += 1
            d = (st["i"] % 60) - 30
            win.resize(w0 - 300 + abs(d) * 10, h0 - 200 + abs(d) * 6)
            return st["i"] < 280
        GLib.timeout_add(16, tick)
        js("window.__noWheel = true", lambda _v: None)
    js(PROBE, lambda _v: None)
    GLib.timeout_add(4800, collect)
    return False


def collect():
    def got(v):
        print(json.dumps({"ui": override, "css": css[:60], "scroll": v.to_string()}))
        if png: win.get_surface().write_to_png(png)
        Gtk.main_quit()
    js("window.__res || 'null'", got)
    return False

GLib.timeout_add(8000, run_scroll if scroll or resize else start)  # rozruch: fonty, wjazd paneli
Gtk.main()
