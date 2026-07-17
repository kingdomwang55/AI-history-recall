use crate::{
    lifecycle::LifecycleState,
    sidecars::{spawn_node_sidecar, RunningSidecar},
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

const DAEMON_PORT: u16 = 32145;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DesktopConfig {
    token: String,
    daemon_port: u16,
}

#[derive(Debug)]
struct RuntimeInner {
    lifecycle: LifecycleState,
    daemon: Option<RunningSidecar>,
    ui: Option<RunningSidecar>,
}

#[derive(Debug)]
pub struct AppRuntime {
    data_dir: PathBuf,
    resource_dir: PathBuf,
    config: DesktopConfig,
    inner: Mutex<RuntimeInner>,
}

impl AppRuntime {
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("app data directory: {error}"))?;
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|error| format!("packaged resource directory: {error}"))?;
        fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
        restrict_directory(&data_dir)?;
        let config_path = data_dir.join("desktop.json");
        let config = if config_path.exists() {
            let config =
                serde_json::from_slice(&fs::read(&config_path).map_err(|error| error.to_string())?)
                    .map_err(|error| format!("Invalid desktop configuration: {error}"))?;
            restrict_file(&config_path)?;
            config
        } else {
            let mut token = [0_u8; 32];
            rand::rng().fill_bytes(&mut token);
            let config = DesktopConfig {
                token: token.iter().map(|byte| format!("{byte:02x}")).collect(),
                daemon_port: DAEMON_PORT,
            };
            fs::write(
                &config_path,
                serde_json::to_vec_pretty(&config).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            restrict_file(&config_path)?;
            config
        };
        Ok(Self {
            data_dir,
            resource_dir,
            config,
            inner: Mutex::new(RuntimeInner {
                lifecycle: LifecycleState::default(),
                daemon: None,
                ui: None,
            }),
        })
    }

    pub async fn ensure_daemon<R: Runtime>(&self, _app: &AppHandle<R>) -> Result<u16, String> {
        if let Some(port) = self
            .inner
            .lock()
            .map_err(lock_error)?
            .daemon
            .as_ref()
            .map(|item| item.port)
        {
            return Ok(port);
        }
        let daemon_dir = self.resource_dir.join("resources/daemon");
        let node_runtime = self.node_runtime_path();
        let mut environment = self.shared_environment();
        environment.insert(
            "AIHR_DAEMON_PORT".into(),
            self.config.daemon_port.to_string(),
        );
        environment.insert(
            "AIHR_DATA_DIR".into(),
            self.data_dir.to_string_lossy().into_owned(),
        );
        let child = spawn_node_sidecar(
            &node_runtime,
            &daemon_dir.join("daemon.mjs"),
            &daemon_dir,
            &environment,
            "Background service",
        )
        .await
        .map_err(|error| {
            format!(
                "Unable to start local service on port {}: {error}",
                self.config.daemon_port
            )
        })?;
        let port = child.port;
        let mut inner = self.inner.lock().map_err(lock_error)?;
        inner.daemon = Some(child);
        inner.lifecycle.daemon_started();
        Ok(port)
    }

    pub async fn open_main_window<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        route: &str,
    ) -> Result<(), String> {
        let route = self.initial_route(route);
        if let Some(window) = app.get_webview_window("main") {
            if route != "/" {
                let port = self.ui_port()?;
                window
                    .navigate(
                        format!("http://127.0.0.1:{port}{route}")
                            .parse()
                            .map_err(|error| format!("Invalid UI URL: {error}"))?,
                    )
                    .map_err(|error| error.to_string())?;
            }
            window.show().map_err(|error| error.to_string())?;
            window.set_focus().map_err(|error| error.to_string())?;
            return Ok(());
        }
        self.ensure_daemon(app).await?;
        let port = self.ensure_ui(app).await?;
        let url = format!("http://127.0.0.1:{port}{route}")
            .parse()
            .map_err(|error| format!("Invalid UI URL: {error}"))?;
        WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
            .initialization_script(self.bootstrap_script())
            .title("AI History Recall")
            .inner_size(1180.0, 780.0)
            .min_inner_size(840.0, 600.0)
            .build()
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    async fn ensure_ui<R: Runtime>(&self, _app: &AppHandle<R>) -> Result<u16, String> {
        if let Some(port) = self
            .inner
            .lock()
            .map_err(lock_error)?
            .ui
            .as_ref()
            .map(|item| item.port)
        {
            return Ok(port);
        }
        let ui_dir = self.resource_dir.join("resources/ui");
        let node_runtime = self.node_runtime_path();
        let child = spawn_node_sidecar(
            &node_runtime,
            &ui_dir.join("launcher.mjs"),
            &ui_dir,
            &self.shared_environment(),
            "Desktop interface",
        )
        .await?;
        let port = child.port;
        let mut inner = self.inner.lock().map_err(lock_error)?;
        inner.ui = Some(child);
        inner.lifecycle.ui_started();
        Ok(port)
    }

    pub fn close_main_window(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(lock_error)?;
        if let Some(child) = inner.ui.take() {
            child.stop()?;
        }
        inner.lifecycle.close_main_window();
        Ok(())
    }

    pub fn pause_background(&self) -> Result<bool, String> {
        let mut inner = self.inner.lock().map_err(lock_error)?;
        if let Some(child) = inner.daemon.take() {
            child.stop()?;
            inner.lifecycle.pause_background();
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn is_background_running(&self) -> Result<bool, String> {
        Ok(self
            .inner
            .lock()
            .map_err(lock_error)?
            .lifecycle
            .daemon_running())
    }

    pub fn close_to_tray(&self) -> bool {
        let settings_path = self.data_dir.join("desktop-settings.json");
        fs::read(settings_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .and_then(|value| {
                value
                    .get("closeToTray")
                    .and_then(serde_json::Value::as_bool)
            })
            .unwrap_or(true)
    }

    pub fn sync_now(&self) -> Result<(), String> {
        let port = self.daemon_port()?;
        ureq::post(format!("http://127.0.0.1:{port}/api/knowledge/process"))
            .header("X-AIHR-API-Token", &self.config.token)
            .send_empty()
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn shutdown(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(lock_error)?;
        if let Some(child) = inner.ui.take() {
            let _ = child.stop();
        }
        if let Some(child) = inner.daemon.take() {
            let _ = child.stop();
        }
        inner.lifecycle.quit();
        Ok(())
    }

    fn daemon_port(&self) -> Result<u16, String> {
        self.inner
            .lock()
            .map_err(lock_error)?
            .daemon
            .as_ref()
            .map(|item| item.port)
            .ok_or_else(|| "Background service is not running".to_string())
    }

    fn ui_port(&self) -> Result<u16, String> {
        self.inner
            .lock()
            .map_err(lock_error)?
            .ui
            .as_ref()
            .map(|item| item.port)
            .ok_or_else(|| "Desktop interface is not running".to_string())
    }

    fn shared_environment(&self) -> HashMap<String, String> {
        HashMap::from([
            (
                "AIHR_DB_PATH".into(),
                self.data_dir
                    .join("ai-history-recall.sqlite")
                    .to_string_lossy()
                    .into_owned(),
            ),
            ("AIHR_API_TOKEN".into(), self.config.token.clone()),
            (
                "AIHR_DESKTOP_RESOURCE_DIR".into(),
                self.resource_dir.to_string_lossy().into_owned(),
            ),
        ])
    }

    fn initial_route<'a>(&self, requested: &'a str) -> &'a str {
        let state = fs::read(self.data_dir.join("onboarding.json")).ok();
        if requested == "/" && !onboarding_is_complete(state.as_deref()) {
            "/onboarding"
        } else {
            requested
        }
    }

    fn node_runtime_path(&self) -> PathBuf {
        let file_name = if cfg!(windows) {
            "aihr-node.exe"
        } else {
            "aihr-node"
        };
        self.resource_dir.join("resources/runtime").join(file_name)
    }

    fn bootstrap_script(&self) -> String {
        let token = serde_json::to_string(&self.config.token).expect("token must serialize");
        format!("window.localStorage.setItem('aihrLocalApiToken', {token});")
    }
}

fn onboarding_is_complete(value: Option<&[u8]>) -> bool {
    value
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(bytes).ok())
        .and_then(|state| state.get("firstData").and_then(serde_json::Value::as_bool))
        .unwrap_or(false)
}

fn lock_error<T>(error: std::sync::PoisonError<T>) -> String {
    format!("Desktop runtime lock was poisoned: {error}")
}

#[cfg(unix)]
fn restrict_directory(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|error| error.to_string())
}

#[cfg(windows)]
fn restrict_directory(path: &Path) -> Result<(), String> {
    restrict_windows_acl(path, true);
    Ok(())
}

#[cfg(unix)]
fn restrict_file(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| error.to_string())
}

#[cfg(windows)]
fn restrict_file(path: &Path) -> Result<(), String> {
    restrict_windows_acl(path, false);
    Ok(())
}

#[cfg(windows)]
fn restrict_windows_acl(path: &Path, directory: bool) {
    use std::process::Command;

    let Ok(username) = std::env::var("USERNAME") else {
        return;
    };
    let grant = if directory {
        format!("{username}:(OI)(CI)F")
    } else {
        format!("{username}:F")
    };
    let _ = Command::new("icacls")
        .arg(path)
        .args(["/inheritance:r", "/grant:r", &grant])
        .status();
}

#[cfg(test)]
mod tests {
    use super::onboarding_is_complete;

    #[test]
    fn partial_onboarding_resumes_until_first_data_is_complete() {
        assert!(!onboarding_is_complete(None));
        assert!(!onboarding_is_complete(Some(br#"{"storage":true}"#)));
        assert!(onboarding_is_complete(Some(
            br#"{"storage":true,"extension":true,"firstData":true}"#
        )));
    }
}
