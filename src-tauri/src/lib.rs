//! Desktop shell for studyPal.
//!
//! All application logic lives in the Bun server (`src/index.ts`). In release
//! builds this shell starts that server as a child process, waits until it
//! accepts connections and then opens a window on it. In debug builds the
//! server is expected to be running already (`tauri dev` starts it through
//! `beforeDevCommand`).

use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// Must match the defaults in `src/server/config.ts`.
const RELEASE_PORT: u16 = 47821;
const DEV_PORT: u16 = 47822;

const SERVER_BINARY: &str = "studypal-server";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(15);

struct Server(Mutex<Option<Child>>);

type BoxError = Box<dyn std::error::Error>;

fn random_token() -> Result<String, BoxError> {
  let mut bytes = [0u8; 32];
  getrandom::fill(&mut bytes).map_err(|error| format!("no random source: {error}"))?;
  Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn spawn_server(app: &tauri::App, token: &str) -> Result<Child, BoxError> {
  let binary = std::env::current_exe()?
    .parent()
    .ok_or("executable has no parent directory")?
    .join(SERVER_BINARY);
  let data_dir = app.path().app_data_dir()?;
  std::fs::create_dir_all(&data_dir)?;

  let child = Command::new(&binary)
    .env("STUDYPAL_PORT", RELEASE_PORT.to_string())
    .env("STUDYPAL_TOKEN", token)
    .env("STUDYPAL_DATA_DIR", &data_dir)
    .env("STUDYPAL_PARENT_PID", std::process::id().to_string())
    .spawn()
    .map_err(|error| format!("cannot start {}: {error}", binary.display()))?;
  Ok(child)
}

/// Blocks until the server accepts TCP connections, or fails if it exits or
/// takes longer than `STARTUP_TIMEOUT`.
fn wait_until_ready(child: &mut Child, port: u16) -> Result<(), BoxError> {
  let address = SocketAddr::from(([127, 0, 0, 1], port));
  let deadline = Instant::now() + STARTUP_TIMEOUT;
  loop {
    if TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_ok() {
      return Ok(());
    }
    if let Some(status) = child.try_wait()? {
      return Err(format!("studyPal server exited during startup ({status})").into());
    }
    if Instant::now() >= deadline {
      return Err("studyPal server did not start in time".into());
    }
    std::thread::sleep(Duration::from_millis(100));
  }
}

fn start(app: &mut tauri::App) -> Result<(), BoxError> {
  let url = if cfg!(debug_assertions) {
    format!("http://127.0.0.1:{DEV_PORT}/")
  } else {
    let token = random_token()?;
    let mut child = spawn_server(app, &token)?;
    if let Err(error) = wait_until_ready(&mut child, RELEASE_PORT) {
      let _ = child.kill();
      let _ = child.wait();
      return Err(error);
    }
    app.manage(Server(Mutex::new(Some(child))));
    format!("http://127.0.0.1:{RELEASE_PORT}/auth?token={token}")
  };

  WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
    .title("studyPal")
    .inner_size(1200.0, 800.0)
    .min_inner_size(900.0, 600.0)
    .build()?;
  Ok(())
}

fn stop_server(app: &tauri::AppHandle) {
  let Some(server) = app.try_state::<Server>() else {
    return;
  };
  let child = server.0.lock().ok().and_then(|mut guard| guard.take());
  if let Some(mut child) = child {
    let _ = child.kill();
    let _ = child.wait();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| start(app))
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let RunEvent::Exit = event {
        stop_server(app);
      }
    });
}
