use std::{fs, path::PathBuf, process::Command};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";

const DATA_DIRECTORY: &str = "思绘数据";
const DATA_FILE: &str = "boards.json";

fn data_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|error| error.to_string())?;
    let directory = base.join(DATA_DIRECTORY);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn data_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_directory(app)?.join(DATA_FILE))
}

fn ensure_data_file(app: &tauri::AppHandle) -> Result<(), String> {
    let file = data_file(app)?;
    if !file.exists() {
        fs::write(file, r#"{"version":1,"boards":[]}"#).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn load_boards_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let file = data_file(&app)?;
    let backup_file = file.with_extension("json.bak");

    if !file.exists() {
        if backup_file.exists() {
            fs::rename(&backup_file, &file).map_err(|error| error.to_string())?;
        } else {
            return Ok(None);
        }
    }

    fs::read_to_string(file).map(Some).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_boards_file(app: tauri::AppHandle, content: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&content).map_err(|error| error.to_string())?;

    let file = data_file(&app)?;
    let temporary_file = file.with_extension("json.tmp");
    let backup_file = file.with_extension("json.bak");
    fs::write(&temporary_file, content).map_err(|error| error.to_string())?;

    if backup_file.exists() {
        fs::remove_file(&backup_file).map_err(|error| error.to_string())?;
    }

    if file.exists() {
        fs::rename(&file, &backup_file).map_err(|error| error.to_string())?;
    }

    if let Err(error) = fs::rename(&temporary_file, &file) {
        if backup_file.exists() {
            let _ = fs::rename(&backup_file, &file);
        }

        return Err(error.to_string());
    }

    if backup_file.exists() {
        fs::remove_file(backup_file).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn get_data_directory(app: tauri::AppHandle) -> Result<String, String> {
    data_directory(&app).map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_data_directory(app: tauri::AppHandle) -> Result<(), String> {
    let directory = data_directory(&app)?;
    Command::new("explorer")
        .arg(directory)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

// 桌面端导出：弹出保存对话框让用户选位置，再写入文件。
// 内容以 base64 传入，可同时支持文本（JSON/SVG）和二进制（PNG）。
#[tauri::command]
fn export_file(app: tauri::AppHandle, filename: String, data_base64: String) -> Result<bool, String> {
    use base64::Engine;
    use tauri_plugin_dialog::DialogExt;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|error| error.to_string())?;

    let chosen = app
        .dialog()
        .file()
        .set_file_name(&filename)
        .blocking_save_file();

    let Some(path) = chosen else {
        return Ok(false); // 用户取消
    };

    let target = path.into_path().map_err(|error| error.to_string())?;
    fs::write(target, bytes).map_err(|error| error.to_string())?;
    Ok(true)
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn build_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().cloned().ok_or("缺少窗口图标")?)
        .tooltip("sihui")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            ensure_data_file(app.handle())?;
            build_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // 点击关闭按钮时，隐藏到托盘而不是退出程序。
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            // 最小化时，从任务栏隐藏，仅保留托盘图标。
            WindowEvent::Resized(_) => {
                if window.is_minimized().unwrap_or(false) {
                    let _ = window.hide();
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            load_boards_file,
            save_boards_file,
            get_data_directory,
            open_data_directory,
            export_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running sihui");
}
