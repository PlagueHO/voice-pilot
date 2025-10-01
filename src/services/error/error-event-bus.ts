import * as vscode from 'vscode';
import { Logger } from '../../core/logger';
import type {
  ErrorEventBus,
  ErrorEventHandler,
  SubscriptionOptions,
  VoicePilotError
} from '../../types/error/voice-pilot-error';

/**
 * Internal registration bookkeeping for error event handlers.
 *
 * @remarks
 * Each registered handler tracks its associated disposal callback and optional
 * subscription configuration, allowing the bus to honor domain and severity
 * filters as well as one-shot subscriptions.
 */
interface RegisteredHandler {
  /** Handler invoked when a matching error event is published. */
  handler: ErrorEventHandler;
  /** Optional subscription filters applied to the handler. */
  options?: SubscriptionOptions;
  /** Disposable that removes the handler from the bus when invoked. */
  disposable: vscode.Disposable;
  /** Indicates the handler should be invoked only once. */
  once?: boolean;
}

/**
 * In-memory implementation of the {@link ErrorEventBus} contract.
 *
 * @remarks
 * The bus coordinates asynchronous error notifications across the extension by
 * keeping lightweight handler registrations with optional filtering and
 * suppression logic to avoid repeated user-facing alerts.
 */
export class ErrorEventBusImpl implements ErrorEventBus {
  private readonly handlers = new Set<RegisteredHandler>();
  private readonly suppressionIndex = new Map<string, number>();
  private initialized = false;

  /**
   * Creates a new error event bus using the provided logger for diagnostics.
   *
   * @param logger - Structured logger used for handler failure reporting.
   */
  constructor(private readonly logger: Logger) {}

  /**
   * Marks the bus as ready to accept subscriptions.
   *
   * @remarks
   * The initialization flow is idempotent so repeated calls are inexpensive and
   * safe during extension startup sequences.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
  }

  /**
   * Indicates whether the bus has been initialized and is safe for use.
   *
   * @returns `true` when initialization has completed; otherwise `false`.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Disposes all registered handlers and resets suppression tracking.
   */
  dispose(): void {
    for (const entry of this.handlers) {
      try {
        entry.disposable.dispose();
      } catch (error: any) {
        this.logger.warn('Failed to dispose error handler', { error: error?.message ?? error });
      }
    }
    this.handlers.clear();
    this.suppressionIndex.clear();
    this.initialized = false;
  }

  /**
   * Registers a new handler for error events.
   *
   * @param handler - Callback executed when qualifying error events occur.
   * @param options - Optional filtering and lifecycle configuration.
   * @returns Disposable used to unregister the handler.
   */
  subscribe(handler: ErrorEventHandler, options?: SubscriptionOptions): vscode.Disposable {
    const disposable: vscode.Disposable = {
      dispose: () => {
        this.handlers.delete(registration);
      }
    };
    const registration: RegisteredHandler = { handler, options, disposable, once: options?.once };
    this.handlers.add(registration);
    return disposable;
  }

  /**
   * Publishes an error event to all subscribed handlers.
   *
   * @param error - The error payload to dispatch to subscribers.
   */
  async publish(error: VoicePilotError): Promise<void> {
    const suppressed = this.shouldSuppress(error);
    const event = suppressed
      ? {
          ...error,
          metadata: {
            ...(error.metadata ?? {}),
            notificationSuppressed: true
          }
        }
      : error;

    for (const registration of Array.from(this.handlers)) {
      if (registration.options?.domains && !registration.options.domains.includes(event.faultDomain)) {
        continue;
      }
      if (registration.options?.severities && !registration.options.severities.includes(event.severity)) {
        continue;
      }

      try {
        await registration.handler(event);
      } catch (handlerError: any) {
        this.logger.error('Error handler threw an exception', {
          error: handlerError?.message ?? handlerError,
          handler: registration.handler.name || 'anonymous'
        });
      } finally {
        if (registration.once) {
          registration.disposable.dispose();
        }
      }
    }
  }

  /**
   * Determines whether the provided error should trigger notifications.
   *
   * @param error - Error under evaluation.
   * @returns `true` when the error falls within its suppression window.
   */
  private shouldSuppress(error: VoicePilotError): boolean {
    const suppressionWindow = error.recoveryPlan?.suppressionWindowMs;
    if (!suppressionWindow || suppressionWindow <= 0) {
      return false;
    }

    const key = `${error.faultDomain}:${error.code}`;
    const now = Date.now();
    const lastNotified = this.suppressionIndex.get(key);
    if (lastNotified && now - lastNotified < suppressionWindow) {
      return true;
    }

    this.suppressionIndex.set(key, now);
    return false;
  }
}
