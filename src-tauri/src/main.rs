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

use tauri::{AppHandle, Manager, Url};

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

impl ServerChild {
    /// Stops the sidecar's process group and waits for it to exit, force
    /// killing the child once the grace period runs out.
    ///
    /// The wait matters because the port is fixed: a relaunch right after a
    /// failure must not find the previous child still holding it.
    fn terminate(&self) {
        let child = self.0.lock().ok().and_then(|mut guard| guard.take());
        let Some(mut child) = child else { return };
        kill_process_group(child.id());
        let deadline = Instant::now() + SIDECAR_EXIT_TIMEOUT;
        while Instant::now() < deadline {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(error) => {
                    desktop_log(&format!("[omp-desktop] could not reap the sidecar: {error}"));
                    break;
                }
            }
        }
        let _ = child.kill();
        let _ = child.wait();
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
    thread::spawn(move || {
        // The placeholder page owns the window only once its navigation has
        // committed; painting into the previous document would be wiped.
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if window.url().is_ok_and(|url| url.as_str().contains("index.html")) {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        if let Err(error) = window.eval(&script) {
            desktop_log(&format!("[omp-desktop] could not paint the failure screen: {error}"));
        }
    });
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
    ensure_port_available(port)?;
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

/// Fails when the fixed port is already held, with the reason and the fix.
/// A connect probe separates a live listener from a socket lingering in
/// TIME_WAIT: the listener accepts the connection, the lingering socket
/// refuses it, so a recently closed server never blocks the next launch.
fn ensure_port_available(port: u16) -> Result<(), String> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let reason = match TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
        // 连接被接受，说明端口确实有监听。
        Ok(_) => String::from("the port accepts connections"),
        // 只有明确的拒绝能证明端口空闲。
        Err(error) if error.kind() == ErrorKind::ConnectionRefused => return Ok(()),
        // 其他错误（权限、超时等）无法证明端口空闲，按占用处理。
        Err(error) => error.to_string(),
    };
    Err(format!(
        "port {port} on {HOST} is already in use ({reason}). \
         Another ompdesk server may still be running — quit it, or free port {port}, \
         and relaunch. ompdesk never switches ports, because phone access and \
         `tailscale serve` forward this one."
    ))
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

/// Fire-and-forget termination of the sidecar's process group.
fn kill_process_group(pid: u32) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &format!("-{pid}")])
            .spawn();
    }
    #[cfg(windows)]
    {
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

        let error = ensure_port_available(port).expect_err("the probe must reject a listening port");
        assert!(
            error.contains(&port.to_string()),
            "error must name the port: {error}"
        );

        drop(held);
        ensure_port_available(port).expect("port is free again after the holder is dropped");
    }

    // The README phone-access steps, tauri.conf.json's devUrl and the CLI
    // launcher's default all point at this literal; keep the shell's constant
    // on that port so those instructions stay valid.
    #[test]
    fn server_port_is_30141() {
        assert_eq!(SERVER_PORT, 30141);
    }
}
