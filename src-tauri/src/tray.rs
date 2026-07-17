use crate::runtime::AppRuntime;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open AI History Recall", true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", "Sync now", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause background work", true, None::<&str>)?;
    let health = MenuItem::with_id(app, "health", "Health", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &sync, &pause, &health, &separator, &quit])?;
    let pause_item = pause.clone();

    TrayIconBuilder::with_id("main")
        .icon(default_tray_icon())
        .tooltip("AI History Recall")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => open_window(app.clone(), "/"),
            "health" => open_window(app.clone(), "/health"),
            "sync" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(runtime) = app.try_state::<AppRuntime>() {
                        let _ = runtime.ensure_daemon(&app).await;
                        let _ = runtime.sync_now();
                    }
                });
            }
            "pause" => {
                let app = app.clone();
                let item = pause_item.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(runtime) = app.try_state::<AppRuntime>() {
                        if runtime.is_background_running().unwrap_or(false) {
                            let _ = runtime.pause_background();
                            let _ = item.set_text("Resume background work");
                        } else if runtime.ensure_daemon(&app).await.is_ok() {
                            let _ = item.set_text("Pause background work");
                        }
                    }
                });
            }
            "quit" => {
                if let Some(runtime) = app.try_state::<AppRuntime>() {
                    let _ = runtime.shutdown();
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                open_window(tray.app_handle().clone(), "/");
            }
        })
        .build(app)?;
    Ok(())
}

pub fn open_window<R: Runtime>(app: AppHandle<R>, route: &'static str) {
    tauri::async_runtime::spawn(async move {
        if let Some(runtime) = app.try_state::<AppRuntime>() {
            let _ = runtime.open_main_window(&app, route).await;
        }
    });
}

fn default_tray_icon() -> tauri::image::Image<'static> {
    const SIZE: usize = 32;
    let mut rgba = vec![0_u8; SIZE * SIZE * 4];
    for y in 5..27 {
        for x in 6..26 {
            if x == 6 || x == 25 || y == 5 || y == 26 || (x > 11 && x < 20 && y > 10 && y < 21) {
                let index = (y * SIZE + x) * 4;
                rgba[index..index + 4].copy_from_slice(&[32, 35, 42, 255]);
            }
        }
    }
    tauri::image::Image::new_owned(rgba, SIZE as u32, SIZE as u32)
}
