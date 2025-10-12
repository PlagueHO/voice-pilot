import type { TimerTracker } from "../core/disposal/resource-tracker";
import { Logger } from "../core/logger";

export interface TimerEventStatus {
  isActive: boolean;
  scheduledAt: Date;
  timeRemainingMs: number;
  intervalMs?: number;
  lastExecutedAt?: Date;
  nextExecutionAt?: Date;
}

export interface SessionTimerStatus {
  sessionId: string;
  renewalTimer?: TimerEventStatus;
  timeoutTimer?: TimerEventStatus;
  heartbeatTimer?: TimerEventStatus & { intervalMs: number };
}

type TimerType = "renewal" | "timeout" | "heartbeat";

interface TimerMetadataRecord {
  renewal?: { scheduledAt: Date; intervalMs: number };
  timeout?: { scheduledAt: Date; intervalMs: number };
  heartbeat?: { scheduledAt: Date; intervalMs: number; lastExecutedAt?: Date };
}

interface PausedStateRecord {
  renewal?: { remainingMs: number; originalScheduledAt: Date };
  timeout?: { remainingMs: number; originalScheduledAt: Date };
}

export class SessionTimerManagerImpl {
  private renewalTimers = new Map<string, NodeJS.Timeout>();
  private timeoutTimers = new Map<string, NodeJS.Timeout>();
  private heartbeatTimers = new Map<string, NodeJS.Timeout>();
  private pausedTimers = new Map<string, PausedStateRecord>();
  private timerMetadata = new Map<string, TimerMetadataRecord>();
  private readonly trackerCleanup = new Map<
    string,
    Map<TimerType, () => void>
  >();

  constructor(
    private readonly logger: Logger,
    private readonly onRenewalRequired: (sessionId: string) => Promise<void>,
    private readonly onTimeoutExpired: (sessionId: string) => Promise<void>,
    private readonly onHeartbeatCheck: (sessionId: string) => Promise<void>,
    private resourceTracker?: TimerTracker,
  ) {}

  // Lifecycle ---------------------------------------------------------------
  startRenewalTimer(sessionId: string, renewAtMs: number) {
    this.clearRenewalTimer(sessionId);
    const now = Date.now();
    const timeUntilRenewal = renewAtMs - now;
    if (timeUntilRenewal <= 0) {
      // Trigger immediately synchronously (test determinism)
      this.logger.warn(
        "Renewal timer scheduled in the past; triggering immediately",
        { sessionId },
      );
      void this.triggerRenewal(sessionId);
      return;
    }
    const scheduledAt = new Date(renewAtMs);
    const timer = setTimeout(
      () => void this.triggerRenewal(sessionId),
      timeUntilRenewal,
    );
    this.renewalTimers.set(sessionId, timer);
    this.updateTimerMetadata(sessionId, "renewal", {
      scheduledAt,
      intervalMs: timeUntilRenewal,
    });
    this.registerTimerTracker(sessionId, "renewal");
    this.logger.debug("Renewal timer started", {
      sessionId,
      scheduledAt: scheduledAt.toISOString(),
      timeUntilRenewal,
    });
  }

  startTimeoutTimer(sessionId: string, timeoutMs: number) {
    this.clearTimeoutTimer(sessionId);
    const scheduledAt = new Date(Date.now() + timeoutMs);
    const timer = setTimeout(
      () => void this.triggerTimeout(sessionId),
      timeoutMs,
    );
    this.timeoutTimers.set(sessionId, timer);
    this.updateTimerMetadata(sessionId, "timeout", {
      scheduledAt,
      intervalMs: timeoutMs,
    });
    this.registerTimerTracker(sessionId, "timeout");
    this.logger.debug("Timeout timer started", { sessionId, timeoutMs });
  }

  startHeartbeatTimer(sessionId: string, intervalMs: number) {
    this.clearHeartbeatTimer(sessionId);
    const scheduledAt = new Date(Date.now() + intervalMs);
    const timer = setInterval(
      () => void this.triggerHeartbeat(sessionId),
      intervalMs,
    );
    this.heartbeatTimers.set(sessionId, timer as unknown as NodeJS.Timeout);
    this.updateTimerMetadata(sessionId, "heartbeat", {
      scheduledAt,
      intervalMs,
    });
    this.registerTimerTracker(sessionId, "heartbeat");
    this.logger.debug("Heartbeat timer started", { sessionId, intervalMs });
  }

  // Control ----------------------------------------------------------------
  clearAllTimers(sessionId: string) {
    this.clearRenewalTimer(sessionId);
    this.clearTimeoutTimer(sessionId);
    this.clearHeartbeatTimer(sessionId);
    this.pausedTimers.delete(sessionId);
    this.timerMetadata.delete(sessionId);
    this.trackerCleanup.delete(sessionId);
  }

  resetInactivityTimer(sessionId: string) {
    const meta = this.timerMetadata.get(sessionId)?.timeout;
    if (meta) {
      this.startTimeoutTimer(sessionId, meta.intervalMs);
    }
  }

  pauseTimers(sessionId: string) {
    const paused: PausedStateRecord = {};
    const now = Date.now();
    const renewalMeta = this.timerMetadata.get(sessionId)?.renewal;
    const renewalTimer = this.renewalTimers.get(sessionId);
    if (renewalMeta && renewalTimer) {
      clearTimeout(renewalTimer);
      this.renewalTimers.delete(sessionId);
      this.releaseTimerTracker(sessionId, "renewal");
      paused.renewal = {
        remainingMs: Math.max(0, renewalMeta.scheduledAt.getTime() - now),
        originalScheduledAt: renewalMeta.scheduledAt,
      };
    }
    const timeoutMeta = this.timerMetadata.get(sessionId)?.timeout;
    const timeoutTimer = this.timeoutTimers.get(sessionId);
    if (timeoutMeta && timeoutTimer) {
      clearTimeout(timeoutTimer);
      this.timeoutTimers.delete(sessionId);
      this.releaseTimerTracker(sessionId, "timeout");
      paused.timeout = {
        remainingMs: Math.max(0, timeoutMeta.scheduledAt.getTime() - now),
        originalScheduledAt: timeoutMeta.scheduledAt,
      };
    }
    this.pausedTimers.set(sessionId, paused);
  }

  resumeTimers(sessionId: string) {
    const paused = this.pausedTimers.get(sessionId);
    if (!paused) {
      return;
    }
    if (paused.renewal) {
      const ms = paused.renewal.remainingMs;
      if (ms > 0) {
        this.startRenewalTimer(sessionId, Date.now() + ms);
      } else {
        void this.triggerRenewal(sessionId);
      }
    }
    if (paused.timeout) {
      const ms = paused.timeout.remainingMs;
      if (ms > 0) {
        this.startTimeoutTimer(sessionId, ms);
      } else {
        void this.triggerTimeout(sessionId);
      }
    }
    this.pausedTimers.delete(sessionId);
  }

  // Status -----------------------------------------------------------------
  getTimerStatus(sessionId: string): SessionTimerStatus {
    const now = Date.now();
    const meta = this.timerMetadata.get(sessionId);
    const paused = this.pausedTimers.get(sessionId);
    const status: SessionTimerStatus = { sessionId };
    if (meta?.renewal) {
      const active = this.renewalTimers.has(sessionId);
      status.renewalTimer = {
        isActive: active,
        scheduledAt: meta.renewal.scheduledAt,
        timeRemainingMs: Math.max(0, meta.renewal.scheduledAt.getTime() - now),
      };
      if (!active && paused?.renewal) {
        status.renewalTimer.timeRemainingMs = paused.renewal.remainingMs;
      }
    }
    if (meta?.timeout) {
      const active = this.timeoutTimers.has(sessionId);
      status.timeoutTimer = {
        isActive: active,
        scheduledAt: meta.timeout.scheduledAt,
        timeRemainingMs: Math.max(0, meta.timeout.scheduledAt.getTime() - now),
      };
      if (!active && paused?.timeout) {
        status.timeoutTimer.timeRemainingMs = paused.timeout.remainingMs;
      }
    }
    if (meta?.heartbeat) {
      const active = this.heartbeatTimers.has(sessionId);
      const lastBase =
        meta.heartbeat.lastExecutedAt?.getTime() ||
        meta.heartbeat.scheduledAt.getTime();
      const nextExecutionAt = new Date(lastBase + meta.heartbeat.intervalMs);
      status.heartbeatTimer = {
        isActive: active,
        scheduledAt: meta.heartbeat.scheduledAt,
        timeRemainingMs: Math.max(0, nextExecutionAt.getTime() - now),
        intervalMs: meta.heartbeat.intervalMs,
        lastExecutedAt: meta.heartbeat.lastExecutedAt,
        nextExecutionAt,
      };
    }
    return status;
  }

  getNextScheduledEvent(sessionId: string) {
    const status = this.getTimerStatus(sessionId);
    const events: Array<{
      type: TimerType;
      sessionId: string;
      scheduledAt: Date;
      timeRemainingMs: number;
    }> = [];
    if (status.renewalTimer?.isActive) {
      events.push({
        type: "renewal",
        sessionId,
        scheduledAt: status.renewalTimer.scheduledAt,
        timeRemainingMs: status.renewalTimer.timeRemainingMs,
      });
    }
    if (status.timeoutTimer?.isActive) {
      events.push({
        type: "timeout",
        sessionId,
        scheduledAt: status.timeoutTimer.scheduledAt,
        timeRemainingMs: status.timeoutTimer.timeRemainingMs,
      });
    }
    if (
      status.heartbeatTimer?.isActive &&
      status.heartbeatTimer.nextExecutionAt
    ) {
      events.push({
        type: "heartbeat",
        sessionId,
        scheduledAt: status.heartbeatTimer.nextExecutionAt,
        timeRemainingMs:
          status.heartbeatTimer.nextExecutionAt.getTime() - Date.now(),
      });
    }
    return events.sort((a, b) => a.timeRemainingMs - b.timeRemainingMs)[0];
  }

  // Internal triggers -------------------------------------------------------
  private async triggerRenewal(sessionId: string) {
    try {
      this.renewalTimers.delete(sessionId);
      await this.onRenewalRequired(sessionId);
    } catch (e: any) {
      this.logger.error("Renewal callback failed", {
        sessionId,
        error: e.message,
      });
    }
  }
  private async triggerTimeout(sessionId: string) {
    try {
      this.timeoutTimers.delete(sessionId);
      await this.onTimeoutExpired(sessionId);
    } catch (e: any) {
      this.logger.error("Timeout callback failed", {
        sessionId,
        error: e.message,
      });
    }
  }
  private async triggerHeartbeat(sessionId: string) {
    try {
      const meta = this.timerMetadata.get(sessionId);
      if (meta?.heartbeat) {
        meta.heartbeat.lastExecutedAt = new Date();
      }
      await this.onHeartbeatCheck(sessionId);
    } catch (e: any) {
      this.logger.error("Heartbeat callback failed", {
        sessionId,
        error: e.message,
      });
    }
  }

  // Helpers ----------------------------------------------------------------
  private clearRenewalTimer(sessionId: string) {
    const t = this.renewalTimers.get(sessionId);
    if (t) {
      clearTimeout(t);
      this.renewalTimers.delete(sessionId);
      this.releaseTimerTracker(sessionId, "renewal");
    }
  }
  private clearTimeoutTimer(sessionId: string) {
    const t = this.timeoutTimers.get(sessionId);
    if (t) {
      clearTimeout(t);
      this.timeoutTimers.delete(sessionId);
      this.releaseTimerTracker(sessionId, "timeout");
    }
  }
  private clearHeartbeatTimer(sessionId: string) {
    const t = this.heartbeatTimers.get(sessionId);
    if (t) {
      clearInterval(t);
      this.heartbeatTimers.delete(sessionId);
      this.releaseTimerTracker(sessionId, "heartbeat");
    }
  }
  private updateTimerMetadata(sessionId: string, type: TimerType, data: any) {
    const meta = this.timerMetadata.get(sessionId) || {};
    (meta as any)[type] = data;
    this.timerMetadata.set(sessionId, meta);
  }

  private registerTimerTracker(sessionId: string, type: TimerType): void {
    if (!this.resourceTracker) {
      return;
    }
    const resourceId = `${sessionId}:${type}`;
    const cleanup = this.resourceTracker.trackTimer(resourceId);
    let sessionMap = this.trackerCleanup.get(sessionId);
    if (!sessionMap) {
      sessionMap = new Map();
      this.trackerCleanup.set(sessionId, sessionMap);
    }
    const existing = sessionMap.get(type);
    if (existing) {
      existing();
    }
    sessionMap.set(type, cleanup);
  }

  private releaseTimerTracker(sessionId: string, type: TimerType): void {
    const sessionMap = this.trackerCleanup.get(sessionId);
    const cleanup = sessionMap?.get(type);
    if (cleanup) {
      cleanup();
      sessionMap?.delete(type);
    }
    if (sessionMap && sessionMap.size === 0) {
      this.trackerCleanup.delete(sessionId);
    }
  }

  dispose() {
    for (const id of this.renewalTimers.keys()) {
      this.clearAllTimers(id);
    }
    for (const id of this.timeoutTimers.keys()) {
      this.clearAllTimers(id);
    }
    for (const id of this.heartbeatTimers.keys()) {
      this.clearAllTimers(id);
    }
    this.renewalTimers.clear();
    this.timeoutTimers.clear();
    this.heartbeatTimers.clear();
    this.pausedTimers.clear();
    this.timerMetadata.clear();
    this.trackerCleanup.clear();
  }

  setResourceTracker(tracker?: TimerTracker): void {
    this.resourceTracker = tracker;
  }
}
