//! ចាប់ផ្តើម Python sidecar (FastAPI) ពេល app បើក ហើយសម្លាប់វាពេលបិទ.
//!
//! App នេះជា UI សុទ្ធ — pipeline ទាំងអស់នៅក្នុង Python. ជំនួសឲ្យអ្នកប្រើបើក
//! terminal ដោយខ្លួនឯង យើងបើក `uvicorn` ជា process កូន.

use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::Duration;

pub const PORT: u16 = 8765;

/// រក root របស់ project — folder ដែលមាន `.venv` និង `server/`.
///
/// ពេល dev, binary រត់ក្នុង `ui/src-tauri/target/...` ដូច្នេះយើងឡើងលើរហូតដល់
/// ឃើញវា. ពេល build ជា installer នោះ Python មិននៅក្បែរទេ — មុខងារនេះ
/// ត្រឡប់ `None` ហើយ UI បង្ហាញថា sidecar មិនរត់ (ការខ្ចប់ Python ជាការងារក្រោយ).
fn project_root() -> Option<PathBuf> {
    let mut starts: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = std::env::current_dir() {
        starts.push(dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            starts.push(dir.to_path_buf());
        }
    }
    for start in starts {
        for folder in start.ancestors() {
            if folder.join("server").join("app.py").is_file() && venv_python(folder).is_file() {
                return Some(folder.to_path_buf());
            }
        }
    }
    None
}

fn venv_python(root: &Path) -> PathBuf {
    if cfg!(windows) {
        root.join(".venv").join("Scripts").join("python.exe")
    } else {
        root.join(".venv").join("bin").join("python")
    }
}

/// មាន sidecar រត់រួចហើយឬ? (អ្នកប្រើអាចបើក uvicorn ដោយដៃពេល dev.)
pub fn already_running() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], PORT));
    TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok()
}

/// បើក uvicorn. `None` បើរកមិនឃើញ Python ឬមានវារត់រួចហើយ.
pub fn start() -> Option<Child> {
    if already_running() {
        log::info!("sidecar កំពុងរត់រួចហើយនៅ port {PORT}");
        return None;
    }
    let root = project_root()?;
    log::info!("បើក sidecar ពី {}", root.display());

    let mut command = Command::new(venv_python(&root));
    command
        .args([
            "-m",
            "uvicorn",
            "server.app:app",
            "--host",
            "127.0.0.1",
            "--port",
            &PORT.to_string(),
            "--log-level",
            "warning",
        ])
        .current_dir(&root);

    // កុំបង្ហាញ console window ខ្មៅលើ Windows
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    match command.spawn() {
        Ok(child) => Some(child),
        Err(error) => {
            log::error!("បើក sidecar មិនបាន: {error}");
            None
        }
    }
}
