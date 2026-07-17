#[derive(Debug, Default)]
pub struct LifecycleState {
    daemon_running: bool,
    ui_running: bool,
    quitting: bool,
}

impl LifecycleState {
    pub fn running() -> Self {
        Self {
            daemon_running: true,
            ui_running: true,
            quitting: false,
        }
    }

    pub fn daemon_running(&self) -> bool {
        self.daemon_running
    }

    pub fn ui_running(&self) -> bool {
        self.ui_running
    }

    pub fn is_quitting(&self) -> bool {
        self.quitting
    }

    pub fn daemon_started(&mut self) {
        self.daemon_running = true;
    }

    pub fn ui_started(&mut self) {
        self.ui_running = true;
    }

    pub fn close_main_window(&mut self) {
        self.ui_running = false;
    }

    pub fn pause_background(&mut self) {
        self.daemon_running = false;
    }

    pub fn quit(&mut self) {
        self.quitting = true;
        self.ui_running = false;
        self.daemon_running = false;
    }
}

#[cfg(test)]
mod tests {
    use super::LifecycleState;

    #[test]
    fn closing_last_window_stops_ui_but_keeps_daemon() {
        let mut state = LifecycleState::running();
        state.close_main_window();
        assert!(state.daemon_running());
        assert!(!state.ui_running());
    }

    #[test]
    fn quit_stops_both_children() {
        let mut state = LifecycleState::running();
        state.quit();
        assert!(!state.daemon_running());
        assert!(!state.ui_running());
        assert!(state.is_quitting());
    }

    #[test]
    fn paused_background_can_be_resumed_without_opening_ui() {
        let mut state = LifecycleState::running();
        state.close_main_window();
        state.pause_background();
        state.daemon_started();
        assert!(state.daemon_running());
        assert!(!state.ui_running());
    }
}
