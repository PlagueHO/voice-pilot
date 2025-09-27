import * as vscode from 'vscode';
import { Logger } from '../../core/logger';
import type {
    ErrorEventBus,
    ErrorEventHandler,
    SubscriptionOptions,
    VoicePilotError
} from '../../types/error/voice-pilot-error';

interface RegisteredHandler {
  handler: ErrorEventHandler;
  options?: SubscriptionOptions;
  disposable: vscode.Disposable;
  once?: boolean;
}

export class ErrorEventBusImpl implements ErrorEventBus {
  private readonly handlers = new Set<RegisteredHandler>();
  private readonly suppressionIndex = new Map<string, number>();
  private initialized = false;

  constructor(private readonly logger: Logger) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

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
