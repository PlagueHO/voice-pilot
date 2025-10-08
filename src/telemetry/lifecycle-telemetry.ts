import * as vscode from "vscode";

export type LifecyclePhase =
  | "config.initialized"
  | "auth.initialized"
  | "session.initialized"
  | "ui.initialized"
  | "activation.failed"
  | "config.disposed"
  | "auth.disposed"
  | "session.disposed"
  | "ui.disposed";

export type LifecycleListener = (event: LifecyclePhase) => void;

class LifecycleTelemetry {
  private readonly events: LifecyclePhase[] = [];
  private readonly listeners = new Set<LifecycleListener>();

  record(event: LifecyclePhase): void {
    this.events.push(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.warn("Lifecycle telemetry listener failed", error);
      }
    }
  }

  getEvents(): readonly LifecyclePhase[] {
    return [...this.events];
  }

  reset(): void {
    this.events.length = 0;
  }

  onEvent(listener: LifecycleListener): vscode.Disposable {
    this.listeners.add(listener);
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }
}

export const lifecycleTelemetry = new LifecycleTelemetry();
