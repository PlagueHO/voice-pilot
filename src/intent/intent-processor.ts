import { Disposable } from "vscode";
import type { ConversationStateSnapshot } from "../conversation/conversation-state-machine";
import { ServiceInitializable } from "../core/service-initializable";
import type { TranscriptFinalEvent } from "../types/speech-to-text";

/**
 * Intent categories representing top-level user goal classifications.
 */
export type IntentCategory =
  | "command"
  | "query"
  | "navigation"
  | "planning"
  | "conversational"
  | "unknown";

/**
 * Entity types supported by the extraction pipeline.
 */
export type EntityType =
  | "CodeSymbol"
  | "FilePath"
  | "LineNumber"
  | "LanguageName"
  | "Duration"
  | "Number"
  | "Date"
  | "Custom";

/**
 * Error codes raised during intent classification.
 */
export enum ClassificationErrorCode {
  TranscriptEmpty = "TRANSCRIPT_EMPTY",
  NoConfidentMatch = "NO_CONFIDENT_MATCH",
  AmbiguousIntent = "AMBIGUOUS_INTENT",
  EntityExtractionFailed = "ENTITY_EXTRACTION_FAILED",
  LlmUnavailable = "LLM_UNAVAILABLE",
  InvalidIntentPack = "INVALID_INTENT_PACK",
  HandlerNotFound = "HANDLER_NOT_FOUND",
  Unknown = "UNKNOWN",
}

/**
 * Contextual metadata aggregated for intent classification.
 */
export interface IntentContext {
  sessionId: string;
  conversationState: ConversationStateSnapshot;
  turnContext: TurnContext;
  workspaceContext?: WorkspaceContext;
  userPreferences?: UserPreferences;
  intentHistory: IntentHistoryEntry[];
}

/**
 * Structured intent result produced by classification.
 */
export interface IntentResult {
  intentId: string;
  category: IntentCategory;
  subcategory?: string;
  action?: string;
  confidence: number;
  entities: ExtractedEntity[];
  metadata: IntentMetadata;
  alternatives?: AlternativeIntent[];
  requiresConfirmation: boolean;
  timestamp: string;
}

/**
 * Extracted entity with position and metadata.
 */
export interface ExtractedEntity {
  type: EntityType;
  value: string;
  normalizedValue?: unknown;
  confidence: number;
  startIndex: number;
  endIndex: number;
  metadata: EntityMetadata;
}

/**
 * Supplemental metadata attached to each extracted entity.
 */
export interface EntityMetadata {
  resolved?: boolean;
  validationError?: string;
  contextHint?: string;
  extractorType: "regex" | "ner" | "llm" | "custom";
}

/**
 * Metadata describing the classification process and outcomes.
 */
export interface IntentMetadata {
  classifierType: "rule-based" | "llm" | "hybrid";
  processingTimeMs: number;
  llmModel?: string;
  llmTokensUsed?: number;
  normalizationApplied: string[];
  disambiguationRequired: boolean;
  explanation?: string;
}

/**
 * Alternative intent candidate when multiple high-confidence matches exist.
 */
export interface AlternativeIntent {
  intentId: string;
  category: IntentCategory;
  confidence: number;
  reason: string;
}

/**
 * Contract implemented by intent handlers registered with the processor.
 */
export interface IntentHandler {
  canHandle(intent: IntentResult): boolean;
  execute(
    intent: IntentResult,
    context: IntentContext,
  ): Promise<IntentHandlerResult>;
  getPriority(): number;
}

/**
 * Result envelope returned by intent handler execution.
 */
export interface IntentHandlerResult {
  success: boolean;
  message?: string;
  data?: unknown;
  nextAction?: "continue" | "wait" | "terminate";
  error?: IntentExecutionError;
}

/**
 * Structured error descriptor for handler execution failures.
 */
export interface IntentExecutionError {
  code: string;
  message: string;
  recoverable: boolean;
  remediation?: string;
}

/**
 * Turn context snapshot tracking conversation flow.
 */
export interface TurnContext {
  turnId: string;
  turnRole: "user" | "assistant";
  since: string;
  transcript?: string;
  confidence?: number;
  interruptions: number;
  metadata: Record<string, unknown>;
}

/**
 * Workspace-specific context for entity resolution.
 */
export interface WorkspaceContext {
  activeEditor?: {
    filePath: string;
    languageId: string;
    selection?: {
      startLine: number;
      endLine: number;
    };
  };
  openFiles: string[];
  workspaceFolders: string[];
  recentSymbols: string[];
  gitBranch?: string;
}

/**
 * User preferences affecting classification behavior.
 */
export interface UserPreferences {
  preferredLanguage: string;
  confirmationThreshold: number;
  classifierMode: "rule-based" | "llm" | "hybrid";
  customIntentPacks: string[];
}

/**
 * Intent pack providing extensible classification rules.
 */
export interface IntentPack {
  id: string;
  name: string;
  version: string;
  description: string;
  locale: string;
  intents: IntentDefinition[];
  entities: EntityDefinition[];
  examples: IntentExample[];
}

/**
 * Intent definition specifying patterns and required entities.
 */
export interface IntentDefinition {
  id: string;
  category: IntentCategory;
  subcategory?: string;
  action?: string;
  patterns: IntentPattern[];
  requiredEntities: EntitySlot[];
  optionalEntities: EntitySlot[];
  confirmationRequired: boolean;
  priority: number;
}

/**
 * Pattern descriptor for rule-based or LLM-based matching.
 */
export interface IntentPattern {
  type: "regex" | "keywords" | "llm-prompt";
  value: string;
  caseSensitive?: boolean;
  weight?: number;
}

/**
 * Entity slot declaration within intent schemas.
 */
export interface EntitySlot {
  name: string;
  type: EntityType;
  required: boolean;
  defaultValue?: unknown;
  validationRule?: string;
}

/**
 * Entity type definition with extraction patterns.
 */
export interface EntityDefinition {
  type: EntityType;
  patterns: string[];
  normalizer?: string;
  validator?: string;
}

/**
 * Example utterance for validation and testing.
 */
export interface IntentExample {
  transcript: string;
  expectedIntent: string;
  expectedEntities: Record<string, string>;
  locale: string;
}

/**
 * Historical intent record enabling context-aware classification.
 */
export interface IntentHistoryEntry {
  intentResult: IntentResult;
  transcript: string;
  timestamp: string;
}

/**
 * Classification error payload emitted on failures.
 */
export interface ClassificationError {
  code: ClassificationErrorCode;
  message: string;
  recoverable: boolean;
  fallbackIntent?: IntentResult;
}

/**
 * Event emitted when intent classification completes.
 */
export interface IntentClassifiedEvent {
  type: "intent-classified";
  sessionId: string;
  intentResult: IntentResult;
  transcript: string;
  context: IntentContext;
  timestamp: string;
}

/**
 * Event emitted after handler execution.
 */
export interface IntentExecutedEvent {
  type: "intent-executed";
  sessionId: string;
  intentId: string;
  handlerResult: IntentHandlerResult;
  executionTimeMs: number;
  timestamp: string;
}

/**
 * Event emitted on classification errors.
 */
export interface ClassificationErrorEvent {
  type: "classification-error";
  sessionId: string;
  transcript: string;
  error: ClassificationError;
  timestamp: string;
}

/**
 * Callback handler signatures for event subscriptions.
 */
export type IntentClassifiedHandler = (
  event: IntentClassifiedEvent,
) => void | Promise<void>;
export type IntentExecutedHandler = (
  event: IntentExecutedEvent,
) => void | Promise<void>;
export type ClassificationErrorHandler = (
  event: ClassificationErrorEvent,
) => void | Promise<void>;

/**
 * Intent processing service managing classification and handler orchestration.
 */
export interface IntentProcessor extends ServiceInitializable {
  classifyIntent(
    transcript: TranscriptFinalEvent,
    context: IntentContext,
  ): Promise<IntentResult>;
  registerHandler(intentType: string, handler: IntentHandler): Disposable;
  registerIntentPack(pack: IntentPack): Promise<void>;
  getIntentHistory(sessionId: string): IntentHistoryEntry[];
  clearIntentHistory(sessionId: string): Promise<void>;

  onIntentClassified(handler: IntentClassifiedHandler): Disposable;
  onIntentExecuted(handler: IntentExecutedHandler): Disposable;
  onClassificationError(handler: ClassificationErrorHandler): Disposable;
}
