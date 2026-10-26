// omp-desktop: Tauri v2 desktop shell for ompdesk.
//
// In release builds the bundled Bun runtime starts the ompdesk Next.js server
// as a sidecar on the fixed loopback port 30141, then the main window navigates
// to http://127.0.0.1:30141. If another process already holds the port the
// shell shows why in the window and quits once that window is closed, instead
// of picking a different port, so a tailnet forward to 30141 keeps working
// across launches. In dev mode (`bun run tauri dev`) the server is already
// running via beforeDevCommand and the webview loads devUrl.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, Url, Webview};

const WINDOW_LABEL: &str = "main";
const HOST: &str = "127.0.0.1";
/// Loopback port shared by every launch mode (`bun run dev`, `bun run start`,
/// the CLI launcher and this shell), so `tailscale serve` forwards stay valid
/// across restarts. Never fall back to another port: a silent switch would
/// leave the phone pointed at nothing.
const SERVER_PORT: u16 = 30141;
const NEXT_ENTRY: &str = "node_modules/next/dist/bin/next";

/// Appends a line to the desktop log in the temp dir and mirrors it to
/// stderr. GUI-launched apps have no terminal, so stderr alone is
/// unreachable; the file makes the sidecar observable.
fn desktop_log(line: &str) {
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(desktop_log_path())
    {
        let _ = writeln!(file, "{line}");
    }
    eprintln!("{line}");
}

/// Location of the desktop log; the failure screen points the user at it.
fn desktop_log_path() -> PathBuf {
    std::env::temp_dir().join("omp-desktop.log")
}

/// Spawns a reader that forwards a child stream line-by-line to the log.
fn drain_to_log<R: Read + Send + 'static>(stream: R) {
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().map_while(Result::ok) {
            desktop_log(&format!("[server] {line}"));
        }
    });
}

/// Name of the bundled Bun runtime for the compiled target. Both macOS
/// binaries are always bundled (universal app), so the architecture selects
/// the right one at runtime.
fn bun_binary_name() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "bun-darwin-aarch64"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "bun-darwin-x64"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "bun-windows-x64.exe"
    }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64"),
    )))]
    {
        "bun-unsupported-platform"
    }
}

/// The running Bun sidecar, kept in managed state so its process group can be
/// torn down when the app exits.
struct ServerChild(Mutex<Option<Child>>);

/// How long the sidecar gets to exit after the group signal. The port is
/// fixed, so an orphan that keeps listening would refuse the next launch.
const SIDECAR_EXIT_TIMEOUT: Duration = Duration::from_secs(3);
/// How long the fixed port gets to become bindable again, both right after the
/// sidecar exits and again after the group is killed a second time. Only a
/// real leftover listener waits this out: a closed one refuses immediately.
const SIDECAR_PORT_RELEASE_TIMEOUT: Duration = Duration::from_secs(1);

impl ServerChild {
    /// Stops the sidecar's process group and waits for it to exit, escalating
    /// to KILL for the whole group once the grace period runs out.
    ///
    /// The wait matters because the port is fixed: a relaunch right after a
    /// failure must not find the previous child still holding it. The leader
    /// exiting is not proof either — a descendant it spawned can keep the
    /// listener — so a port that is still taken after the leader is gone earns
    /// the same KILL.
    fn terminate(&self) {
        let child = self.0.lock().ok().and_then(|mut guard| guard.take());
        let Some(mut child) = child else { return };
        let pid = child.id();
        kill_process_group(pid, GroupSignal::Terminate);
        if !wait_for_exit(&mut child, SIDECAR_EXIT_TIMEOUT) {
            // The child and its descendants still hold the port: escalate the
            // whole group instead of only reaping the leader.
            kill_process_group(pid, GroupSignal::Kill);
            let _ = child.kill();
            let _ = child.wait();
            desktop_log("[omp-desktop] sidecar outlived its grace period; killed the process group");
        }
        if wait_for_port_release(SERVER_PORT, SIDECAR_PORT_RELEASE_TIMEOUT) {
            return;
        }
        // The leader is gone but something in its group still listens: kill the
        // group again, then confirm once more so the log reflects the result.
        desktop_log(
            "[omp-desktop] the sidecar exited but its process group still holds the port; \
             killed the process group again",
        );
        kill_process_group(pid, GroupSignal::Kill);
        if !wait_for_port_release(SERVER_PORT, SIDECAR_PORT_RELEASE_TIMEOUT) {
            desktop_log(&format!(
                "[omp-desktop] port {SERVER_PORT} is still held after the sidecar exited; \
                 the next launch will refuse to start until it is freed"
            ));
        }
    }
}

/// Waits for the child to exit; reports whether it did.
fn wait_for_exit(child: &mut Child, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                desktop_log(&format!("[omp-desktop] could not reap the sidecar: {error}"));
                return false;
            }
        }
    }
    false
}

/// Waits for the port to become bindable again; reports whether it did.
///
/// Only `PortStatus::Free` counts: a probe that proved nothing (an unconfirmed
/// status) is not evidence that the port is usable. The caller decides how to
/// escalate, so this stays silent.
fn wait_for_port_release(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if matches!(probe_port(port), PortStatus::Free) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(50));
    }
}

/// Reports a failure the user can see, then leaves the exit to them.
///
/// A GUI launch has no terminal, so exiting silently hides every predictable
/// failure behind a window that just disappears. The reason goes into the main
/// window, the app stays up, and closing the window exits with `code` so
/// launchers and scripts still see the refusal.
fn report_failure(handle: &AppHandle, code: i32, message: &str) {
    if let Some(server) = handle.try_state::<ServerChild>() {
        server.terminate();
    }
    let log_path = desktop_log_path();
    desktop_log(&format!("[omp-desktop] {message}"));
    let Some(window) = handle.get_webview_window(WINDOW_LABEL) else {
        std::process::exit(code);
    };
    window.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
        ) {
            std::process::exit(code);
        }
    });
    let script = failure_page_script(message, &log_path);
    let already_committed = {
        let mut screen = lock_failure_screen();
        screen.script = Some(script.clone());
        screen.committed
    };
    if already_committed {
        // The current document is known to be committed, so it can take the
        // panel right away. The script stays queued: the next Finished signal
        // repaints over a navigation that was still in flight.
        paint_failure_screen(window.as_ref(), &script);
    }
}

/// The failure screen to paint and the last page load that committed.
///
/// The panel may only be painted into a committed document: painting over the
/// previous one is wiped by the navigation that is still running. `on_page_load`
/// reports every Finished load, so a pending script is painted from there.
struct FailureScreen {
    committed: bool,
    script: Option<String>,
}

static FAILURE_SCREEN: Mutex<FailureScreen> = Mutex::new(FailureScreen {
    committed: false,
    script: None,
});

fn lock_failure_screen() -> std::sync::MutexGuard<'static, FailureScreen> {
    FAILURE_SCREEN.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn paint_failure_screen(webview: &Webview, script: &str) {
    if let Err(error) = webview.eval(script) {
        desktop_log(&format!("[omp-desktop] could not paint the failure screen: {error}"));
    }
}

/// Builds the script that replaces the splash with the failure reason and the
/// log path, so the window itself explains why ompdesk refused to start.
fn failure_page_script(message: &str, log_path: &Path) -> String {
    const SCRIPT: &str = r#"
(() => {
  const paint = () => {
    document.title = "ompdesk - startup failed";
    const panel = document.createElement("div");
    panel.style.cssText = "max-width:760px;margin:14vh auto;padding:28px 32px;border:1px solid #2a2e37;border-radius:12px;background:#14161b;color:#e8e9ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6";
    const heading = document.createElement("h1");
    heading.textContent = "ompdesk could not start";
    heading.style.cssText = "font-size:18px;margin-bottom:14px";
    const detail = document.createElement("pre");
    detail.textContent = __REASON__;
    detail.style.cssText = "white-space:pre-wrap;word-break:break-word;margin-bottom:18px;font-size:13px;color:#ffb4b4";
    const hint = document.createElement("p");
    hint.textContent = "Full log: " + __LOG_PATH__ + ". Close this window to quit.";
    hint.style.cssText = "font-size:12px;color:#8a8f9a";
    panel.append(heading, detail, hint);
    document.body.replaceChildren(panel);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint);
  else paint();
})();
"#;
    let reason = serde_json::to_string(message).unwrap_or_else(|_| String::from("\"startup failed\""));
    let log_path = serde_json::to_string(&log_path.display().to_string())
        .unwrap_or_else(|_| String::from("\"omp-desktop.log\""));
    SCRIPT.replace("__REASON__", &reason).replace("__LOG_PATH__", &log_path)
}

fn main() {
    tauri::Builder::default()
        // The failure panel belongs to a committed document only; every
        // finished page load repaints the script that is still queued.
        .on_page_load(|webview, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let mut screen = lock_failure_screen();
            screen.committed = true;
            let script = screen.script.take();
            drop(screen);
            if let Some(script) = script {
                paint_failure_screen(webview, &script);
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Track the webview URL — ground truth for "stuck on the
            // placeholder" vs "server page loaded" vs "load failed".
            if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
                thread::spawn(move || {
                    let mut last: Option<String> = None;
                    loop {
                        let current = window.url().map(|url| url.to_string());
                        let current = match current {
                            Ok(url) => url,
                            Err(_) => String::from("<unavailable>"),
                        };
                        if last.as_deref() != Some(current.as_str()) {
                            last = Some(current.clone());
                            desktop_log(&format!("[webview] url: {current}"));
                        }
                        thread::sleep(Duration::from_millis(500));
                    }
                });
            }
            if !tauri::is_dev() {
                if let Err(error) = start_server(app) {
                    report_failure(app.handle(), 1, &format!("failed to start the bundled server: {error}"));
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build omp-desktop application")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                if let Some(server) = app.try_state::<ServerChild>() {
                    server.terminate();
                }
            }
        });
}

fn start_server(app: &mut tauri::App) -> Result<(), String> {
    let port = SERVER_PORT;
    if let Some(error) = port_error(port, probe_port(port)) {
        return Err(error);
    }
    let root = server_root(app)?;

    let bun = root.join(bun_binary_name());
    if !bun.is_file() {
        return Err(format!(
            "bundled Bun runtime not found: {} (expected next to the server payload in {})",
            bun.display(),
            root.display()
        ));
    }

    let mut command = Command::new(&bun);
    command
        .current_dir(&root)
        .arg("--bun")
        .arg(NEXT_ENTRY)
        .arg("start")
        .arg("-H")
        .arg(HOST)
        .arg("-p")
        .arg(port.to_string())
        // Relative project paths in the browser resolve against this
        // directory (lib/directory-browser.ts reads OMPDESK_LAUNCH_CWD).
        .env(
            "OMPDESK_LAUNCH_CWD",
            app.path().home_dir().map_err(|error| error.to_string())?,
        )
        // The server writes this into its `process.start` log so the Logs
        // panel can distinguish the desktop shell from a plain production run.
        .env("OMPDESK_DESKTOP", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(no_proxy) = loopback_no_proxy() {
        command.env("NO_PROXY", &no_proxy).env("no_proxy", &no_proxy);
    }
    make_process_group(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to spawn bundled Bun ({}): {error}", bun.display()))?;

    // Drain the server's stdout/stderr into the desktop log; the pipes would
    // otherwise fill up and block the child.
    if let Some(stream) = child.stdout.take() {
        drain_to_log(stream);
    }
    if let Some(stream) = child.stderr.take() {
        drain_to_log(stream);
    }

    app.manage(ServerChild(Mutex::new(Some(child))));

    let handle = app.handle().clone();
    thread::spawn(move || match wait_until_ready(port) {
        Ok(()) => {
            desktop_log(&format!("[omp-desktop] server ready on http://{HOST}:{port}/"));
            navigate_main(&handle, port);
        }
        Err(error) => {
            report_failure(&handle, 1, &format!("the bundled server failed to become ready: {error}"));
        }
    });

    desktop_log(&format!("[omp-desktop] ompdesk server starting on http://{HOST}:{port}/"));
    Ok(())
}

/// What a connect probe proved about the port.
///
/// A probe separates a live listener from a socket lingering in TIME_WAIT: the
/// listener accepts the connection, the lingering socket refuses it, so a
/// recently closed server never blocks the next launch.
enum PortStatus {
    /// Nothing listens: the port can be bound.
    Free,
    /// A listener accepted the connection: the port is definitely taken.
    Occupied,
    /// The probe proved nothing (permissions, timeout, ...), so the port is
    /// treated as taken without claiming it is.
    Unconfirmed(String),
}

fn probe_port(port: u16) -> PortStatus {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    match TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
        Ok(_) => PortStatus::Occupied,
        Err(error) if error.kind() == ErrorKind::ConnectionRefused => PortStatus::Free,
        Err(error) => PortStatus::Unconfirmed(error.to_string()),
    }
}

/// Why the fixed port cannot be used, or `None` when the probe proved it free.
///
/// An occupied port and a port the probe could not clear get different reasons:
/// only the first one tells the user another server is running.
fn port_error(port: u16, status: PortStatus) -> Option<String> {
    const RULE: &str = "ompdesk never switches ports, because phone access and \
                        `tailscale serve` forward this one.";
    match status {
        PortStatus::Free => None,
        PortStatus::Occupied => Some(format!(
            "port {port} on {HOST} is already in use: the port accepts connections. \
             Another ompdesk server may still be running — quit it, or free port {port}, \
             and relaunch. {RULE}"
        )),
        PortStatus::Unconfirmed(reason) => Some(format!(
            "could not confirm that port {port} on {HOST} is free ({reason}). \
             Another ompdesk server may still be holding it — quit it, or check port {port}, \
             and relaunch. {RULE}"
        )),
    }
}

/// Locates the server payload (node_modules, .next, public, the bundled Bun,
/// ...). Resources land in the app's resource_dir; the parent directory is
/// checked as a fallback for layouts that nest them one level deeper.
fn server_root(app: &tauri::App) -> Result<PathBuf, String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    if resources.join("node_modules").is_dir() {
        return Ok(resources);
    }
    if let Some(parent) = resources.parent() {
        if parent.join("node_modules").is_dir() {
            return Ok(parent.to_path_buf());
        }
    }
    Err(format!(
        "server payload not found: expected node_modules next to {}",
        resources.display()
    ))
}

/// Polls the server until it answers an HTTP request (up to 60s).
fn wait_until_ready(port: u16) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut last = String::from("no HTTP response");
    while Instant::now() < deadline {
        match http_get(port) {
            Ok(true) => return Ok(()),
            Ok(false) => last = String::from("server answered with a non-HTTP reply"),
            Err(error) => last = error.to_string(),
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err(format!("timed out after 60s: {last}"))
}

fn http_get(port: u16) -> std::io::Result<bool> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(500))?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.write_all(
        format!("GET / HTTP/1.1\r\nHost: {HOST}:{port}\r\nConnection: close\r\n\r\n").as_bytes(),
    )?;
    let mut buffer = [0_u8; 64];
    let read = stream.read(&mut buffer)?;
    Ok(read > 0 && buffer.starts_with(b"HTTP/"))
}

fn navigate_main(handle: &AppHandle, port: u16) {
    let url = match Url::parse(&format!("http://{HOST}:{port}/")) {
        Ok(url) => url,
        Err(error) => return report_failure(handle, 1, &format!("invalid server URL: {error}")),
    };
    match handle.get_webview_window(WINDOW_LABEL) {
        Some(window) => {
            if let Err(error) = window.navigate(url) {
                report_failure(handle, 1, &format!("failed to navigate to the ompdesk server: {error}"));
            }
        }
        None => report_failure(handle, 1, "the main window is missing"),
    }
}

/// Runs the child as a process-group leader so the whole tree can be torn
/// down with one signal (unix: `kill -TERM -pid`; windows: `taskkill /T`).
fn make_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NEW_PROCESS_GROUP
        command.creation_flags(0x0000_0200);
    }
}

/// Signal sent to the sidecar's process group.
#[derive(Clone, Copy)]
enum GroupSignal {
    /// Graceful stop; the sidecar closes its listeners and exits.
    Terminate,
    /// Escalation after the grace period; the whole group is killed.
    Kill,
}

/// Fire-and-forget signal to the sidecar's process group.
///
/// Unix signals the group itself, which outlives its leader. Windows
/// enumerates the tree from the leader instead, so a retry after the leader has
/// already exited cannot reach the leftover descendant; the wait that follows
/// still reports it in the log.
fn kill_process_group(pid: u32, signal: GroupSignal) {
    #[cfg(unix)]
    {
        let flag = match signal {
            GroupSignal::Terminate => "-TERM",
            GroupSignal::Kill => "-KILL",
        };
        let _ = Command::new("kill")
            .args([flag, &format!("-{pid}")])
            .spawn();
    }
    #[cfg(windows)]
    {
        // taskkill /T /F already kills the tree, so both signals are the same.
        let _ = signal;
        let _ = Command::new("taskkill")
            .args(["/pid", &pid.to_string(), "/T", "/F"])
            .spawn();
    }
}

/// Bun 1.4 sends loopback requests through `HTTP_PROXY` as well, which breaks
/// local providers behind a proxy; it honors `NO_PROXY`, read once at startup,
/// so the loopback hosts are appended before Bun is spawned (bin/runtime.js
/// does the same for the npm launcher).
fn loopback_no_proxy() -> Option<String> {
    let proxied = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]
        .iter()
        .any(|name| std::env::var_os(name).is_some_and(|value| !value.is_empty()));
    if !proxied {
        return None;
    }
    let current = std::env::var("NO_PROXY")
        .or_else(|_| std::env::var("no_proxy"))
        .unwrap_or_default();
    if current.trim() == "*" {
        return None;
    }
    let mut entries: Vec<String> = current
        .split(',')
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
        .collect();
    let before = entries.len();
    for host in ["localhost", "127.0.0.1", "::1"] {
        if !entries.iter().any(|entry| entry == host) {
            entries.push(host.to_string());
        }
    }
    (entries.len() != before).then(|| entries.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::net::TcpListener;

    // A held port must be rejected loudly instead of falling back to a
    // different port; the same probe must pass once the holder is gone.
    #[test]
    fn occupied_port_is_rejected_then_free_again() {
        let held = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
            .expect("bind an ephemeral port to stand in for a running server");
        let port = held.local_addr().expect("ephemeral address").port();

        let error = port_error(port, probe_port(port)).expect("a listening port must be rejected");
        assert!(
            error.contains(&port.to_string()),
            "error must name the port: {error}"
        );
        assert!(
            error.contains("already in use"),
            "a listener proves the port is taken: {error}"
        );

        drop(held);
        // The next launch only needs the port to be bindable again; a connect
        // probe right after the drop can still answer with a reset on Windows.
        TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, port)))
            .expect("port is free again after the holder is dropped");
    }

    // A probe that proves nothing must not claim another server is running.
    #[test]
    fn unconfirmed_probe_says_the_port_could_not_be_checked() {
        let error = port_error(
            30141,
            PortStatus::Unconfirmed(String::from("connection timed out")),
        )
        .expect("an unconfirmed probe must block the launch");
        assert!(error.contains("could not confirm"), "{error}");
        assert!(
            error.contains("connection timed out"),
            "the probe failure must be kept: {error}"
        );
        assert!(
            !error.contains("already in use"),
            "an unconfirmed probe must not claim the port is occupied: {error}"
        );
    }

    // The README phone-access steps, tauri.conf.json's devUrl and the CLI
    // launcher's default all point at this literal; keep the shell's constant
    // on that port so those instructions stay valid.
    #[test]
    fn server_port_is_30141() {
        assert_eq!(SERVER_PORT, 30141);
    }

    // A listener that outlives the leader must be reported, not assumed gone:
    // terminate() only escalates when this returns false.
    #[test]
    fn waiting_for_a_held_port_reports_unreleased() {
        let held = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
            .expect("bind an ephemeral port to stand in for a leftover listener");
        let port = held.local_addr().expect("ephemeral address").port();
        let started = Instant::now();

        assert!(
            !wait_for_port_release(port, Duration::from_millis(150)),
            "a held port must not be reported as released"
        );
        assert!(
            started.elapsed() >= Duration::from_millis(150),
            "the wait must use its whole timeout before giving up"
        );
    }
}
