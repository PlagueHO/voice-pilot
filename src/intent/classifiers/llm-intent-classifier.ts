import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import { AzureOpenAI } from "openai";
import { Logger } from "../../core/logger";
import type {
    IntentCategory,
    IntentContext,
    IntentMetadata,
    IntentResult,
} from "../intent-processor";

/**
 * Configuration for LLM-based intent classification.
 */
export interface LlmClassifierConfig {
  endpoint: string;
  deployment: string;
  apiVersion: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * LLM response schema for intent classification.
 */
interface LlmClassificationResponse {
  category: IntentCategory;
  subcategory?: string;
  action?: string;
  confidence: number;
  entities: Array<{
    type: string;
    value: string;
    confidence: number;
  }>;
  explanation: string;
}

/**
 * LLM-based intent classifier using Azure OpenAI.
 */
export class LlmIntentClassifier {
  private readonly logger: Logger;
  private readonly config: LlmClassifierConfig;
  private client?: AzureOpenAI;

  constructor(config: LlmClassifierConfig, logger?: Logger) {
    this.config = config;
    this.logger = logger ?? new Logger("LlmIntentClassifier");
  }

  /**
   * Initialize the Azure OpenAI client with keyless auth.
   */
  async initialize(): Promise<void> {
    try {
      const credential = new DefaultAzureCredential();
      const scope = "https://cognitiveservices.azure.com/.default";
      const azureADTokenProvider = getBearerTokenProvider(credential, scope);

      this.client = new AzureOpenAI({
        azureADTokenProvider,
        endpoint: this.config.endpoint,
        deployment: this.config.deployment,
        apiVersion: this.config.apiVersion,
      });

      this.logger.debug("LlmIntentClassifier initialized", {
        endpoint: this.config.endpoint,
        deployment: this.config.deployment,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to initialize LLM classifier", { error: message });
      throw error;
    }
  }

  /**
   * Classify intent using Azure OpenAI LLM.
   */
  async classify(
    transcript: string,
    context: IntentContext,
  ): Promise<IntentResult> {
    if (!this.client) {
      throw new Error("LlmIntentClassifier not initialized");
    }

    const startTime = performance.now();

    try {
      const prompt = this.buildPrompt(transcript, context);
      const completion = await this.client.chat.completions.create({
        model: this.config.deployment,
        messages: [{ role: "user", content: prompt }],
        temperature: this.config.temperature ?? 0.3,
        max_tokens: this.config.maxTokens ?? 500,
      });

      const responseContent = completion.choices[0]?.message?.content;
      if (!responseContent) {
        throw new Error("Empty response from LLM");
      }

      const parsed = this.parseResponse(responseContent);
      const processingTimeMs = performance.now() - startTime;

      const metadata: IntentMetadata = {
        classifierType: "llm",
        processingTimeMs,
        llmModel: this.config.deployment,
        llmTokensUsed: completion.usage?.total_tokens,
        normalizationApplied: [],
        disambiguationRequired: false,
        explanation: parsed.explanation,
      };

      return {
        intentId: `${parsed.category}.${parsed.subcategory ?? "general"}.${parsed.action ?? "default"}`,
        category: parsed.category,
        subcategory: parsed.subcategory,
        action: parsed.action,
        confidence: parsed.confidence,
        entities: parsed.entities.map((e, idx) => ({
          type: e.type as any,
          value: e.value,
          confidence: e.confidence,
          startIndex: transcript.indexOf(e.value),
          endIndex: transcript.indexOf(e.value) + e.value.length,
          metadata: { extractorType: "llm" },
        })),
        metadata,
        requiresConfirmation: false,
        timestamp: new Date().toISOString(),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("LLM classification failed", { error: message });
      throw error;
    }
  }

  /**
   * Build classification prompt with context.
   */
  private buildPrompt(transcript: string, context: IntentContext): string {
    const workspaceInfo = context.workspaceContext
      ? `\nWorkspace context:
- Active file: ${context.workspaceContext.activeEditor?.filePath ?? "none"}
- Recent symbols: ${context.workspaceContext.recentSymbols.join(", ") || "none"}`
      : "";

    return `Classify the following user utterance into one of these categories: command, query, navigation, planning, conversational.
Extract any entities such as file paths, line numbers, code symbols, or durations.

Utterance: "${transcript}"${workspaceInfo}

Respond with JSON:
{
  "category": "command|query|navigation|planning|conversational",
  "subcategory": "string or null",
  "action": "string or null",
  "confidence": 0.0-1.0,
  "entities": [{ "type": "string", "value": "string", "confidence": 0.0-1.0 }],
  "explanation": "string"
}`;
  }

  /**
   * Parse LLM JSON response with validation.
   */
  private parseResponse(content: string): LlmClassificationResponse {
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = content.match(/```json\s*\n([\s\S]*?)\n```/) ||
                        content.match(/```\s*\n([\s\S]*?)\n```/);
      const jsonString = jsonMatch ? jsonMatch[1] : content;

      const parsed = JSON.parse(jsonString.trim());

      // Validate required fields
      if (!parsed.category || typeof parsed.confidence !== "number") {
        throw new Error("Invalid response schema");
      }

      return parsed as LlmClassificationResponse;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to parse LLM response", { error: message, content });
      throw new Error(`LLM response parsing failed: ${message}`);
    }
  }
}
