import { Logger } from "../../core/logger";
import type {
    AlternativeIntent,
    IntentContext,
    IntentMetadata,
    IntentResult,
} from "../intent-processor";
import { LlmIntentClassifier } from "./llm-intent-classifier";
import { RuleIntentClassifier } from "./rule-intent-classifier";

/**
 * Hybrid intent classifier combining rule-based and LLM approaches.
 */
export class HybridIntentClassifier {
  private readonly logger: Logger;
  private readonly ruleClassifier: RuleIntentClassifier;
  private readonly llmClassifier?: LlmIntentClassifier;
  private readonly disambiguationThreshold: number;

  constructor(
    ruleClassifier: RuleIntentClassifier,
    llmClassifier?: LlmIntentClassifier,
    disambiguationThreshold = 0.1,
    logger?: Logger,
  ) {
    this.ruleClassifier = ruleClassifier;
    this.llmClassifier = llmClassifier;
    this.disambiguationThreshold = disambiguationThreshold;
    this.logger = logger ?? new Logger("HybridIntentClassifier");
  }

  /**
   * Classify intent using hybrid approach with fallback.
   */
  async classify(
    transcript: string,
    context: IntentContext,
  ): Promise<IntentResult> {
    const startTime = performance.now();
    const classifierMode = context.userPreferences?.classifierMode ?? "hybrid";

    try {
      // Try rule-based first for high-frequency patterns
      const ruleResult = await this.ruleClassifier.classify(transcript, context);

      // If rule-based has high confidence, use it
      if (ruleResult.confidence >= 0.8) {
        this.logger.debug("Using rule-based result", {
          confidence: ruleResult.confidence,
        });
        return ruleResult;
      }

      // Try LLM if available and mode allows
      if (
        this.llmClassifier &&
        (classifierMode === "llm" || classifierMode === "hybrid")
      ) {
        try {
          const llmResult = await this.llmClassifier.classify(
            transcript,
            context,
          );

          // Combine results if both have moderate confidence
          if (
            ruleResult.confidence > 0.5 &&
            llmResult.confidence > 0.5 &&
            Math.abs(ruleResult.confidence - llmResult.confidence) <=
              this.disambiguationThreshold
          ) {
            return this.createAmbiguousResult(
              ruleResult,
              llmResult,
              performance.now() - startTime,
            );
          }

          // Use highest confidence result
          const finalResult =
            llmResult.confidence > ruleResult.confidence
              ? llmResult
              : ruleResult;

          // Update metadata to reflect hybrid classification
          finalResult.metadata = {
            ...finalResult.metadata,
            classifierType: "hybrid",
            explanation: `Combined rule (${ruleResult.confidence.toFixed(2)}) and LLM (${llmResult.confidence.toFixed(2)})`,
          };

          return finalResult;
        } catch (llmError: unknown) {
          const message =
            llmError instanceof Error ? llmError.message : String(llmError);
          this.logger.warn("LLM classification failed, falling back to rules", {
            error: message,
          });
          return ruleResult;
        }
      }

      // Fallback to rule-based result
      return ruleResult;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("Hybrid classification failed", { error: message });
      throw error;
    }
  }

  /**
   * Create result indicating ambiguous classification.
   */
  private createAmbiguousResult(
    ruleResult: IntentResult,
    llmResult: IntentResult,
    processingTimeMs: number,
  ): IntentResult {
    const alternatives: AlternativeIntent[] = [
      {
        intentId: llmResult.intentId,
        category: llmResult.category,
        confidence: llmResult.confidence,
        reason: llmResult.metadata.explanation ?? "LLM classification",
      },
    ];

    const metadata: IntentMetadata = {
      classifierType: "hybrid",
      processingTimeMs,
      normalizationApplied: ruleResult.metadata.normalizationApplied,
      disambiguationRequired: true,
      explanation: `Ambiguous: rule=${ruleResult.confidence.toFixed(2)}, llm=${llmResult.confidence.toFixed(2)}`,
    };

    return {
      ...ruleResult,
      metadata,
      alternatives,
    };
  }
}
