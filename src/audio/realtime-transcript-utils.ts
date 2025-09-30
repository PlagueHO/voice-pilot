import type {
  RealtimeDeltaPayload,
  RealtimeEvent,
} from "../types/realtime-events";

const TRANSCRIPT_TEXT_KEYS: Array<string> = ["text", "transcript", "content"];

/**
 * Attempt to extract textual transcript content from a realtime event payload.
 * Supports both legacy string-based deltas and new object-based delta formats.
 */
export function extractTranscriptText(
  message: RealtimeEvent,
): string | undefined {
  const candidateFromDelta = getTextFromDelta(
    (message as { delta?: RealtimeDeltaPayload | undefined }).delta,
  );

  if (candidateFromDelta !== undefined) {
    return candidateFromDelta;
  }

  // Fallbacks for message formats that surface transcript content directly.
  const possibleDirectText = getFirstStringProperty(
    message,
    TRANSCRIPT_TEXT_KEYS,
  );
  if (possibleDirectText !== undefined) {
    return possibleDirectText;
  }

  return undefined;
}

/**
 * Extracts the first non-empty string payload from a realtime delta structure.
 * @param delta - Realtime delta payload to inspect, supporting string or object formats.
 * @returns The first non-empty string extracted from the payload, or `undefined` if none is found.
 */
export function getTextFromDelta(
  delta: RealtimeDeltaPayload | undefined,
): string | undefined {
  if (delta === undefined || delta === null) {
    return undefined;
  }

  if (typeof delta === "string") {
    return delta;
  }

  if (typeof delta === "object") {
    const textCandidate = getFirstStringProperty(delta, TRANSCRIPT_TEXT_KEYS);
    if (textCandidate !== undefined) {
      return textCandidate;
    }

    const nestedDelta = (delta as Record<string, unknown>).delta;
    if (typeof nestedDelta === "string") {
      return nestedDelta;
    }
  }

  return undefined;
}

/**
 * Finds the first key in the provided list whose value on the source object is a non-empty string.
 * @param source - Object inspected for string values.
 * @param keys - Prioritized list of property keys to evaluate.
 * @returns The first non-empty string value matched by the provided keys, or `undefined` when none exist.
 */
function getFirstStringProperty(
  source: Record<string, unknown> | RealtimeEvent,
  keys: Array<string>,
): string | undefined {
  for (const key of keys) {
    const value = (source as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}
