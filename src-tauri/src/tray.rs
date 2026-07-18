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
        .icon_as_template(true)
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

    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f64 + 0.5 - 13.5;
            let dy = y as f64 + 0.5 - 13.5;
            let radius = (dx * dx + dy * dy).sqrt();
            if (7.2..=9.4).contains(&radius) || on_line(x, y, 20.0, 20.0, 27.0, 27.0, 1.35) {
                paint_pixel(&mut rgba, SIZE, x, y, 255);
            }
        }
    }

    draw_line(&mut rgba, SIZE, 13.5, 13.5, 13.5, 8.5, 1.1);
    draw_line(&mut rgba, SIZE, 13.5, 13.5, 18.2, 13.5, 1.1);
    draw_line(&mut rgba, SIZE, 8.5, 8.8, 10.3, 6.4, 1.0);
    draw_line(&mut rgba, SIZE, 8.5, 8.8, 11.2, 9.4, 1.0);
    tauri::image::Image::new_owned(rgba, SIZE as u32, SIZE as u32)
}

fn draw_line(rgba: &mut [u8], size: usize, x1: f64, y1: f64, x2: f64, y2: f64, width: f64) {
    for y in 0..size {
        for x in 0..size {
            if on_line(x, y, x1, y1, x2, y2, width) {
                paint_pixel(rgba, size, x, y, 255);
            }
        }
    }
}

fn on_line(x: usize, y: usize, x1: f64, y1: f64, x2: f64, y2: f64, width: f64) -> bool {
    let px = x as f64 + 0.5;
    let py = y as f64 + 0.5;
    let vx = x2 - x1;
    let vy = y2 - y1;
    let length_squared = vx * vx + vy * vy;
    if length_squared == 0.0 {
        return false;
    }
    let t = (((px - x1) * vx + (py - y1) * vy) / length_squared).clamp(0.0, 1.0);
    let nearest_x = x1 + t * vx;
    let nearest_y = y1 + t * vy;
    let dx = px - nearest_x;
    let dy = py - nearest_y;
    (dx * dx + dy * dy).sqrt() <= width
}

fn paint_pixel(rgba: &mut [u8], size: usize, x: usize, y: usize, alpha: u8) {
    let index = (y * size + x) * 4;
    rgba[index..index + 4].copy_from_slice(&[0, 0, 0, alpha]);
}
