use serde::Deserialize;
use std::{collections::HashMap, path::Path, time::Duration};
use tauri::{AppHandle, Runtime};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

#[derive(Debug, Deserialize)]
struct ReadyLine {
    ready: bool,
    port: u16,
}

#[derive(Debug)]
pub struct RunningSidecar {
    child: CommandChild,
    pub port: u16,
}

impl RunningSidecar {
    pub fn stop(self) -> Result<(), String> {
        self.child.kill().map_err(|error| error.to_string())
    }
}

pub async fn spawn_node_sidecar<R: Runtime>(
    app: &AppHandle<R>,
    entrypoint: &Path,
    working_directory: &Path,
    environment: &HashMap<String, String>,
    label: &str,
) -> Result<RunningSidecar, String> {
    let command = app
        .shell()
        .sidecar("aihr-node")
        .map_err(|error| error.to_string())?
        .arg(entrypoint)
        .current_dir(working_directory)
        .envs(environment);
    let (mut events, child) = command.spawn().map_err(|error| error.to_string())?;
    let mut last_error = String::new();
    let readiness = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            match events.recv().await {
                Some(CommandEvent::Stdout(bytes)) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if let Ok(ready) = serde_json::from_str::<ReadyLine>(line.trim()) {
                        if ready.ready {
                            return Ok(ready.port);
                        }
                    }
                }
                Some(CommandEvent::Stderr(bytes)) => {
                    last_error = String::from_utf8_lossy(&bytes).trim().to_string();
                }
                Some(CommandEvent::Error(error)) => return Err(error),
                Some(CommandEvent::Terminated(status)) => {
                    return Err(format!(
                        "{label} exited before readiness: {:?}",
                        status.code
                    ));
                }
                _ => return Err(format!("{label} output stream closed before readiness")),
            }
        }
    })
    .await;

    match readiness {
        Ok(Ok(port)) => Ok(RunningSidecar { child, port }),
        Ok(Err(error)) => {
            let _ = child.kill();
            if last_error.is_empty() {
                Err(error)
            } else {
                Err(format!("{error}: {last_error}"))
            }
        }
        Err(_) => {
            let _ = child.kill();
            Err(format!("{label} did not become ready within 20 seconds"))
        }
    }
}
