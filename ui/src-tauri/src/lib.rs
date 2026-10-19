mod sidecar;

use std::process::Child;
use std::sync::Mutex;

use tauri::{Manager, PhysicalPosition, PhysicalSize, RunEvent, WebviewWindow};

/// Process កូន (uvicorn) ដែល app ជាម្ចាស់. `Mutex` ព្រោះ Tauri ចែកវារវាង thread.
struct Sidecar(Mutex<Option<Child>>);

/// UI សួរវាដើម្បីដឹងថា app ជាកម្មវិធី desktop ឬជា browser ធម្មតា.
#[tauri::command]
fn sidecar_port() -> u16 {
    sidecar::PORT
}

/// ឲ្យ window សមនឹងផ្ទៃដែលប្រើបានរបស់អេក្រង់ (ដក taskbar) ហើយដាក់វានៅកណ្តាល.
///
/// 1440x900 (tauri.conf.json) ធំជាងផ្ទៃប្រើបាននៃអេក្រង់ 1080p ដែល scale 125%
/// (1536x824 logical) — taskbar បាំងបាតរបស់វា រួមទាំងប៊ូតុងចាប់ផ្តើមលើ screen Import.
/// លេខថេរតូចជាងមិនដោះស្រាយទេ ព្រោះ scale 150% ទុកផ្ទៃតិចជាងនេះទៀត.
fn fit_to_work_area(window: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = window.current_monitor()? else {
        return Ok(());
    };
    let area = monitor.work_area(); // pixel ពិត (physical), មិនរាប់ taskbar
    let size = window.outer_size()?;
    let width = size.width.min(area.size.width);
    let height = size.height.min(area.size.height);
    window.set_size(PhysicalSize::new(width, height))?;
    let x = area.position.x + (area.size.width - width) as i32 / 2;
    let y = area.position.y + (area.size.height - height) as i32 / 2;
    window.set_position(PhysicalPosition::new(x, y))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ផ្ទាំងជ្រើស file ពិត (JS: @tauri-apps/plugin-dialog `open()`)
        .plugin(tauri_plugin_dialog::init())
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
            // window ចាប់ផ្តើមលាក់ (`visible: false`): ដាក់ទំហំ/ទីតាំងសិន រួចទើបបង្ហាញ
            // ដូច្នេះអ្នកប្រើមិនឃើញវាលោតពីទំហំធំទៅតូច. បើការដាក់បរាជ័យ ក៏នៅតែបង្ហាញ.
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = fit_to_work_area(&window) {
                    log::warn!("fit window to the screen: {error}");
                }
                window.show()?;
            }
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
