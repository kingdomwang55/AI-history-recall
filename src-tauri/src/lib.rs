pub mod lifecycle;
pub mod runtime;
pub mod sidecars;
pub mod tray;

use runtime::AppRuntime;
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::open_window(app.clone(), "/");
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_autostart::init(
                    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                    Some(vec!["--autostart"]),
                ))
                .map_err(|error| {
                    std::io::Error::other(format!("Unable to initialize login startup: {error}"))
                })?;
            let runtime = AppRuntime::load(app.handle()).map_err(|error| {
                std::io::Error::other(format!("Unable to initialize desktop paths: {error}"))
            })?;
            app.manage(runtime);
            tray::build_tray(app.handle()).map_err(|error| {
                std::io::Error::other(format!("Unable to create system tray: {error}"))
            })?;
            let app_handle = app.handle().clone();
            let autostart = std::env::args().any(|argument| argument == "--autostart");
            tauri::async_runtime::spawn(async move {
                let Some(runtime) = app_handle.try_state::<AppRuntime>() else {
                    return;
                };
                let result = if autostart {
                    runtime.ensure_daemon(&app_handle).await.map(|_| ())
                } else {
                    runtime.open_main_window(&app_handle, "/").await
                };
                if let Err(error) = result {
                    app_handle
                        .dialog()
                        .message(error)
                        .title("AI History Recall could not start")
                        .kind(MessageDialogKind::Error)
                        .show(|_| {});
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                let window = window.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(runtime) = app.try_state::<AppRuntime>() {
                        if !runtime.close_to_tray() {
                            let _ = runtime.shutdown();
                            let _ = window.destroy();
                            app.exit(0);
                            return;
                        }
                        let _ = runtime.close_main_window();
                    }
                    let _ = window.destroy();
                });
            }
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build AI History Recall");
    app.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            if let Some(runtime) = app.try_state::<AppRuntime>() {
                let _ = runtime.shutdown();
            }
        }
    });
}
