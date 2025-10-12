export interface DisposalStepResult {
  name: string;
  durationMs: number;
  success: boolean;
  error?: Error;
  orphanCounts?: Partial<OrphanSnapshot>;
  skipped?: boolean;
}

export interface OrphanSnapshot {
  timers: number;
  audioNodes: number;
  mediaStreams: number;
  dataChannels: number;
  disposables: number;
}

export interface DisposalOptions {
  gracePeriodMs?: number;
  auditTrailId?: string;
  dryRun?: boolean;
}

export type DisposalReason =
  | "session-end"
  | "extension-deactivate"
  | "fatal-error"
  | "config-reload";

export interface ScopedDisposable {
  id: string;
  priority: number;
  dispose(reason: DisposalReason): Promise<void> | void;
  isDisposed(): boolean;
}

export interface DisposalReport {
  reason: DisposalReason;
  startedAt: number;
  completedAt: number;
  steps: DisposalStepResult[];
  orphanSnapshot: OrphanSnapshot;
  aggregatedError?: Error;
  dryRun: boolean;
  auditTrailId?: string;
}

export interface DisposalOrchestrator {
  initialize(): Promise<void>;
  dispose(): void;
  isInitialized(): boolean;
  register(resource: ScopedDisposable): void;
  disposeAll(reason: DisposalReason, options?: DisposalOptions): Promise<DisposalReport>;
}
