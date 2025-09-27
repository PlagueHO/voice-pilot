import * as vscode from "vscode";
import { Logger } from "../core/logger";
import { ServiceInitializable } from "../core/service-initializable";
import { TurnDetectionConfig } from "../types/configuration";
import {
  createDefaultTurnDetectionConfig,
  normalizeTurnDetectionConfig,
} from "./turn-detection-defaults";

export type TurnDetectionEventType =
  | "mode-changed"
  | "speech-start-detached"
  | "speech-stop-detached"
  | "fallback-engaged"
  | "config-updated";

export interface TurnDetectionDiagnostics {
  avgStartLatencyMs: number;
  avgStopLatencyMs: number;
  missedEvents: number;
  fallbackActive: boolean;
}

export interface TurnDetectionState {
  mode: TurnDetectionConfig["type"];
  lastSpeechStart?: number;
  lastSpeechStop?: number;
  pendingResponse?: boolean;
  diagnostics: TurnDetectionDiagnostics;
}

export interface RealtimeTurnEvent {
  type: "speech-start" | "speech-stop" | "response-interrupted" | "degraded";
  timestamp: number;
  serverEvent?: any;
  latencyMs?: number;
}

export interface TurnDetectionCoordinatorEvent {
  type: TurnDetectionEventType;
  state: TurnDetectionState;
  event?: RealtimeTurnEvent;
  config?: TurnDetectionConfig;
  previousMode?: TurnDetectionConfig["type"];
  metadata?: Record<string, unknown>;
}

export type TurnDetectionEventListener = (
  event: TurnDetectionCoordinatorEvent,
) => void | Promise<void>;

export interface HybridFallbackAdapter {
  enable(): Promise<void>;
  disable(): Promise<void>;
  processFrame(frame: Int16Array, timestamp: number): void;
}

export interface TurnDetectionCoordinator extends ServiceInitializable {
  configure(params: TurnDetectionConfig): Promise<void>;
  handleServerEvent(event: RealtimeTurnEvent): void;
  requestModeChange(mode: TurnDetectionConfig["type"]): Promise<void>;
  getState(): TurnDetectionState;
  on(
    event: TurnDetectionEventType,
    listener: TurnDetectionEventListener,
  ): vscode.Disposable;
  registerFallbackAdapter(adapter: HybridFallbackAdapter | undefined): void;
}

interface LatencyAccumulator {
  sum: number;
  count: number;
}

export class AzureTurnDetectionCoordinator implements TurnDetectionCoordinator {
  private initialized = false;
  private readonly logger: Logger;
  private config: TurnDetectionConfig;
  private state: TurnDetectionState;
  private readonly listeners = new Map<
    TurnDetectionEventType,
    Set<TurnDetectionEventListener>
  >();
  private fallbackAdapter?: HybridFallbackAdapter;
  private readonly startLatency: LatencyAccumulator = { sum: 0, count: 0 };
  private readonly stopLatency: LatencyAccumulator = { sum: 0, count: 0 };

  constructor(initialConfig?: TurnDetectionConfig, logger?: Logger) {
    this.logger = logger ?? new Logger("TurnDetectionCoordinator");
    const normalized = normalizeTurnDetectionConfig(
      initialConfig ?? createDefaultTurnDetectionConfig(),
    );
    this.config = normalized;
    this.state = {
      mode: normalized.type,
      pendingResponse: normalized.createResponse,
      diagnostics: {
        avgStartLatencyMs: 0,
        avgStopLatencyMs: 0,
        missedEvents: 0,
        fallbackActive: false,
      },
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.logger.debug("Turn detection coordinator initialized", {
      mode: this.state.mode,
    });
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    if (this.fallbackAdapter) {
      void this.fallbackAdapter
        .disable()
        .catch((err) =>
          this.logger.error("Failed to disable fallback adapter on dispose", {
            error: err instanceof Error ? err.message : err,
          }),
        );
    }
    this.listeners.clear();
    this.initialized = false;
    this.logger.debug("Turn detection coordinator disposed");
  }

  async configure(params: TurnDetectionConfig): Promise<void> {
    this.ensureInitialized("configure");
    const normalized = normalizeTurnDetectionConfig(params);
    const previousMode = this.config.type;
    this.config = normalized;
    this.state.mode = normalized.type;
    this.state.pendingResponse = normalized.createResponse;
    this.emit("config-updated", { config: this.cloneConfig() });
    if (previousMode !== normalized.type) {
      this.syncFallbackForMode();
      this.emit("mode-changed", { config: this.cloneConfig(), previousMode });
    }
  }

  async requestModeChange(mode: TurnDetectionConfig["type"]): Promise<void> {
    await this.configure({ ...this.config, type: mode });
  }

  handleServerEvent(event: RealtimeTurnEvent): void {
    this.ensureInitialized("handleServerEvent");
    switch (event.type) {
      case "speech-start":
        this.state.lastSpeechStart = event.timestamp;
        this.state.pendingResponse = false;
        this.updateLatency("start", event);
        this.setFallbackState(false, "server_speech_start", event);
        this.emit("speech-start-detached", { event });
        break;
      case "speech-stop":
        this.state.lastSpeechStop = event.timestamp;
        this.state.pendingResponse = Boolean(
          event.serverEvent?.create_response ?? this.config.createResponse,
        );
        this.updateLatency("stop", event);
        this.setFallbackState(false, "server_speech_stop", event);
        this.emit("speech-stop-detached", { event });
        break;
      case "response-interrupted":
        this.state.pendingResponse = false;
        this.updateLatency("stop", event);
        this.setFallbackState(false, "server_response_interrupted", event);
        this.emit("speech-stop-detached", { event });
        break;
      case "degraded":
        this.state.diagnostics.missedEvents += 1;
        this.setFallbackState(true, "server_degraded", event);
        break;
      default:
        this.logger.warn("Unhandled realtime turn event type", { event });
        break;
    }
  }

  getState(): TurnDetectionState {
    return this.snapshotState();
  }

  on(
    event: TurnDetectionEventType,
    listener: TurnDetectionEventListener,
  ): vscode.Disposable {
    const bucket =
      this.listeners.get(event) ?? new Set<TurnDetectionEventListener>();
    bucket.add(listener);
    this.listeners.set(event, bucket);
    return new vscode.Disposable(() => {
      const current = this.listeners.get(event);
      if (!current) {
        return;
      }
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(event);
      }
    });
  }

  registerFallbackAdapter(adapter: HybridFallbackAdapter | undefined): void {
    if (this.fallbackAdapter && this.state.diagnostics.fallbackActive) {
      void this.fallbackAdapter
        .disable()
        .catch((err) =>
          this.logger.error("Failed to disable previous fallback adapter", {
            error: err instanceof Error ? err.message : err,
          }),
        );
    }
    this.fallbackAdapter = adapter;
    if (this.fallbackAdapter && this.state.diagnostics.fallbackActive) {
      void this.fallbackAdapter
        .enable()
        .catch((err) =>
          this.logger.error("Failed to enable fallback adapter", {
            error: err instanceof Error ? err.message : err,
          }),
        );
    }
  }

  private ensureInitialized(operation: string): void {
    if (!this.initialized) {
      throw new Error(
        `TurnDetectionCoordinator must be initialized before ${operation}`,
      );
    }
  }

  private updateLatency(
    kind: "start" | "stop",
    event: RealtimeTurnEvent,
  ): void {
    const latency =
      typeof event.latencyMs === "number"
        ? event.latencyMs
        : this.deriveLatency(event.timestamp);
    if (latency === undefined) {
      return;
    }
    const accumulator = kind === "start" ? this.startLatency : this.stopLatency;
    accumulator.sum += latency;
    accumulator.count += 1;
    const average = accumulator.sum / accumulator.count;
    if (kind === "start") {
      this.state.diagnostics.avgStartLatencyMs = average;
    } else {
      this.state.diagnostics.avgStopLatencyMs = average;
    }
  }

  private deriveLatency(timestamp: number | undefined): number | undefined {
    if (typeof timestamp !== "number" || Number.isNaN(timestamp)) {
      return undefined;
    }
    const delta = Date.now() - timestamp;
    return delta >= 0 ? delta : undefined;
  }

  private setFallbackState(
    active: boolean,
    reason: string,
    event?: RealtimeTurnEvent,
  ): void {
    if (this.state.diagnostics.fallbackActive === active) {
      return;
    }
    this.state.diagnostics.fallbackActive = active;
    const adapter = this.fallbackAdapter;
    if (adapter) {
      const op = active ? adapter.enable() : adapter.disable();
      void op.catch((err) =>
        this.logger.error("Failed to toggle fallback adapter", {
          error: err instanceof Error ? err.message : err,
          active,
        }),
      );
    } else if (active) {
      this.logger.warn("Fallback active without adapter");
    }
    this.emit("fallback-engaged", { event, metadata: { reason, active } });
  }

  private syncFallbackForMode(): void {
    if (this.state.mode === "none" && this.state.diagnostics.fallbackActive) {
      this.setFallbackState(false, "mode_switch_manual");
    }
  }

  private emit(
    type: TurnDetectionEventType,
    payload: Partial<TurnDetectionCoordinatorEvent> = {},
  ): void {
    const listeners = this.listeners.get(type);
    if (!listeners || listeners.size === 0) {
      return;
    }
    const event: TurnDetectionCoordinatorEvent = {
      type,
      state: this.snapshotState(),
      ...payload,
    };
    for (const listener of Array.from(listeners)) {
      try {
        const result = listener(event);
        if (result && typeof (result as Promise<void>).then === "function") {
          void (result as Promise<void>).catch((err) =>
            this.logger.error("Turn detection listener failed", {
              type,
              error: err instanceof Error ? err.message : err,
            }),
          );
        }
      } catch (err: any) {
        this.logger.error("Turn detection listener threw", {
          type,
          error: err instanceof Error ? err.message : err,
        });
      }
    }
  }

  private snapshotState(): TurnDetectionState {
    return {
      mode: this.state.mode,
      lastSpeechStart: this.state.lastSpeechStart,
      lastSpeechStop: this.state.lastSpeechStop,
      pendingResponse: this.state.pendingResponse,
      diagnostics: { ...this.state.diagnostics },
    };
  }

  private cloneConfig(): TurnDetectionConfig {
    return { ...this.config };
  }
}
