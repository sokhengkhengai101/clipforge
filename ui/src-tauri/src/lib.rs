mod sidecar;

use std::process::Child;
use std::sync::Mutex;

use tauri::{Manager, RunEvent};

/// Process កូន (uvicorn) ដែល app ជាម្ចាស់. `Mutex` ព្រោះ Tauri ចែកវារវាង thread.
struct Sidecar(Mutex<Option<Child>>);

/// UI សួរវាដើម្បីដឹងថា app ជាកម្មវិធី desktop ឬជា browser ធម្មតា.
#[tauri::command]
fn sidecar_port() -> u16 {
    sidecar::PORT
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![sidecar_port])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            app.manage(Sidecar(Mutex::new(sidecar::start())));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // បិទ app -> សម្លាប់ uvicorn ដែលយើងបានបើក (បើអ្នកប្រើបើកវាដោយខ្លួនឯង
            // យើងមិនបានកាន់ Child ទេ ដូច្នេះវានៅរត់ ដែលត្រឹមត្រូវ)
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<Sidecar>() {
                    if let Ok(mut child) = state.0.lock() {
                        if let Some(mut running) = child.take() {
                            let _ = running.kill();
                            let _ = running.wait();
                        }
                    }
                }
            }
        });
}
