---
title: Intent Processing & Classification Algorithm
version: 1.0
date_created: 2025-10-29
last_updated: 2025-10-29
owner: Agent Voice Project
tags: [algorithm, intent, classification, nlp, conversation]
---

## Introduction

This specification defines the intent processing and classification pipeline that transforms realtime speech transcripts into actionable intents for Agent Voice's conversational workflows. The intent processor bridges the realtime speech-to-text service (SP-009) and the conversation state machine (SP-012), enabling Agent Voice to understand user goals, route commands to appropriate handlers, and provide natural conversational feedback aligned with the UI design guidelines.

## 1. Purpose & Scope

This specification covers the functional, architectural, and operational requirements for intent processing within Agent Voice:

- Parse finalized transcripts from the STT service into structured intent representations.
- Classify user utterances into command, query, navigation, planning, and conversational categories.
- Extract entities, parameters, and contextual metadata required for downstream handlers.
- Integrate with the conversation state machine to trigger appropriate state transitions and actions.
- Support extensibility for custom intent packs and domain-specific vocabularies.
- Provide confidence scoring, ambiguity resolution, and error handling for robust classification.
- Enable integration with GitHub Copilot for natural language queries and code-related intents.

**Intended Audience**: Extension developers implementing conversational features, NLP engineers, Copilot integration specialists, and QA automation engineers.

**Assumptions**:

- Realtime STT service (SP-009) provides finalized transcripts with confidence scores and metadata.
- Conversation state machine (SP-012) exposes turn context and state transition hooks.
- Session Manager (SP-005) maintains active session state and contextual metadata.
- UI components consume intent results for visual feedback and action confirmation.
- Azure OpenAI services are available for LLM-based intent classification when configured.
- Initial implementation targets English language with localization hooks for future expansion.

## 2. Definitions

- **Intent**: Structured representation of user goal derived from transcript analysis (e.g., `StartConversation`, `ExecuteCommand`, `AskQuestion`).
- **Intent Classifier**: Component that maps transcripts to intent categories using rule-based, ML, or LLM-based approaches.
- **Entity Extraction**: Process of identifying parameters, values, and contextual references within utterances.
- **Intent Confidence**: Numeric score (0.0–1.0) representing classification certainty.
- **Intent Handler**: Service registered to execute actions for specific intent types.
- **Intent Pack**: Extensible collection of intent definitions, entity schemas, and classification rules.
- **Ambiguous Intent**: Classification result with multiple competing interpretations requiring clarification.
- **Fallback Intent**: Default classification applied when no confident match is found.
- **Intent Context**: Aggregated metadata including session state, conversation history, and workspace context.
- **Intent Slot**: Named parameter within an intent schema requiring value extraction from the transcript.

## 3. Requirements, Constraints & Guidelines

### Functional Requirements

- **REQ-001**: Intent processor SHALL accept finalized transcript events from STT service (SP-009) and produce structured intent results within 200 ms.
- **REQ-002**: Intent processor SHALL classify transcripts into these primary categories: `Command`, `Query`, `Navigation`, `Planning`, `Conversational`, `Unknown`.
- **REQ-003**: Intent processor SHALL support hierarchical intent taxonomies with category, subcategory, and action levels (e.g., `Command.Editor.FormatDocument`).
- **REQ-004**: Intent processor SHALL extract entities using configurable patterns, named entity recognition, or LLM prompts.
- **REQ-005**: Intent processor SHALL compute confidence scores combining classifier outputs and contextual signals.
- **REQ-006**: Intent processor SHALL register intent handlers implementing `IntentHandler` interface for extensibility.
- **REQ-007**: Intent processor SHALL provide disambiguation flows when multiple intents score above threshold (default 0.7).
- **REQ-008**: Intent processor SHALL emit intent results to conversation state machine (SP-012) triggering appropriate state transitions.
- **REQ-009**: Intent processor SHALL maintain intent history for context-aware classification (last 10 turns per session).
- **REQ-010**: Intent processor SHALL support custom intent packs loaded from configuration or extension APIs.

### Classification Requirements

- **CLS-001**: Intent classifier SHALL support rule-based classification using regex patterns and keyword matching.
- **CLS-002**: Intent classifier SHALL support LLM-based classification using Azure OpenAI with configurable prompts.
- **CLS-003**: Intent classifier SHALL support hybrid approaches combining rule-based and LLM methods with weighted scoring.
- **CLS-004**: Classifier SHALL respect turn context from conversation state machine when evaluating follow-up utterances.
- **CLS-005**: Classifier SHALL normalize transcripts (lowercase, punctuation removal, filler word removal) before pattern matching.
- **CLS-006**: Classifier SHALL detect negation patterns and modifier keywords affecting intent semantics.
- **CLS-007**: Classifier SHALL handle common speech recognition errors and phonetic variations.
- **CLS-008**: Classifier SHALL provide structured explanations for classification decisions aiding debugging and telemetry.

### Entity Extraction Requirements

- **ENT-001**: Entity extractor SHALL identify common types: `CodeSymbol`, `FilePath`, `LineNumber`, `LanguageName`, `Duration`, `Number`, `Date`.
- **ENT-002**: Entity extractor SHALL resolve workspace-relative paths and validate file existence when extracting `FilePath` entities.
- **ENT-003**: Entity extractor SHALL parse temporal expressions (e.g., "in 5 minutes") into absolute timestamps.
- **ENT-004**: Entity extractor SHALL support slot-filling patterns requiring multiple entities per intent.
- **ENT-005**: Entity extractor SHALL provide confidence scores per extracted entity.
- **ENT-006**: Entity extractor SHALL handle pronouns and anaphora resolution using conversation history.

### Integration Requirements

- **INT-001**: Intent processor SHALL subscribe to STT finalized transcript events via observer pattern.
- **INT-002**: Intent processor SHALL publish intent results to registered handlers and state machine within 100 ms of classification.
- **INT-003**: Intent processor SHALL coordinate with Session Manager to access workspace context and user preferences.
- **INT-004**: Intent processor SHALL emit telemetry events for classification latency, confidence distribution, and handler execution.
- **INT-005**: Intent processor SHALL expose diagnostic endpoints for testing intent classification without full conversation flows.

### Security & Privacy Requirements

- **SEC-001**: Intent processor SHALL redact sensitive entities (credentials, API keys, PII) before logging or telemetry emission.
- **SEC-002**: Custom intent packs loaded from workspace SHALL be validated against security policies preventing code injection.
- **SEC-003**: LLM-based classification prompts SHALL sanitize user transcripts to prevent prompt injection attacks.
- **SEC-004**: Intent handler registration SHALL validate handler identities preventing unauthorized command execution.

### Performance Requirements

- **PER-001**: Intent classification SHALL complete within 200 ms for rule-based classifiers under nominal conditions.
- **PER-002**: LLM-based classification SHALL complete within 1.5 seconds including network round-trip time.
- **PER-003**: Entity extraction SHALL add no more than 50 ms overhead per entity type.
- **PER-004**: Intent processor SHALL support concurrent classification requests up to 10 per session without queuing delays.

### Constraints

- **CON-001**: Intent processor SHALL operate in the extension host context with no direct webview dependencies.
- **CON-002**: Intent history SHALL retain maximum 10 turns per session to limit memory footprint.
- **CON-003**: Custom intent packs SHALL be limited to 100 intent definitions per pack to maintain classification performance.
- **CON-004**: LLM-based classification SHALL fall back to rule-based methods when network or quota limits are exceeded.

### Guidelines

- **GUD-001**: Prefer rule-based classification for high-frequency commands to minimize latency and costs.
- **GUD-002**: Use LLM classification for complex queries, ambiguous phrasing, or domain-specific planning tasks.
- **GUD-003**: Provide user-facing confirmation prompts for destructive or irreversible actions derived from intents.
- **GUD-004**: Design intent schemas with clear boundaries avoiding overlapping patterns across categories.
- **GUD-005**: Include localized examples in intent pack definitions supporting multilingual expansion.

### Patterns

- **PAT-001**: Apply Strategy pattern for pluggable classification backends (rule-based, LLM, hybrid).
- **PAT-002**: Use Chain of Responsibility pattern for entity extraction pipelines processing transcripts sequentially.
- **PAT-003**: Apply Observer pattern for intent result subscriptions enabling multiple consumers.
- **PAT-004**: Use Builder pattern for constructing complex intent contexts from session state and history.

## 4. Interfaces & Data Contracts

### Intent Processor Interface

```typescript
import { ServiceInitializable } from '../core/service-initializable';
import { TranscriptFinalEvent } from '../services/realtime-stt-service';
import { ConversationStateSnapshot } from '../conversation/conversation-state-machine';
import { Disposable } from 'vscode';

export interface IntentProcessor extends ServiceInitializable {
  classifyIntent(transcript: TranscriptFinalEvent, context: IntentContext): Promise<IntentResult>;
  registerHandler(intentType: string, handler: IntentHandler): Disposable;
  registerIntentPack(pack: IntentPack): Promise<void>;
  getIntentHistory(sessionId: string): IntentHistoryEntry[];
  clearIntentHistory(sessionId: string): Promise<void>;

  onIntentClassified(handler: IntentClassifiedHandler): Disposable;
  onIntentExecuted(handler: IntentExecutedHandler): Disposable;
  onClassificationError(handler: ClassificationErrorHandler): Disposable;
}

export interface IntentContext {
  sessionId: string;
  conversationState: ConversationStateSnapshot;
  turnContext: TurnContext;
  workspaceContext?: WorkspaceContext;
  userPreferences?: UserPreferences;
  intentHistory: IntentHistoryEntry[];
}

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

export type IntentCategory = 'command' | 'query' | 'navigation' | 'planning' | 'conversational' | 'unknown';

export interface ExtractedEntity {
  type: EntityType;
  value: string;
  normalizedValue?: any;
  confidence: number;
  startIndex: number;
  endIndex: number;
  metadata: EntityMetadata;
}

export type EntityType =
  | 'CodeSymbol'
  | 'FilePath'
  | 'LineNumber'
  | 'LanguageName'
  | 'Duration'
  | 'Number'
  | 'Date'
  | 'Custom';

export interface EntityMetadata {
  resolved?: boolean;
  validationError?: string;
  contextHint?: string;
  extractorType: 'regex' | 'ner' | 'llm' | 'custom';
}

export interface IntentMetadata {
  classifierType: 'rule-based' | 'llm' | 'hybrid';
  processingTimeMs: number;
  llmModel?: string;
  llmTokensUsed?: number;
  normalizationApplied: string[];
  disambiguationRequired: boolean;
  explanation?: string;
}

export interface AlternativeIntent {
  intentId: string;
  category: IntentCategory;
  confidence: number;
  reason: string;
}

export interface IntentHandler {
  canHandle(intent: IntentResult): boolean;
  execute(intent: IntentResult, context: IntentContext): Promise<IntentHandlerResult>;
  getPriority(): number;
}

export interface IntentHandlerResult {
  success: boolean;
  message?: string;
  data?: any;
  nextAction?: 'continue' | 'wait' | 'terminate';
  error?: IntentExecutionError;
}

export interface IntentExecutionError {
  code: string;
  message: string;
  recoverable: boolean;
  remediation?: string;
}
```

### Intent Pack Schema

```typescript
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

export interface IntentPattern {
  type: 'regex' | 'keywords' | 'llm-prompt';
  value: string;
  caseSensitive?: boolean;
  weight?: number;
}

export interface EntitySlot {
  name: string;
  type: EntityType;
  required: boolean;
  defaultValue?: any;
  validationRule?: string;
}

export interface EntityDefinition {
  type: EntityType;
  patterns: string[];
  normalizer?: string; // Function name for normalization
  validator?: string; // Function name for validation
}

export interface IntentExample {
  transcript: string;
  expectedIntent: string;
  expectedEntities: Record<string, string>;
  locale: string;
}
```

### Intent Events

```typescript
export type IntentClassifiedHandler = (event: IntentClassifiedEvent) => void | Promise<void>;
export type IntentExecutedHandler = (event: IntentExecutedEvent) => void | Promise<void>;
export type ClassificationErrorHandler = (event: ClassificationErrorEvent) => void | Promise<void>;

export interface IntentClassifiedEvent {
  type: 'intent-classified';
  sessionId: string;
  intentResult: IntentResult;
  transcript: string;
  context: IntentContext;
  timestamp: string;
}

export interface IntentExecutedEvent {
  type: 'intent-executed';
  sessionId: string;
  intentId: string;
  handlerResult: IntentHandlerResult;
  executionTimeMs: number;
  timestamp: string;
}

export interface ClassificationErrorEvent {
  type: 'classification-error';
  sessionId: string;
  transcript: string;
  error: ClassificationError;
  timestamp: string;
}

export interface ClassificationError {
  code: ClassificationErrorCode;
  message: string;
  recoverable: boolean;
  fallbackIntent?: IntentResult;
}

export enum ClassificationErrorCode {
  TranscriptEmpty = 'TRANSCRIPT_EMPTY',
  NoConfidentMatch = 'NO_CONFIDENT_MATCH',
  AmbiguousIntent = 'AMBIGUOUS_INTENT',
  EntityExtractionFailed = 'ENTITY_EXTRACTION_FAILED',
  LlmUnavailable = 'LLM_UNAVAILABLE',
  InvalidIntentPack = 'INVALID_INTENT_PACK',
  HandlerNotFound = 'HANDLER_NOT_FOUND',
  Unknown = 'UNKNOWN'
}
```

### Workspace Context Interface

```typescript
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

export interface UserPreferences {
  preferredLanguage: string;
  confirmationThreshold: number;
  classifierMode: 'rule-based' | 'llm' | 'hybrid';
  customIntentPacks: string[];
}
```

## 5. Acceptance Criteria

- **AC-001**: Given a finalized transcript event, When intent processor classifies the transcript, Then an intent result is produced within 200 ms for rule-based classification.
- **AC-002**: Given multiple intent patterns matching a transcript, When confidence scores are computed, Then the highest-confidence intent is selected or disambiguation is triggered if scores are within 0.1.
- **AC-003**: Given a transcript containing file path entities, When entity extraction executes, Then workspace-relative paths are resolved and validated against the file system.
- **AC-004**: Given an intent requiring confirmation, When the intent result is produced, Then `requiresConfirmation` flag is set and confirmation flows are triggered before handler execution.
- **AC-005**: Given an LLM-based classification request, When network or quota limits prevent execution, Then fallback to rule-based classification occurs without surfacing errors to the user.
- **AC-006**: Given intent history context, When processing follow-up utterances with anaphora (e.g., "do it again"), Then entities and actions are resolved from previous turns.
- **AC-007**: Given a custom intent pack loaded from configuration, When intents are classified, Then pack-specific patterns and entities are evaluated alongside built-in definitions.
- **AC-008**: Given a transcript containing sensitive information, When logging intent results, Then redaction policies are applied preventing credential or PII exposure.
- **AC-009**: Given ambiguous classification results, When alternatives exceed threshold, Then `ClassificationErrorCode.AmbiguousIntent` is emitted with ranked alternatives for user selection.
- **AC-010**: Given registered intent handlers, When intent execution completes, Then handler results are propagated to conversation state machine within 100 ms triggering appropriate state transitions.

## 6. Test Automation Strategy

- **Test Levels**: Unit tests for intent classifiers, entity extractors, and handler registration; integration tests with mocked STT and state machine; end-to-end tests validating full conversation flows.
- **Frameworks**: Mocha + Chai for unit tests, Sinon for mocking STT events and LLM responses, `@vscode/test-electron` for extension host integration.
- **Test Data Management**: Curated transcript fixtures covering command categories, entity variations, ambiguous phrasing, and error cases; intent pack JSON schemas with validation.
- **CI/CD Integration**: Automated tests triggered via `npm run test:unit` and `npm run test` pipelines; LLM-based tests use recorded responses or feature flags to avoid live API dependencies.
- **Coverage Requirements**: ≥95% statement coverage for intent classifiers, ≥90% branch coverage for entity extraction, 100% coverage on error handling paths.
- **Performance Testing**: Measure classification latency using synthetic transcripts; stress test with concurrent classification requests; benchmark LLM fallback scenarios.
- **Localization Testing**: Validate intent classification for supported locales using translated example sets.
- **Security Testing**: Verify redaction policies prevent sensitive data leakage; test intent pack validation prevents malicious pattern injection.

## 7. Rationale & Context

Intent processing is the cognitive layer enabling Agent Voice to understand user goals and coordinate actions across extension services. The design prioritizes:

1. **Low Latency**: Rule-based classification provides sub-200ms responses for common commands maintaining conversational flow.
2. **Flexibility**: LLM-based classification handles complex queries and natural phrasing without exhaustive pattern libraries.
3. **Extensibility**: Intent packs and handler registration support domain-specific workflows and third-party extensions.
4. **Context Awareness**: Integration with conversation state machine and session history enables natural follow-up utterances and anaphora resolution.
5. **Robustness**: Hybrid classification with fallback strategies ensures degraded operation when network or quota constraints arise.
6. **Observability**: Structured telemetry and confidence scoring aid debugging, quality assurance, and continuous improvement.

The specification establishes clear contracts between STT output (SP-009), intent classification, and conversation orchestration (SP-012), enabling iterative enhancements to classification accuracy without disrupting dependent services.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Azure OpenAI Services – Provides LLM-based intent classification when configured.

### Third-Party Services

- **SVC-001**: GitHub Copilot Chat APIs – Receives query intents for natural language processing.

### Infrastructure Dependencies

- **INF-001**: Session Manager (SP-005) – Supplies session state and workspace context for classification.
- **INF-002**: Conversation State Machine (SP-012) – Consumes intent results triggering state transitions and action flows.
- **INF-003**: Realtime STT Service (SP-009) – Produces finalized transcripts consumed by intent processor.

### Data Dependencies

- **DAT-001**: Intent pack definitions stored in configuration (`agentvoice.intents.packs`) or workspace `.agentvoice/` directory.
- **DAT-002**: Intent history retained in memory per session for context-aware classification.

### Technology Platform Dependencies

- **PLT-001**: VS Code Extension Host – Executes intent processor and coordinates with workspace APIs.
- **PLT-002**: Node.js 22+ – Provides runtime for async classification and entity extraction.

### Compliance Dependencies

- **COM-001**: Privacy & Data Handling Policy (SP-027) – Will dictate redaction and retention rules for intent metadata.

### Internal Specification Dependencies

- **SP-005**: Session Management & Renewal – Provides session context and user preferences.
- **SP-009**: Realtime Speech-to-Text Integration – Supplies finalized transcripts for classification.
- **SP-012**: Conversation State Machine Architecture – Coordinates state transitions based on intent results.
- **SP-001**: Core Extension Activation & Lifecycle – Defines service initialization order and disposal.

## 9. Examples & Edge Cases

### Example: Rule-Based Intent Classification

```typescript
const commandIntentPack: IntentPack = {
  id: 'agentvoice.core.commands',
  name: 'Core Commands',
  version: '1.0.0',
  description: 'Built-in Agent Voice command intents',
  locale: 'en-US',
  intents: [
    {
      id: 'command.editor.format',
      category: 'command',
      subcategory: 'editor',
      action: 'format',
      patterns: [
        { type: 'keywords', value: 'format document' },
        { type: 'keywords', value: 'format this file' },
        { type: 'regex', value: '^format( the)?( current)?( file| document)$' }
      ],
      requiredEntities: [],
      optionalEntities: [],
      confirmationRequired: false,
      priority: 10
    }
  ],
  entities: [],
  examples: [
    {
      transcript: 'format document',
      expectedIntent: 'command.editor.format',
      expectedEntities: {},
      locale: 'en-US'
    }
  ]
};

await intentProcessor.registerIntentPack(commandIntentPack);
```

### Example: LLM-Based Intent Classification

```typescript
async function classifyWithLlm(transcript: string, context: IntentContext): Promise<IntentResult> {
  const prompt = `Classify the following user utterance into one of these categories: command, query, navigation, planning, conversational.
Extract any entities such as file paths, line numbers, code symbols, or durations.

Utterance: "${transcript}"

Workspace context:
- Active file: ${context.workspaceContext?.activeEditor?.filePath ?? 'none'}
- Recent symbols: ${context.workspaceContext?.recentSymbols.join(', ') ?? 'none'}

Respond with JSON:
{
  "category": "command|query|navigation|planning|conversational",
  "subcategory": "string or null",
  "action": "string or null",
  "confidence": 0.0-1.0,
  "entities": [{ "type": "EntityType", "value": "string", "confidence": 0.0-1.0 }],
  "explanation": "string"
}`;

  const response = await azureOpenAiClient.chat.completions.create({
    model: config.intentClassificationModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 500
  });

  const result = JSON.parse(response.choices[0].message.content);
  return {
    intentId: `${result.category}.${result.subcategory ?? 'general'}.${result.action ?? 'default'}`,
    category: result.category,
    subcategory: result.subcategory,
    action: result.action,
    confidence: result.confidence,
    entities: result.entities.map((e: any) => ({
      type: e.type,
      value: e.value,
      confidence: e.confidence,
      startIndex: transcript.indexOf(e.value),
      endIndex: transcript.indexOf(e.value) + e.value.length,
      metadata: { extractorType: 'llm' }
    })),
    metadata: {
      classifierType: 'llm',
      processingTimeMs: Date.now() - startTime,
      llmModel: config.intentClassificationModel,
      llmTokensUsed: response.usage?.total_tokens,
      normalizationApplied: [],
      disambiguationRequired: false,
      explanation: result.explanation
    },
    requiresConfirmation: false,
    timestamp: new Date().toISOString()
  };
}
```

### Example: Entity Extraction with Workspace Resolution

```typescript
async function extractFilePathEntity(transcript: string, workspaceContext: WorkspaceContext): Promise<ExtractedEntity[]> {
  const filePathPattern = /(?:file|open|edit)\s+([a-zA-Z0-9_\-\/\.]+)/gi;
  const matches = [...transcript.matchAll(filePathPattern)];
  const entities: ExtractedEntity[] = [];

  for (const match of matches) {
    const rawPath = match[1];
    const resolvedPath = await resolveWorkspacePath(rawPath, workspaceContext);

    entities.push({
      type: 'FilePath',
      value: rawPath,
      normalizedValue: resolvedPath,
      confidence: resolvedPath ? 0.9 : 0.5,
      startIndex: match.index!,
      endIndex: match.index! + match[0].length,
      metadata: {
        resolved: !!resolvedPath,
        validationError: resolvedPath ? undefined : 'File not found in workspace',
        extractorType: 'regex'
      }
    });
  }

  return entities;
}

async function resolveWorkspacePath(rawPath: string, context: WorkspaceContext): Promise<string | undefined> {
  const candidatePaths = [
    rawPath,
    path.join(context.workspaceFolders[0], rawPath),
    ...context.openFiles.filter(f => f.endsWith(rawPath))
  ];

  for (const candidate of candidatePaths) {
    if (await fs.promises.access(candidate).then(() => true).catch(() => false)) {
      return candidate;
    }
  }

  return undefined;
}
```

### Edge Case: Ambiguous Intent Disambiguation

```typescript
async function handleAmbiguousIntent(alternatives: AlternativeIntent[], transcript: string): Promise<IntentResult> {
  if (alternatives.length === 0 || alternatives[0].confidence > 0.8) {
    return selectTopIntent(alternatives[0]);
  }

  // Multiple high-confidence alternatives require user clarification
  const topTwo = alternatives.slice(0, 2);
  const clarificationPrompt = `I heard "${transcript}". Did you mean:\n1. ${topTwo[0].category} - ${topTwo[0].reason}\n2. ${topTwo[1].category} - ${topTwo[1].reason}`;

  emitClassificationError({
    type: 'classification-error',
    sessionId: currentSessionId,
    transcript,
    error: {
      code: ClassificationErrorCode.AmbiguousIntent,
      message: clarificationPrompt,
      recoverable: true,
      fallbackIntent: selectTopIntent(topTwo[0])
    },
    timestamp: new Date().toISOString()
  });

  // UI will prompt user for selection; return fallback for now
  return selectTopIntent(topTwo[0]);
}
```

### Edge Case: Anaphora Resolution from Intent History

```typescript
function resolveAnaphora(transcript: string, intentHistory: IntentHistoryEntry[]): ExtractedEntity[] {
  const anaphoraPatterns = /\b(it|that|this|again|same)\b/gi;
  if (!anaphoraPatterns.test(transcript) || intentHistory.length === 0) {
    return [];
  }

  const previousIntent = intentHistory[intentHistory.length - 1];
  const resolvedEntities: ExtractedEntity[] = [];

  // Copy entities from previous intent
  for (const entity of previousIntent.intentResult.entities) {
    resolvedEntities.push({
      ...entity,
      metadata: {
        ...entity.metadata,
        contextHint: `Resolved from previous turn: ${previousIntent.transcript}`
      }
    });
  }

  return resolvedEntities;
}
```

### Edge Case: LLM Fallback on Quota Exhaustion

```typescript
async function classifyIntent(transcript: TranscriptFinalEvent, context: IntentContext): Promise<IntentResult> {
  const preferredMode = context.userPreferences?.classifierMode ?? 'hybrid';

  try {
    if (preferredMode === 'llm' || preferredMode === 'hybrid') {
      return await classifyWithLlm(transcript.content, context);
    }
  } catch (error) {
    if (error.code === 'quota_exceeded' || error.code === 'network_error') {
      telemetry.warn('LLM classification failed, falling back to rule-based', { error: error.message });
      return await classifyWithRules(transcript.content, context);
    }
    throw error;
  }

  return await classifyWithRules(transcript.content, context);
}
```

## 10. Validation Criteria

- Intent processor accepts finalized transcripts and produces intent results within specified latency budgets.
- Rule-based classification correctly matches patterns and extracts entities per intent pack definitions.
- LLM-based classification generates structured JSON conforming to `IntentResult` schema with valid confidence scores.
- Entity extraction resolves workspace paths, validates existence, and normalizes temporal expressions.
- Disambiguation flows trigger when multiple intents score within threshold and alternatives are ranked correctly.
- Intent history maintains context enabling anaphora resolution across consecutive turns.
- Custom intent packs load successfully, validate against schema, and integrate with classification pipelines.
- Redaction policies apply to logs and telemetry preventing sensitive data exposure.
- Error handling surfaces actionable messages for empty transcripts, ambiguous intents, and classification failures.
- Intent handlers execute based on priority and return results propagated to conversation state machine.

## 11. Related Specifications / Further Reading

- [SP-001: Core Extension Activation & Lifecycle](sp-001-spec-architecture-extension-lifecycle.md)
- [SP-005: Session Management & Renewal](sp-005-spec-design-session-management.md)
- [SP-009: Realtime Speech-to-Text Integration](sp-009-spec-tool-realtime-stt.md)
- [SP-012: Conversation State Machine Architecture](sp-012-spec-architecture-conversation-state-machine.md)
- [SP-018: Language Model Adapter (Copilot)](sp-018-spec-architecture-language-model-adapter.md) *(depends on SP-017)*
- [SP-027: Privacy & Data Handling Policy](sp-027-spec-security-privacy-data-handling.md)
- [docs/design/UI.md](../docs/design/UI.md)
- [docs/design/COMPONENTS.md](../docs/design/COMPONENTS.md)
- [Azure OpenAI Chat Completions Reference](https://learn.microsoft.com/azure/ai-services/openai/reference)
