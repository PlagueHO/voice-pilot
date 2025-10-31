const DEFAULT_LATENCY_MS = 32;

export function createAudioFeedbackPlayer({ postMessage }) {
  const activeCues = new Map();
  let degradeState = {
    degraded: false,
    reason: undefined,
  };
  let currentConfig = {
    accessibilityProfile: "standard",
    duckStrategy: "none",
    categoryGains: {},
  };

  function dispose() {
    activeCues.forEach((handle) => {
      clearTimeout(handle.timer);
    });
    activeCues.clear();
  }

  function updateState(payload) {
    degradeState = {
      degraded: Boolean(payload?.degraded),
      reason: payload?.reason,
    };
    if (!degradeState.degraded) {
      activeCues.forEach((handle, handleId) => {
        if (!handle.completed) {
          scheduleComplete(handleId, handle.cueId, handle.startedAt);
        }
      });
    }
  }

  function applyConfigure(command) {
    currentConfig = {
      accessibilityProfile: command.accessibilityProfile,
      duckStrategy: command.duckStrategy,
      categoryGains: command.categoryGains,
    };
  }

  function handleControl(message) {
    const command = message?.payload;
    if (!command || typeof command.command !== "string") {
      return;
    }

    switch (command.command) {
      case "configure":
        applyConfigure(command);
        break;
      case "play":
        handlePlay(command);
        break;
      case "stop":
        handleStop(command);
        break;
      default:
        break;
    }
  }

  function handlePlay(command) {
    const { handleId, cueId } = command;
    if (degradeState.degraded) {
      emitEvent({
        handleId,
        cueId,
        status: "suppressed",
      });
      return;
    }

    const startedAt = performance.now();
    const timer = setTimeout(() => {
      scheduleComplete(handleId, cueId, startedAt);
    }, Math.max(0, DEFAULT_LATENCY_MS));

    activeCues.set(handleId, {
      timer,
      cueId,
      startedAt,
      completed: false,
    });
  }

  function handleStop(command) {
    const handleId = command.handleId;
    if (!handleId) {
      activeCues.forEach((_, id) => stopHandle(id));
      return;
    }
    stopHandle(handleId);
  }

  function stopHandle(handleId) {
    const entry = activeCues.get(handleId);
    if (!entry) {
      return;
    }
    clearTimeout(entry.timer);
    activeCues.delete(handleId);
    emitEvent({
      handleId,
      cueId: entry.cueId,
      status: "stopped",
    });
  }

  function scheduleComplete(handleId, cueId, startedAt) {
    const entry = activeCues.get(handleId);
    if (!entry) {
      emitEvent({
        handleId,
        cueId,
        status: "suppressed",
      });
      return;
    }
    entry.completed = true;
    activeCues.delete(handleId);
    emitEvent({
      handleId,
      cueId,
      status: "played",
      latencyMs: performance.now() - startedAt,
    });
  }

  function emitEvent(payload) {
    try {
      postMessage({
        type: "audioFeedback.event",
        payload,
      });
    } catch (error) {
      console.warn("Agent Voice: Failed to emit audio feedback event", error);
    }
  }

  return {
    handleControl,
    updateState,
    dispose,
    getConfig: () => ({ ...currentConfig }),
    getState: () => ({ ...degradeState }),
  };
}
