import type { RedactionMatch, RedactionRule } from "./speech-to-text";

/**
 * Classification tiers for data handled inside the VoicePilot extension.
 * Defaults to `Sensitive` until explicitly downgraded by a privacy control.
 */
export type DataClassification = "Sensitive" | "Confidential" | "Operational";

export const DATA_CLASSIFICATIONS: readonly DataClassification[] = [
  "Sensitive",
  "Confidential",
  "Operational",
];

/**
 * Indicators applied to a transcript entry describing residual privacy posture.
 */
export interface PrivacyIndicators {
  containsPII: boolean;
  containsSecrets: boolean;
  profanityFiltered: boolean;
}

/**
 * Metadata associated with a privacy-aware transcript entry.
 */
export interface PrivacyTranscriptMetadata {
  speaker: "user" | "assistant" | "system";
  confidence?: number;
  azureResponseId?: string;
  privacyIndicators: PrivacyIndicators;
  source?: "realtime" | "cached" | "manual";
}

/**
 * Transcript payload that has passed through privacy redaction.
 */
export interface PrivacyAnnotatedTranscript {
  utteranceId: string;
  sessionId: string;
  content: string;
  classification: Extract<DataClassification, "Sensitive" | "Confidential">;
  redactions: RedactionMatch[];
  retentionExpiresAt: string; // ISO timestamp
  createdAt: string; // ISO timestamp for retention clock start
  metadata: PrivacyTranscriptMetadata;
}

export type PurgeReason =
  | "user-requested"
  | "session-timeout"
  | "policy-update"
  | "error-recovery";

export interface PurgeCommand {
  type: "privacy.purge";
  target: "audio" | "transcripts" | "logs" | "all";
  reason: PurgeReason;
  issuedAt: string;
  correlationId?: string;
}

export interface PurgeResult {
  target: PurgeCommand["target"];
  status: "success" | "partial" | "failed";
  clearedCount: number;
  retainedCount: number;
  retentionNotes?: string[];
  durationMs?: number;
}

export interface PrivacyRetentionWindowConfig {
  audioSeconds: number;
  partialTranscriptSeconds: number;
  finalTranscriptSeconds: number;
  diagnosticsHours: number;
}

export interface PrivacyPolicyConfig {
  retention: PrivacyRetentionWindowConfig;
  redactionRules: RedactionRule[];
  profanityFilter: "none" | "medium" | "high";
  telemetryOptIn: boolean;
  exportEnabled: boolean;
}

export const DEFAULT_PRIVACY_POLICY: PrivacyPolicyConfig = {
  retention: {
    audioSeconds: 5,
    partialTranscriptSeconds: 30,
    finalTranscriptSeconds: 120,
    diagnosticsHours: 24,
  },
  redactionRules: [],
  profanityFilter: "medium",
  telemetryOptIn: false,
  exportEnabled: false,
};

export interface PrivacyPolicySnapshot extends PrivacyPolicyConfig {
  updatedAt: string;
  source: "default" | "user";
}

export interface PrivacyRedactionSummary {
  entryId: string;
  matches: RedactionMatch[];
  appliedRules: RedactionRule[];
}

export type PrivacyChannel = "webview" | "extension-host" | "azure" | "ui";

export interface PrivacyAuditRecord {
  id: string;
  timestamp: string;
  actor: PrivacyChannel;
  action: "purge" | "redact" | "retain" | "block";
  classification: DataClassification;
  metadata?: Record<string, unknown>;
}

export function isDataClassification(
  value: unknown,
): value is DataClassification {
  return (
    typeof value === "string" &&
    DATA_CLASSIFICATIONS.includes(value as DataClassification)
  );
}

export function isPrivacyAnnotatedTranscript(
  value: unknown,
): value is PrivacyAnnotatedTranscript {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as PrivacyAnnotatedTranscript;
  return (
    typeof candidate.utteranceId === "string" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.content === "string" &&
    typeof candidate.retentionExpiresAt === "string" &&
    typeof candidate.createdAt === "string" &&
    Array.isArray(candidate.redactions) &&
    isDataClassification(candidate.classification)
  );
}

export type { RedactionRule };

export function isPurgeCommand(value: unknown): value is PurgeCommand {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as PurgeCommand;
  return (
    candidate.type === "privacy.purge" &&
    ["audio", "transcripts", "logs", "all"].includes(candidate.target) &&
    [
      "user-requested",
      "session-timeout",
      "policy-update",
      "error-recovery",
    ].includes(candidate.reason) &&
    typeof candidate.issuedAt === "string"
  );
}

export function calculateRetentionExpiry(
  createdAt: string,
  ttlSeconds: number,
): string {
  const base = new Date(createdAt).getTime();
  if (Number.isNaN(base) || ttlSeconds <= 0) {
    return new Date().toISOString();
  }
  return new Date(base + ttlSeconds * 1000).toISOString();
}

export function clampRetentionSeconds(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  const maxSeconds = 24 * 60 * 60; // Clamp to 24h for safeguards
  return Math.min(Math.ceil(value), maxSeconds);
}
