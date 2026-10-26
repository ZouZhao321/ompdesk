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
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
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

/// 发 TERM 后给 sidecar 的宽限。退出路径在 Tauri 的事件线程上跑，这段等待
/// 直接卡住窗口关闭，所以只留很短的一档。
const SIDECAR_EXIT_TIMEOUT: Duration = Duration::from_millis(700);
/// 补发 KILL 之后等待 leader 回收的上限，`wait()` 因此不会无界阻塞。
const SIDECAR_KILL_TIMEOUT: Duration = Duration::from_millis(300);
/// 端口探测的重试次数与间隔：刚退出或刚绑定的瞬间可能先回 RST。
const PORT_PROBE_ATTEMPTS: u32 = 3;
const PORT_PROBE_RETRY_DELAY: Duration = Duration::from_millis(50);

impl ServerChild {
    /// Stops the sidecar's process group and waits for the leader to exit.
    ///
    /// 补发信号只发生在 leader 尚未回收时：那一刻 pid 还属于本进程，KILL 整棵
    /// 树是安全的。leader 一旦回收，同样的 pid 可能已被无关进程复用，再按旧
    /// pid 发信号会打到别人的进程树，因此这里不再补发。
    ///
    /// 端口固定，leader 退出后仍被占用意味着下次启动会被拒绝，但那只是一条
    /// 日志：占用可能来自本机其它进程，销毁动作到此为止。
    fn terminate(&self) {
        let child = self.0.lock().ok().and_then(|mut guard| guard.take());
        let Some(mut child) = child else { return };
        let pid = child.id();
        kill_process_group(pid, GroupSignal::Terminate);
        let mut wait = wait_for_exit(&mut child, SIDECAR_EXIT_TIMEOUT);
        if matches!(wait, ExitWait::Running) {
            // leader 还没回收，pid 仍属于本进程，可以安全地 KILL 整棵树。
            kill_process_group(pid, GroupSignal::Kill);
            let _ = child.kill();
            wait = wait_for_exit(&mut child, SIDECAR_KILL_TIMEOUT);
            match wait {
                ExitWait::Unknown => {
                    desktop_log("[omp-desktop] could not confirm whether the sidecar exited after KILL")
                }
                ExitWait::Exited => desktop_log(
                    "[omp-desktop] sidecar outlived its grace period; killed the process group",
                ),
                ExitWait::Running => desktop_log(
                    "[omp-desktop] sidecar is still running after KILL; leaving it to the OS",
                ),
            }
        }
        if !matches!(wait, ExitWait::Exited) {
            return;
        }
        // 只记录结果：确认占用与无法确认占用要分开说，后者不能断言端口被占。
        match probe_port(SERVER_PORT) {
            PortStatus::Free => {}
            PortStatus::Occupied => desktop_log(&format!(
                "[omp-desktop] port {SERVER_PORT} still accepts connections after the sidecar \
                 exited; another process may hold it, and the next launch will refuse to start \
                 until it is freed"
            )),
            PortStatus::Unconfirmed(reason) => desktop_log(&format!(
                "[omp-desktop] could not confirm that port {SERVER_PORT} was released after the \
                 sidecar exited: {reason}"
            )),
        }
    }
}

/// 等待 leader 的结果。
///
/// `Unknown` 与 `Running` 必须分开：只有确认 leader 仍未回收时，pid 才肯定还属于
/// 本进程，按它补发信号才安全。
enum ExitWait {
    /// leader 已回收。
    Exited,
    /// 宽限期内仍在运行。
    Running,
    /// 无法确认（回收出错），不得再按旧 pid 发信号。
    Unknown,
}

/// Waits for the child to exit within the timeout.
fn wait_for_exit(child: &mut Child, timeout: Duration) -> ExitWait {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return ExitWait::Exited,
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                desktop_log(&format!("[omp-desktop] could not reap the sidecar: {error}"));
                return ExitWait::Unknown;
            }
        }
    }
    ExitWait::Running
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

/// What a probe proved about the port.
///
/// 连接探测负责认出「有人在 accept」：监听者接受连接，残留的 TIME_WAIT 套接字
/// 拒绝连接，已退出的服务因此不会挡住下一次启动。但连接结果不能单独用来判
/// 「空闲」：Windows 把一次被拒绝的 loopback 连接报成 `TimedOut`，只看连接就会
/// 把空闲端口判成未确认、启动直接拒绝。确认能绑定才是启动真正需要的动作，所以
/// 没有连接 accept 之后由 [`confirm_free`] 用一次 bind 定案。
enum PortStatus {
    /// Nothing holds the port: it can be bound.
    Free,
    /// A listener accepted the connection: the port is definitely taken.
    Occupied,
    /// The probe proved nothing (permissions, timeout, ...), so the port is
    /// treated as taken without claiming it is.
    Unconfirmed(String),
}

fn probe_port(port: u16) -> PortStatus {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    for attempt in 0..PORT_PROBE_ATTEMPTS {
        if attempt > 0 {
            thread::sleep(PORT_PROBE_RETRY_DELAY);
        }
        match TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
            Ok(_) => return PortStatus::Occupied,
            // 超时不足以证明空闲：有的平台把拒绝报成超时，交给 bind 定案。
            Err(error) if error.kind() == ErrorKind::TimedOut => break,
            Err(error) if is_no_listener_error(error.kind()) => {}
            Err(error) => return PortStatus::Unconfirmed(error.to_string()),
        }
    }
    confirm_free(addr)
}

/// 用一次 bind 确认端口空闲：能绑定就是启动时服务器真正要的结果。
///
/// 只在这里短暂持有端口，判定完立刻释放。仍绑不上却没人 accept 的端口（例如
/// 平台不允许复用刚关闭的套接字）既不能证明可用、也不能证明有人在监听，因此报
/// 未确认而不冒充「已被占用」。
fn confirm_free(addr: SocketAddr) -> PortStatus {
    match TcpListener::bind(addr) {
        Ok(listener) => {
            drop(listener);
            PortStatus::Free
        }
        Err(error) if error.kind() == ErrorKind::AddrInUse => PortStatus::Unconfirmed(format!(
            "the port cannot be bound ({error}) even though no connection was accepted"
        )),
        Err(error) => PortStatus::Unconfirmed(error.to_string()),
    }
}

/// 无人 accept 的错误：拒绝、复位与中断都算。服务刚退出或刚绑定的瞬间，本机
/// 可能先回 RST 而不是干净的拒绝，所以探测会短重试几次再确认。
fn is_no_listener_error(kind: ErrorKind) -> bool {
    matches!(
        kind,
        ErrorKind::ConnectionRefused | ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted
    )
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
/// enumerates the tree from the leader instead, so the tree is only reachable
/// while the leader is unreaped — callers signal before the leader is reaped,
/// never after (a reaped pid can be reused by an unrelated process).
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

    // 刚释放的端口与从未监听的端口都必须判 Free。Windows 的 connect_timeout 会把
    // 「拒绝」报成超时，只看连接就会把空闲端口判成未确认，桌面壳因此拒绝启动。
    #[test]
    fn idle_loopback_ports_probe_as_free() {
        for _ in 0..3 {
            let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
                .expect("bind an ephemeral port to stand in for an idle port");
            let port = listener.local_addr().expect("ephemeral address").port();
            drop(listener);

            let status = probe_port(port);
            let label = match &status {
                PortStatus::Free => String::from("free"),
                PortStatus::Occupied => String::from("occupied"),
                PortStatus::Unconfirmed(reason) => format!("unconfirmed: {reason}"),
            };
            assert!(
                matches!(status, PortStatus::Free),
                "an idle port must probe as free, got {label}"
            );
        }
    }

    // bind 兜底位于「没人 accept」之后，因此不能把被别人监听的端口判成空闲。
    #[test]
    fn bind_confirmation_keeps_a_held_port_taken() {
        let held = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
            .expect("bind an ephemeral port to stand in for a running server");
        let port = held.local_addr().expect("ephemeral address").port();

        let status = confirm_free(SocketAddr::from((Ipv4Addr::LOCALHOST, port)));
        assert!(
            !matches!(status, PortStatus::Free),
            "a port another process holds must never be confirmed free"
        );
    }

    // 复位与中断同样说明没有人 accept，只有真正没结论的错误才算未确认。
    #[test]
    fn reset_and_abort_count_as_nobody_listening() {
        for kind in [
            ErrorKind::ConnectionRefused,
            ErrorKind::ConnectionReset,
            ErrorKind::ConnectionAborted,
        ] {
            assert!(
                is_no_listener_error(kind),
                "{kind:?} means no process accepted the connection"
            );
        }
        assert!(
            !is_no_listener_error(ErrorKind::TimedOut),
            "a timeout proves nothing about the port"
        );
    }
}
