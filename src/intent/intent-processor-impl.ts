import { Disposable } from "vscode";
import { Logger } from "../core/logger";
import { ServiceInitializable } from "../core/service-initializable";
import type { TranscriptFinalEvent } from "../types/speech-to-text";
import { HybridIntentClassifier } from "./classifiers/hybrid-intent-classifier";
import { RuleIntentClassifier } from "./classifiers/rule-intent-classifier";
import { EntityExtractor } from "./entities/entity-extractor";
import { IntentHandlerRegistry } from "./handlers/intent-handler-registry";
import type {
  ClassificationErrorHandler,
  IntentClassifiedHandler,
  IntentContext,
  IntentExecutedHandler,
  IntentHandler,
  IntentHistoryEntry,
  IntentPack,
  IntentProcessor,
  IntentResult,
} from "./intent-processor";

/**
 * Implementation of the intent processing service orchestrating classification and handler execution.
 */
export class IntentProcessorImpl implements IntentProcessor, ServiceInitializable {
  private readonly logger: Logger;
  private initialized = false;
  private readonly intentHistory = new Map<string, IntentHistoryEntry[]>();
  private readonly ruleClassifier: RuleIntentClassifier;
  private readonly hybridClassifier: HybridIntentClassifier;
  private readonly entityExtractor: EntityExtractor;
  private readonly handlerRegistry: IntentHandlerRegistry;
  private readonly classifiedListeners = new Set<IntentClassifiedHandler>();
  private readonly errorListeners = new Set<ClassificationErrorHandler>();

  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger("IntentProcessor");
    this.ruleClassifier = new RuleIntentClassifier(this.logger);
    this.hybridClassifier = new HybridIntentClassifier(
      this.ruleClassifier,
      undefined, // LLM classifier not initialized by default
      0.1,
      this.logger,
    );
    this.entityExtractor = new EntityExtractor(this.logger);
    this.handlerRegistry = new IntentHandlerRegistry(this.logger);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.debug("IntentProcessor initializing");
    this.initialized = true;
    this.logger.info("IntentProcessor initialized");
  }

  dispose(): void {
    this.logger.debug("IntentProcessor disposing");
    this.intentHistory.clear();
    this.handlerRegistry.dispose();
    this.classifiedListeners.clear();
    this.errorListeners.clear();
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async classifyIntent(
    transcript: TranscriptFinalEvent,
    context: IntentContext,
  ): Promise<IntentResult> {
    this.ensureInitialized("classifyIntent");

    try {
      // Classify using hybrid classifier
      const result = await this.hybridClassifier.classify(
        transcript.content,
        context,
      );

      // Extract entities from transcript
      const entities = await this.entityExtractor.extract(
        transcript.content,
        context.workspaceContext,
      );
      result.entities = entities;

      // Record in history
      this.addToHistory(context.sessionId, {
        intentResult: result,
        transcript: transcript.content,
        timestamp: result.timestamp,
      });

      // Emit classified event
      this.emitClassified({
        type: "intent-classified",
        sessionId: context.sessionId,
        intentResult: result,
        transcript: transcript.content,
        context,
        timestamp: result.timestamp,
      });

      this.logger.debug("Intent classified", {
        intentId: result.intentId,
        confidence: result.confidence,
        processingTimeMs: result.metadata.processingTimeMs,
      });

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("Intent classification failed", { error: message });
      throw error;
    }
  }

  registerHandler(intentType: string, handler: IntentHandler): Disposable {
    this.ensureInitialized("registerHandler");
    return this.handlerRegistry.registerHandler(intentType, handler);
  }

  async registerIntentPack(pack: IntentPack): Promise<void> {
    this.ensureInitialized("registerIntentPack");

    // Basic validation
    if (!pack.id || !pack.name || !pack.version) {
      throw new Error("Intent pack missing required fields (id, name, version)");
    }

    this.ruleClassifier.registerIntentPack(pack);
    this.logger.info("Intent pack registered", {
      id: pack.id,
      version: pack.version,
      intents: pack.intents.length,
    });
  }

  getIntentHistory(sessionId: string): IntentHistoryEntry[] {
    return this.intentHistory.get(sessionId) ?? [];
  }

  async clearIntentHistory(sessionId: string): Promise<void> {
    this.intentHistory.delete(sessionId);
    this.logger.debug("Intent history cleared", { sessionId });
  }

  onIntentClassified(handler: IntentClassifiedHandler): Disposable {
    this.classifiedListeners.add(handler);
    return new Disposable(() => {
      this.classifiedListeners.delete(handler);
    });
  }

  onIntentExecuted(handler: IntentExecutedHandler): Disposable {
    return this.handlerRegistry.onIntentExecuted(handler);
  }

  onClassificationError(handler: ClassificationErrorHandler): Disposable {
    this.errorListeners.add(handler);
    return new Disposable(() => {
      this.errorListeners.delete(handler);
    });
  }

  private addToHistory(sessionId: string, entry: IntentHistoryEntry): void {
    if (!this.intentHistory.has(sessionId)) {
      this.intentHistory.set(sessionId, []);
    }

    const history = this.intentHistory.get(sessionId)!;
    history.push(entry);

    // Enforce max 10 turns per CON-002
    if (history.length > 10) {
      history.shift();
    }
  }

  private emitClassified(event: Parameters<IntentClassifiedHandler>[0]): void {
    for (const listener of this.classifiedListeners) {
      try {
        const result = listener(event);
        if (result instanceof Promise) {
          void result.catch((err) =>
            this.logger.error("Intent classified handler failed", {
              error: err?.message ?? err,
            }),
          );
        }
      } catch (err: unknown) {
        this.logger.error("Intent classified listener threw", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private ensureInitialized(operation: string): void {
    if (!this.initialized) {
      throw new Error(`IntentProcessor must be initialized before ${operation}`);
    }
  }
}
