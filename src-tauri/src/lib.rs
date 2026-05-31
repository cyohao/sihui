use std::{fs, path::PathBuf, process::Command};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";

const DATA_DIRECTORY: &str = "思绘数据";
const BOARDS_DIRECTORY: &str = "boards";
const LEGACY_FILE: &str = "boards.json";

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

// 每个白板一个文件，存放于「思绘数据/boards/」目录下。
fn boards_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = data_directory(app)?.join(BOARDS_DIRECTORY);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

// 仅允许安全的文件名字符，避免路径穿越（白板 id 是 UUID）。
fn board_file_path(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("非法的白板 id".to_string());
    }
    Ok(boards_directory(app)?.join(format!("{id}.json")))
}

// 把旧版单一的 boards.json 拆分为「一白板一文件」。仅在 boards 目录为空且旧文件存在时执行一次。
fn migrate_legacy(app: &tauri::AppHandle) -> Result<(), String> {
    let directory = boards_directory(app)?;
    let already_has_files = fs::read_dir(&directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .any(|entry| entry.path().extension().map(|ext| ext == "json").unwrap_or(false));
    if already_has_files {
        return Ok(());
    }

    let legacy = data_directory(app)?.join(LEGACY_FILE);
    if !legacy.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&legacy).map_err(|error| error.to_string())?;
    let value: serde_json::Value =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;

    if let Some(boards) = value.get("boards").and_then(|boards| boards.as_array()) {
        for board in boards {
            if let Some(id) = board.get("id").and_then(|id| id.as_str()) {
                let path = board_file_path(app, id)?;
                let serialized = serde_json::to_string_pretty(board).map_err(|e| e.to_string())?;
                fs::write(path, serialized).map_err(|error| error.to_string())?;
            }
        }
    }

    // 保留旧文件作为备份，改名避免重复迁移。
    let _ = fs::rename(&legacy, legacy.with_extension("json.migrated"));
    Ok(())
}

// 读取全部白板文件内容（每个元素是一个白板的 JSON 字符串）。
#[tauri::command]
fn list_board_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    migrate_legacy(&app)?;

    let directory = boards_directory(&app)?;
    let mut boards = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.extension().map(|ext| ext == "json").unwrap_or(false) {
            match fs::read_to_string(&path) {
                Ok(content) => boards.push(content),
                Err(error) => return Err(error.to_string()),
            }
        }
    }
    Ok(boards)
}

// 原子写入单个白板文件（tmp + rename）。
#[tauri::command]
fn save_board_file(app: tauri::AppHandle, id: String, content: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&content).map_err(|error| error.to_string())?;

    let file = board_file_path(&app, &id)?;
    let temporary_file = file.with_extension("json.tmp");
    fs::write(&temporary_file, content).map_err(|error| error.to_string())?;

    if let Err(error) = fs::rename(&temporary_file, &file) {
        let _ = fs::remove_file(&temporary_file);
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
fn delete_board_file(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let file = board_file_path(&app, &id)?;
    if file.exists() {
        fs::remove_file(file).map_err(|error| error.to_string())?;
    }
    Ok(())
}

// 清空所有白板文件（用于「恢复全部」前的重置）。
#[tauri::command]
fn clear_board_files(app: tauri::AppHandle) -> Result<(), String> {
    let directory = boards_directory(&app)?;
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.extension().map(|ext| ext == "json").unwrap_or(false) {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
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
            boards_directory(app.handle())?;
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
            list_board_files,
            save_board_file,
            delete_board_file,
            clear_board_files,
            get_data_directory,
            open_data_directory,
            export_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running sihui");
}
