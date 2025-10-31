import { Disposable } from "vscode";
import { Logger } from "../../core/logger";
import type {
    IntentContext,
    IntentExecutedEvent,
    IntentExecutedHandler,
    IntentHandler,
    IntentHandlerResult,
    IntentResult,
} from "../intent-processor";

/**
 * Registry managing intent handlers and execution orchestration.
 */
export class IntentHandlerRegistry {
  private readonly logger: Logger;
  private readonly handlers = new Map<string, IntentHandler[]>();
  private readonly executedListeners = new Set<IntentExecutedHandler>();

  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger("IntentHandlerRegistry");
  }

  /**
   * Register a handler for a specific intent type.
   */
  registerHandler(intentType: string, handler: IntentHandler): Disposable {
    if (!this.handlers.has(intentType)) {
      this.handlers.set(intentType, []);
    }

    const list = this.handlers.get(intentType)!;
    list.push(handler);
    list.sort((a, b) => b.getPriority() - a.getPriority());

    this.logger.debug("Handler registered", {
      intentType,
      priority: handler.getPriority(),
    });

    return new Disposable(() => {
      const idx = list.indexOf(handler);
      if (idx >= 0) {
        list.splice(idx, 1);
      }
    });
  }

  /**
   * Execute intent by finding and invoking the appropriate handler.
   */
  async execute(
    intent: IntentResult,
    context: IntentContext,
  ): Promise<IntentHandlerResult> {
    const startTime = performance.now();

    // Find matching handlers
    const candidates = this.findHandlers(intent);

    if (candidates.length === 0) {
      this.logger.warn("No handler found for intent", {
        intentId: intent.intentId,
      });

      return {
        success: false,
        message: `No handler registered for intent: ${intent.intentId}`,
        error: {
          code: "HANDLER_NOT_FOUND",
          message: `No handler found for ${intent.intentId}`,
          recoverable: false,
        },
      };
    }

    // Execute highest priority handler
    const handler = candidates[0];
    try {
      this.logger.debug("Executing intent handler", {
        intentId: intent.intentId,
        handler: handler.constructor.name,
      });

      const result = await handler.execute(intent, context);
      const executionTimeMs = performance.now() - startTime;

      // Emit executed event
      this.emitExecuted({
        type: "intent-executed",
        sessionId: context.sessionId,
        intentId: intent.intentId,
        handlerResult: result,
        executionTimeMs,
        timestamp: new Date().toISOString(),
      });

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("Intent handler execution failed", {
        intentId: intent.intentId,
        error: message,
      });

      return {
        success: false,
        message: `Handler execution failed: ${message}`,
        error: {
          code: "HANDLER_EXECUTION_FAILED",
          message,
          recoverable: true,
        },
      };
    }
  }

  /**
   * Subscribe to intent executed events.
   */
  onIntentExecuted(handler: IntentExecutedHandler): Disposable {
    this.executedListeners.add(handler);
    return new Disposable(() => {
      this.executedListeners.delete(handler);
    });
  }

  /**
   * Find handlers capable of processing the intent.
   */
  private findHandlers(intent: IntentResult): IntentHandler[] {
    const exactMatches = this.handlers.get(intent.intentId) ?? [];
    const categoryMatches = this.handlers.get(intent.category) ?? [];
    const wildcardMatches = this.handlers.get("*") ?? [];

    const allHandlers = [...exactMatches, ...categoryMatches, ...wildcardMatches];
    return allHandlers
      .filter((h) => h.canHandle(intent))
      .sort((a, b) => b.getPriority() - a.getPriority());
  }

  /**
   * Emit intent executed event to listeners.
   */
  private emitExecuted(event: IntentExecutedEvent): void {
    for (const listener of this.executedListeners) {
      try {
        const result = listener(event);
        if (result instanceof Promise) {
          void result.catch((err) =>
            this.logger.error("Intent executed handler failed", {
              error: err?.message ?? err,
            }),
          );
        }
      } catch (err: unknown) {
        this.logger.error("Intent executed listener threw", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Clear all registered handlers.
   */
  dispose(): void {
    this.handlers.clear();
    this.executedListeners.clear();
  }
}
