(() => {
  const knownTypes = new Set([
    "AIHR_CONTENT_PING",
    "AIHR_WEB_GET_STATUS",
    "AIHR_WEB_STATUS_RESULT",
    "AIHR_WEB_STOP_CAPTURE",
    "AIHR_WEB_STOP_RESULT",
    "AIHR_WEB_RESUME_CAPTURE",
    "AIHR_WEB_RESUME_RESULT",
    "AIHR_WEB_CLEAR_STATUS",
    "AIHR_WEB_CLEAR_RESULT",
    "AIHR_WEB_RELOAD_EXTENSION",
    "AIHR_WEB_RELOAD_RESULT",
    "AIHR_WEB_SET_BACKGROUND_SYNC",
    "AIHR_WEB_BACKGROUND_SYNC_RESULT",
    "AIHR_WEB_START_CAPTURE",
    "AIHR_WEB_START_RESULT"
  ]);

  function validate(message) {
    if (!message || typeof message !== "object" || !knownTypes.has(message.type)) {
      return { ok: false, error: "Unknown message type." };
    }

    if (
      message.protocolVersion !== undefined &&
      message.protocolVersion !== globalThis.AIHR_CONSTANTS.protocolVersion
    ) {
      return { ok: false, error: "Incompatible protocol version." };
    }

    return { ok: true };
  }

  globalThis.AIHR_PROTOCOL = Object.freeze({ validate });
})();
