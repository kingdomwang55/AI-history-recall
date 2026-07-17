use serde::Deserialize;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader},
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::Duration,
};

#[derive(Debug, Deserialize)]
struct ReadyLine {
    ready: bool,
    port: u16,
}

#[derive(Debug)]
pub struct RunningSidecar {
    child: Child,
    pub port: u16,
}

impl RunningSidecar {
    pub fn stop(mut self) -> Result<(), String> {
        self.child.kill().map_err(|error| error.to_string())?;
        let _ = self.child.wait();
        Ok(())
    }
}

enum SidecarEvent {
    Ready(u16),
    Stderr(String),
    OutputClosed,
}

pub async fn spawn_node_sidecar(
    node_runtime: &Path,
    entrypoint: &Path,
    working_directory: &Path,
    environment: &HashMap<String, String>,
    label: &str,
) -> Result<RunningSidecar, String> {
    let node_runtime = node_runtime.to_path_buf();
    let entrypoint = entrypoint.to_path_buf();
    let working_directory = working_directory.to_path_buf();
    let environment = environment.clone();
    let label = label.to_string();
    tokio::task::spawn_blocking(move || {
        spawn_node_sidecar_blocking(
            &node_runtime,
            &entrypoint,
            &working_directory,
            &environment,
            &label,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

fn spawn_node_sidecar_blocking(
    node_runtime: &Path,
    entrypoint: &Path,
    working_directory: &Path,
    environment: &HashMap<String, String>,
    label: &str,
) -> Result<RunningSidecar, String> {
    let mut command = Command::new(node_runtime);
    command
        .arg(entrypoint)
        .current_dir(working_directory)
        .envs(environment)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("{label} stdout was not piped"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("{label} stderr was not piped"))?;
    let (sender, receiver) = mpsc::channel();

    {
        let sender = sender.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(ready) = serde_json::from_str::<ReadyLine>(line.trim()) {
                    if ready.ready {
                        let _ = sender.send(SidecarEvent::Ready(ready.port));
                        return;
                    }
                }
            }
            let _ = sender.send(SidecarEvent::OutputClosed);
        });
    }

    {
        let sender = sender.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = sender.send(SidecarEvent::Stderr(line));
            }
        });
    }

    let mut last_error = String::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            let _ = child.kill();
            return Err(format!(
                "{label} exited before readiness: {:?}{}",
                status.code(),
                if last_error.is_empty() {
                    String::new()
                } else {
                    format!(": {last_error}")
                }
            ));
        }

        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            let _ = child.kill();
            return Err(format!("{label} did not become ready within 20 seconds"));
        }

        match receiver.recv_timeout(remaining.min(Duration::from_millis(250))) {
            Ok(SidecarEvent::Ready(port)) => return Ok(RunningSidecar { child, port }),
            Ok(SidecarEvent::Stderr(error)) => last_error = error,
            Ok(SidecarEvent::OutputClosed) => {
                let _ = child.kill();
                if last_error.is_empty() {
                    return Err(format!("{label} output stream closed before readiness"));
                }
                return Err(format!(
                    "{label} output stream closed before readiness: {last_error}"
                ));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let _ = child.kill();
                return Err(format!("{label} output stream closed before readiness"));
            }
        }
    }
}
