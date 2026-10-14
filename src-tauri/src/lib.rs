use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::Manager;
use walkdir::WalkDir;

const JOURNAL_FILE: &str = "rename-journal.json";

/// Proxy GET requests to the Pixwel API from Rust so the webview never deals with CORS.
#[tauri::command]
async fn api_get(
    base_url: String,
    token: String,
    path: String,
    query: Vec<(String, String)>,
) -> Result<Value, String> {
    let url = format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    );
    let response = reqwest::Client::new()
        .get(&url)
        .query(&query)
        .bearer_auth(token.trim())
        .header("Accept", "application/json")
        .header("User-Agent", "pixname")
        .send()
        .await
        .map_err(|e| format!("Request to {url} failed: {e}"))?;

    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let snippet: String = body.chars().take(300).collect();
        return Err(format!("{status} from {path}: {snippet}"));
    }
    serde_json::from_str(&body).map_err(|e| format!("Invalid JSON from {path}: {e}"))
}

#[derive(Serialize)]
struct ToolStatus {
    ffprobe: Option<String>,
    mediainfo: Option<String>,
}

/// GUI apps on macOS don't inherit the shell PATH, so also look in the usual install locations.
fn find_tool(configured: Option<String>, name: &str) -> Option<String> {
    if let Some(p) = configured.filter(|p| !p.trim().is_empty()) {
        return Path::new(&p).is_file().then_some(p);
    }
    let exe = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for extra in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/opt/local/bin",
        "C:\\ProgramData\\chocolatey\\bin",
        "C:\\Program Files\\MediaInfo",
        "C:\\ffmpeg\\bin",
    ] {
        dirs.push(PathBuf::from(extra));
    }
    dirs.into_iter()
        .map(|d| d.join(&exe))
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn tool_status(ffprobe: Option<String>, mediainfo: Option<String>) -> ToolStatus {
    ToolStatus {
        ffprobe: find_tool(ffprobe, "ffprobe"),
        mediainfo: find_tool(mediainfo, "mediainfo"),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
    path: String,
    name: String,
    dir: String,
    size: u64,
    /// Folder names from the dropped folder down to the file's folder (outermost first).
    /// Empty when a file itself was dropped.
    rel_dirs: Vec<String>,
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with('.') || n == "Thumbs.db" || n == "desktop.ini")
        .unwrap_or(false)
}

/// Expand dropped paths (files or folders) into a flat list of files, recursing into folders.
#[tauri::command]
fn expand_paths(paths: Vec<String>) -> Vec<FileEntry> {
    let mut out = Vec::new();
    for root in paths {
        // Relative folders are measured from the dropped folder's parent, so its own name counts.
        let base = Path::new(&root).parent().map(Path::to_path_buf);
        for entry in WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| e.depth() == 0 || !is_hidden(e.path()))
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() || is_hidden(entry.path()) {
                continue;
            }
            let path = entry.path();
            out.push(FileEntry {
                path: path.to_string_lossy().into_owned(),
                name: path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                dir: path
                    .parent()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                size: entry.metadata().map(|m| m.len()).unwrap_or(0),
                rel_dirs: match (&base, path.parent()) {
                    (Some(base), Some(parent)) if entry.depth() > 0 => parent
                        .strip_prefix(base)
                        .map(|rel| {
                            rel.components()
                                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                                .collect()
                        })
                        .unwrap_or_default(),
                    _ => Vec::new(),
                },
            });
        }
    }
    out
}

#[derive(Serialize, Default)]
struct Probe {
    ffprobe: Option<Value>,
    mediainfo: Option<Value>,
    image: Option<(usize, usize)>,
    errors: Vec<String>,
}

async fn run_json(tool: &str, args: &[&str]) -> Result<Value, String> {
    let mut cmd = tokio::process::Command::new(tool);
    cmd.args(args);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd.output().await.map_err(|e| format!("{tool}: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "{tool} exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("{tool} output: {e}"))
}

/// Gather technical metadata the same way the platform does: mediainfo (preferred, it is what
/// the SDK maps from) and ffprobe (used for tag `ffprobeRules`), plus a header-only image size fallback.
#[tauri::command]
async fn probe_file(path: String, ffprobe: Option<String>, mediainfo: Option<String>) -> Probe {
    let mut probe = Probe::default();

    if let Some(tool) = find_tool(mediainfo, "mediainfo") {
        match run_json(&tool, &["--Output=JSON", &path]).await {
            Ok(v) => probe.mediainfo = Some(v),
            Err(e) => probe.errors.push(e),
        }
    }
    if let Some(tool) = find_tool(ffprobe, "ffprobe") {
        let args = [
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            &path,
        ];
        match run_json(&tool, &args).await {
            Ok(v) => probe.ffprobe = Some(v),
            Err(e) => probe.errors.push(e),
        }
    }
    if let Ok(size) = imagesize::size(&path) {
        probe.image = Some((size.width, size.height));
    }
    probe
}

#[derive(Serialize, Deserialize, Clone)]
struct RenameOp {
    from: String,
    to: String,
}

#[derive(Serialize)]
struct RenameResult {
    from: String,
    to: String,
    ok: bool,
    error: Option<String>,
}

fn same_path_ignoring_case(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
}

fn rename_one(from: &Path, to: &Path) -> Result<(), String> {
    if !from.is_file() {
        return Err("source file no longer exists".into());
    }
    if from == to {
        return Ok(());
    }
    // A case-only rename on a case-insensitive filesystem would look like a collision; go via a temp name.
    if same_path_ignoring_case(from, to) {
        let tmp = to.with_file_name(format!(
            ".pixname-{}.tmp",
            std::process::id()
        ));
        std::fs::rename(from, &tmp).map_err(|e| e.to_string())?;
        return std::fs::rename(&tmp, to).map_err(|e| e.to_string());
    }
    if to.exists() {
        return Err("a file with the new name already exists".into());
    }
    std::fs::rename(from, to).map_err(|e| e.to_string())
}

fn journal_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(JOURNAL_FILE))
}

/// Rename files in place. `to` is a bare file name; files never move between folders.
/// Successful renames are journaled so the last batch can be undone.
#[tauri::command]
fn rename_files(app: tauri::AppHandle, ops: Vec<RenameOp>) -> Result<Vec<RenameResult>, String> {
    let mut results = Vec::new();
    let mut done = Vec::new();
    for op in ops {
        let from = PathBuf::from(&op.from);
        let outcome = if op.to.is_empty() || op.to.contains(['/', '\\']) || op.to == ".." {
            Err("invalid file name".to_string())
        } else {
            let to = from.with_file_name(&op.to);
            rename_one(&from, &to).map(|_| to)
        };
        match outcome {
            Ok(to) => {
                let to = to.to_string_lossy().into_owned();
                done.push(RenameOp {
                    from: op.from.clone(),
                    to: to.clone(),
                });
                results.push(RenameResult {
                    from: op.from,
                    to,
                    ok: true,
                    error: None,
                });
            }
            Err(e) => results.push(RenameResult {
                from: op.from,
                to: op.to,
                ok: false,
                error: Some(e),
            }),
        }
    }
    if !done.is_empty() {
        let json = serde_json::to_string_pretty(&done).map_err(|e| e.to_string())?;
        std::fs::write(journal_path(&app)?, json).map_err(|e| e.to_string())?;
    }
    Ok(results)
}

/// Reverse the most recent rename batch.
#[tauri::command]
fn undo_last_rename(app: tauri::AppHandle) -> Result<Vec<RenameResult>, String> {
    let path = journal_path(&app)?;
    let data = std::fs::read_to_string(&path).map_err(|_| "Nothing to undo".to_string())?;
    let ops: Vec<RenameOp> = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let results = ops
        .into_iter()
        .rev()
        .map(|op| {
            let res = rename_one(Path::new(&op.to), Path::new(&op.from));
            RenameResult {
                from: op.to,
                to: op.from,
                ok: res.is_ok(),
                error: res.err(),
            }
        })
        .collect();
    let _ = std::fs::remove_file(path);
    Ok(results)
}

#[tauri::command]
fn has_undo(app: tauri::AppHandle) -> bool {
    journal_path(&app).map(|p| p.is_file()).unwrap_or(false)
}

/// The default macOS menu's About box shows the bundle's icon, which an unbundled dev build lacks
/// (it shows a generic one). Replace that item with one that carries the app icon explicitly.
#[cfg(target_os = "macos")]
fn set_about_icon(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{AboutMetadata, Menu, MenuItemKind, PredefinedMenuItem};

    let handle = app.handle();
    let menu = Menu::default(handle)?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        let info = handle.package_info();
        let config = handle.config();
        let about = PredefinedMenuItem::about(
            handle,
            None,
            Some(AboutMetadata {
                name: Some(info.name.clone()),
                version: Some(info.version.to_string()),
                copyright: config.bundle.copyright.clone(),
                authors: config.bundle.publisher.clone().map(|p| vec![p]),
                // The full-size app icon; the window icon is 32px and renders tiny here.
                icon: Some(tauri::include_image!("icons/icon.png")),
                ..Default::default()
            }),
        )?;
        app_menu.remove_at(0)?;
        app_menu.insert(&about, 0)?;
    }
    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            #[cfg(target_os = "macos")]
            set_about_icon(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api_get,
            tool_status,
            expand_paths,
            probe_file,
            rename_files,
            undo_last_rename,
            has_undo
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
