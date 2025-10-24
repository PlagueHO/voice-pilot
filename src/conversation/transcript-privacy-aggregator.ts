import * as vscode from "vscode";
import { Logger } from "../core/logger";
import {
  PrivacyController,
  RetentionRegistration,
} from "../services/privacy/privacy-controller";
import { applyRedactions } from "../services/privacy/redaction-engine";
import {
  DataClassification,
  PrivacyAnnotatedTranscript,
  PrivacyIndicators,
  PrivacyPolicySnapshot,
} from "../types/privacy";
import type { RedactionRule } from "../types/speech-to-text";
import {
  TranscriptClearedEvent,
  TranscriptDeltaEvent,
  TranscriptEvent,
  TranscriptFinalEvent,
  TranscriptRedoEvent,
} from "../types/speech-to-text";
import { VoiceControlPanel } from "../ui/voice-control-panel";

interface AggregatedTranscriptState {
  utteranceId: string;
  sessionId: string;
  entryId: string;
  sanitizedContent: string;
  rawContent: string;
  classification: Extract<DataClassification, "Sensitive" | "Confidential">;
  confidence?: number;
  lastUpdatedAt: string;
  isFinal: boolean;
  redactions: PrivacyAnnotatedTranscript["redactions"];
  retentionId: string;
  retentionDisposable?: vscode.Disposable;
  purgeCallback: RetentionRegistration["purge"];
  annotated?: PrivacyAnnotatedTranscript;
}

const PROFANITY_RULES: RedactionRule[] = [
  {
    id: "profanity-generic-1",
    pattern: /(fuck|shit|damn|bitch)/gi,
    replacement: "****",
  },
  {
    id: "profanity-generic-2",
    pattern: /(asshole|bastard|dick)/gi,
    replacement: "****",
  },
];

function buildRetentionId(sessionId: string, utteranceId: string): string {
  return `transcript:${sessionId}:${utteranceId}`;
}

function deriveIndicators(
  matches: PrivacyAnnotatedTranscript["redactions"],
): PrivacyIndicators {
  const containsSecrets = matches.some((match) =>
    /secret|token|key|credential/i.test(match.ruleId),
  );
  const containsPII = matches.some((match) =>
    /pii|email|name|phone|address/i.test(match.ruleId),
  );
  return {
    containsPII,
    containsSecrets,
    profanityFiltered: matches.some((match) =>
      match.ruleId.startsWith("profanity-"),
    ),
  };
}

export class TranscriptPrivacyAggregator {
  private readonly transcripts = new Map<string, AggregatedTranscriptState>();
  private cachedRules?: RedactionRule[];
  private cachedProfanityLevel?: string;
  private cachedBaseRules?: RedactionRule[];

  constructor(
    private readonly voicePanel: VoiceControlPanel,
    private readonly privacyController: PrivacyController,
    private readonly logger: Logger,
  ) {}

  handle(event: TranscriptEvent): void {
    switch (event.type) {
      case "transcript-delta":
        this.handleDelta(event);
        break;
      case "transcript-final":
        this.handleFinal(event);
        break;
      case "transcript-redo":
        this.handleRedo(event);
        break;
      case "transcript-cleared":
        this.handleCleared(event);
        break;
      default:
        this.logger.debug("Transcript aggregator received unsupported event");
        break;
    }
  }

  dispose(): void {
    for (const entry of this.transcripts.values()) {
      entry.retentionDisposable?.dispose();
    }
    this.transcripts.clear();
    this.cachedRules = undefined;
    this.cachedProfanityLevel = undefined;
    this.cachedBaseRules = undefined;
  }

  private handleDelta(event: TranscriptDeltaEvent): void {
    const policy = this.privacyController.getPolicySnapshot();
    const effectiveRules = this.composeRedactionRules(policy);
    const entry = this.ensureEntry(
      event.sessionId,
      event.utteranceId,
      event.timestamp,
    );

    entry.rawContent += event.delta;
    entry.confidence = event.confidence;
    entry.lastUpdatedAt = event.timestamp;
    entry.isFinal = false;

    const redaction = applyRedactions(entry.rawContent, effectiveRules);
    entry.sanitizedContent = redaction.content;
    entry.redactions = redaction.matches;

    const indicators = deriveIndicators(entry.redactions);
    const annotated = this.privacyController.buildTranscriptPayload({
      utteranceId: entry.utteranceId,
      sessionId: entry.sessionId,
      content: entry.sanitizedContent,
      classification: entry.classification,
      createdAt: event.timestamp,
      redactions: entry.redactions,
      metadata: {
        speaker: "user",
        confidence: event.confidence,
        privacyIndicators: indicators,
      },
    });

    entry.annotated = annotated;

    this.voicePanel.appendTranscript({
      entryId: entry.entryId,
      speaker: "user",
      content: annotated.content,
      timestamp: annotated.createdAt,
      confidence: event.confidence,
      partial: true,
    });
  }

  private handleFinal(event: TranscriptFinalEvent): void {
    const policy = this.privacyController.getPolicySnapshot();
    const effectiveRules = this.composeRedactionRules(policy);
    const entry = this.ensureEntry(
      event.sessionId,
      event.utteranceId,
      event.timestamp,
    );

    entry.rawContent = event.content;
    entry.classification = "Confidential";
    entry.confidence = event.confidence;
    entry.lastUpdatedAt = event.timestamp;
    entry.isFinal = true;

    const redaction = applyRedactions(entry.rawContent, effectiveRules);
    entry.sanitizedContent = redaction.content;
    entry.redactions = redaction.matches;

    this.privacyController.updateRetention(entry.retentionId, {
      category: "final-transcript",
      classification: entry.classification,
      createdAt: event.timestamp,
    });

    const indicators = deriveIndicators(entry.redactions);
    const annotated = this.privacyController.buildTranscriptPayload({
      utteranceId: entry.utteranceId,
      sessionId: entry.sessionId,
      content: entry.sanitizedContent,
      classification: entry.classification,
      createdAt: event.timestamp,
      redactions: entry.redactions,
      metadata: {
        speaker: "user",
        confidence: event.confidence,
        privacyIndicators: indicators,
      },
    });

    entry.annotated = annotated;
    this.voicePanel.commitTranscriptEntry(
      entry.entryId,
      annotated.content,
      event.confidence,
    );
  }

  private handleRedo(event: TranscriptRedoEvent): void {
    const entry = this.transcripts.get(event.utteranceId);
    if (!entry) {
      return;
    }
    entry.rawContent = event.replacementContent;
    entry.lastUpdatedAt = event.timestamp;
    entry.isFinal = false;

    const policy = this.privacyController.getPolicySnapshot();
    const effectiveRules = this.composeRedactionRules(policy);
    const redaction = applyRedactions(entry.rawContent, effectiveRules);
    entry.sanitizedContent = redaction.content;
    entry.redactions = redaction.matches;

    const indicators = deriveIndicators(entry.redactions);

    const annotated = this.privacyController.buildTranscriptPayload({
      utteranceId: entry.utteranceId,
      sessionId: entry.sessionId,
      content: entry.sanitizedContent,
      classification: entry.classification,
      createdAt: event.timestamp,
      redactions: entry.redactions,
      metadata: {
        speaker: "user",
        privacyIndicators: indicators,
      },
    });

    entry.annotated = annotated;

    this.voicePanel.appendTranscript({
      entryId: entry.entryId,
      speaker: "user",
      content: annotated.content,
      timestamp: annotated.createdAt,
      partial: true,
    });
  }

  private handleCleared(event: TranscriptClearedEvent): void {
    const entries = Array.from(this.transcripts.values()).filter(
      (state) => state.sessionId === event.sessionId,
    );
    for (const entry of entries) {
      entry.retentionDisposable?.dispose();
      this.transcripts.delete(entry.utteranceId);
      this.voicePanel.removeTranscriptEntry(entry.entryId);
    }
  }

  private ensureEntry(
    sessionId: string,
    utteranceId: string,
    createdAt: string,
  ): AggregatedTranscriptState {
    const existing = this.transcripts.get(utteranceId);
    if (existing) {
      return existing;
    }

    const retentionId = buildRetentionId(sessionId, utteranceId);
    const purge: RetentionRegistration["purge"] = (reason) =>
      this.executePurge(utteranceId, reason);
    const disposable = this.privacyController.registerRetention({
      id: retentionId,
      target: "transcripts",
      category: "partial-transcript",
      classification: "Sensitive",
      createdAt,
      purge,
    });

    const entry: AggregatedTranscriptState = {
      utteranceId,
      sessionId,
      entryId: utteranceId,
      rawContent: "",
      sanitizedContent: "",
      classification: "Sensitive",
      lastUpdatedAt: createdAt,
      isFinal: false,
      redactions: [],
      retentionId,
      retentionDisposable: disposable,
      purgeCallback: purge,
      annotated: undefined,
    };

    this.transcripts.set(utteranceId, entry);
    return entry;
  }

  private composeRedactionRules(
    policy: PrivacyPolicySnapshot,
  ): RedactionRule[] {
    // Optimization: Cache composed rules to avoid allocating new arrays on every event
    // Validate both profanity level AND base redaction rules haven't changed
    if (
      this.cachedRules && 
      this.cachedProfanityLevel === policy.profanityFilter &&
      this.cachedBaseRules === policy.redactionRules
    ) {
      return this.cachedRules;
    }

    let rules: RedactionRule[];
    if (policy.profanityFilter === "high") {
      rules = [...policy.redactionRules, ...PROFANITY_RULES];
    } else if (policy.profanityFilter === "medium") {
      rules = [...policy.redactionRules, PROFANITY_RULES[0]];
    } else {
      rules = policy.redactionRules;
    }

    this.cachedRules = rules;
    this.cachedProfanityLevel = policy.profanityFilter;
    this.cachedBaseRules = policy.redactionRules;
    return rules;
  }

  private executePurge(
    utteranceId: string,
    reason: Parameters<RetentionRegistration["purge"]>[0],
  ): number {
    const entry = this.transcripts.get(utteranceId);
    if (!entry) {
      return 0;
    }
    entry.retentionDisposable?.dispose();
    this.transcripts.delete(utteranceId);
    this.voicePanel.removeTranscriptEntry(entry.entryId);
    this.logger.debug("Transcript purged", {
      utteranceId,
      reason,
    });
    return 1;
  }
  getAnnotatedTranscript(
    utteranceId: string,
  ): PrivacyAnnotatedTranscript | undefined {
    return this.transcripts.get(utteranceId)?.annotated;
  }

  clearSession(
    sessionId: string,
    reason: Parameters<RetentionRegistration["purge"]>[0] = "session-timeout",
  ): number {
    let cleared = 0;
    for (const entry of Array.from(this.transcripts.values())) {
      if (entry.sessionId !== sessionId) {
        continue;
      }
      cleared += this.executePurge(entry.utteranceId, reason);
    }
    return cleared;
  }
}
