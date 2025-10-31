import { Logger } from "../../core/logger";
import type {
    IntentContext,
    IntentDefinition,
    IntentMetadata,
    IntentPack,
    IntentPattern,
    IntentResult,
} from "../intent-processor";

/**
 * Rule-based intent classifier using regex patterns and keyword matching.
 */
export class RuleIntentClassifier {
  private readonly logger: Logger;
  private intentPacks: IntentPack[] = [];

  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger("RuleIntentClassifier");
  }

  /**
   * Register an intent pack for classification.
   */
  registerIntentPack(pack: IntentPack): void {
    this.intentPacks.push(pack);
    this.logger.debug("Intent pack registered", {
      id: pack.id,
      intents: pack.intents.length,
    });
  }

  /**
   * Classify transcript using rule-based pattern matching.
   */
  async classify(
    transcript: string,
    context: IntentContext,
  ): Promise<IntentResult> {
    const startTime = performance.now();
    const normalizedTranscript = this.normalizeTranscript(transcript);
    const normalizationSteps: string[] = ["lowercase", "trim"];

    let bestMatch: {
      intent: IntentDefinition;
      confidence: number;
      pattern: IntentPattern;
    } | null = null;

    // Evaluate all patterns across all packs
    for (const pack of this.intentPacks) {
      for (const intent of pack.intents) {
        for (const pattern of intent.patterns) {
          if (pattern.type === "llm-prompt") {
            continue; // Skip LLM patterns
          }

          const confidence = this.evaluatePattern(
            normalizedTranscript,
            pattern,
          );

          if (confidence > 0 && (!bestMatch || confidence > bestMatch.confidence)) {
            bestMatch = { intent, confidence, pattern };
          }
        }
      }
    }

    // Build result
    const processingTimeMs = performance.now() - startTime;

    if (!bestMatch || bestMatch.confidence < 0.5) {
      return this.createUnknownIntent(processingTimeMs, normalizationSteps);
    }

    const metadata: IntentMetadata = {
      classifierType: "rule-based",
      processingTimeMs,
      normalizationApplied: normalizationSteps,
      disambiguationRequired: false,
      explanation: `Matched pattern: ${bestMatch.pattern.value}`,
    };

    return {
      intentId: bestMatch.intent.id,
      category: bestMatch.intent.category,
      subcategory: bestMatch.intent.subcategory,
      action: bestMatch.intent.action,
      confidence: bestMatch.confidence,
      entities: [], // Entity extraction handled separately
      metadata,
      requiresConfirmation: bestMatch.intent.confirmationRequired,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Normalize transcript for pattern matching.
   */
  private normalizeTranscript(transcript: string): string {
    return transcript.toLowerCase().trim();
  }

  /**
   * Evaluate pattern match confidence.
   */
  private evaluatePattern(
    normalizedTranscript: string,
    pattern: IntentPattern,
  ): number {
    if (pattern.type === "regex") {
      const regex = new RegExp(
        pattern.value,
        pattern.caseSensitive ? "" : "i",
      );
      return regex.test(normalizedTranscript)
        ? pattern.weight ?? 1.0
        : 0.0;
    }

    if (pattern.type === "keywords") {
      const keywords = pattern.value.toLowerCase().split(/\s+/);
      const matchedKeywords = keywords.filter((kw) =>
        normalizedTranscript.includes(kw),
      );
      const matchRatio = matchedKeywords.length / keywords.length;
      return matchRatio >= 0.8 ? (pattern.weight ?? 1.0) * matchRatio : 0.0;
    }

    return 0.0;
  }

  /**
   * Create unknown intent result.
   */
  private createUnknownIntent(
    processingTimeMs: number,
    normalizationSteps: string[],
  ): IntentResult {
    return {
      intentId: "unknown.general.default",
      category: "unknown",
      confidence: 0.0,
      entities: [],
      metadata: {
        classifierType: "rule-based",
        processingTimeMs,
        normalizationApplied: normalizationSteps,
        disambiguationRequired: false,
      },
      requiresConfirmation: false,
      timestamp: new Date().toISOString(),
    };
  }
}
