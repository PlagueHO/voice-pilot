import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import addMetaSchema2020 from "ajv/dist/refs/json-schema-2020-12";
import { randomUUID } from "crypto";
import audioControlStateSchema from "../../spec/schemas/audio.control.state.schema.json";
import audioFeedbackControlSchema from "../../spec/schemas/audio.feedback.control.schema.json";
import audioFeedbackEventSchema from "../../spec/schemas/audio.feedback.event.schema.json";
import audioFeedbackStateSchema from "../../spec/schemas/audio.feedback.state.schema.json";
import audioStreamFrameSchema from "../../spec/schemas/audio.stream.frame.schema.json";
import envelopeSchema from "../../spec/schemas/envelope.schema.json";
import errorFrameSchema from "../../spec/schemas/error.frame.schema.json";
import sttTranscriptDeltaSchema from "../../spec/schemas/stt.transcript.delta.schema.json";
import sttTranscriptFinalSchema from "../../spec/schemas/stt.transcript.final.schema.json";
import telemetryMetricPushSchema from "../../spec/schemas/telemetry.metric.push.schema.json";
import transportChunkSchema from "../../spec/schemas/transport.chunk.schema.json";
import ttsPlayChunkSchema from "../../spec/schemas/tts.play.chunk.schema.json";
import ttsPlayRequestSchema from "../../spec/schemas/tts.play.request.schema.json";
import uiCommandInvokeSchema from "../../spec/schemas/ui.command.invoke.schema.json";
import uiErrorNoticeSchema from "../../spec/schemas/ui.error.notice.schema.json";
import uiPanelInitializeSchema from "../../spec/schemas/ui.panel.initialize.schema.json";
import uiSessionStateSchema from "../../spec/schemas/ui.session.state.schema.json";
import uiTelemetryEventSchema from "../../spec/schemas/ui.telemetry.event.schema.json";
import uiTranscriptAppendSchema from "../../spec/schemas/ui.transcript.append.schema.json";
import uiTranscriptCommitSchema from "../../spec/schemas/ui.transcript.commit.schema.json";
import uiTranscriptRemoveSchema from "../../spec/schemas/ui.transcript.remove.schema.json";
import uiTranscriptTruncatedSchema from "../../spec/schemas/ui.transcript.truncated.schema.json";

export type MessageSource =
  | "host"
  | "webview"
  | "audio-service"
  | "stt-service"
  | "tts-service"
  | "telemetry"
  | "error-service";

export type PrivacyTier = "public" | "customer" | "sensitive";

/**
 * Canonical wire format exchanged between Agent Voice services.
 *
 * @remarks
 * The envelope guarantees a stable metadata contract for routing, auditing, and
 * privacy classification regardless of payload type.
 */
export interface MessageEnvelope<TPayload = unknown> {
  id: string;
  type: string;
  version: string;
  timestamp: string;
  source: MessageSource;
  payload: TPayload;
  correlationId?: string;
  privacyTier?: PrivacyTier;
  sequence?: number;
}

/**
 * Options accepted by {@link createEnvelope} when constructing a new message envelope.
 */
export interface CreateEnvelopeOptions<TPayload> {
  type: string;
  version: string;
  source: MessageSource;
  payload: TPayload;
  id?: string;
  timestamp?: Date | string;
  correlationId?: string;
  privacyTier?: PrivacyTier;
  sequence?: number;
  /**
   * When false, skips schema validation for perf-critical call sites.
   */
  validate?: boolean;
  /**
   * Allows creation for message types that do not yet have a registered schema.
   */
  allowUnknownType?: boolean;
}

export interface ValidateEnvelopeOptions {
  expectedType?: string;
  allowUnknownType?: boolean;
}

export interface ChunkEnvelopeOptions {
  maxBytes?: number;
  compression?: "none" | "gzip";
}

export interface TransportChunkPayload {
  originalType: string;
  chunkIndex: number;
  chunkCount: number;
  data: string;
  compression?: "gzip" | "none";
}

const DEFAULT_CHUNK_VERSION = "1.0.0";
const MAX_ENVELOPE_BYTES = 256 * 1024;
const BASE_SCHEMA_ID = "https://agentvoice/spec/envelope.schema.json";
const CHUNK_TYPE = "transport.chunk";

export class MessageValidationError extends Error {
  constructor(
    message: string,
    readonly errors: string[] = [],
  ) {
    super(message);
    this.name = "MessageValidationError";
  }
}

/**
 * Central registry responsible for schema compilation and retrieval.
 *
 * @remarks
 * Ajv validators are cached per message type to avoid recompilation overhead
 * during high-throughput realtime traffic.
 */
class MessageSchemaRegistry {
  private readonly ajv: Ajv;
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly baseValidator: ValidateFunction;

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      strict: false,
    });
    addMetaSchema2020.call(this.ajv);
    addFormats(this.ajv);

    this.ajv.addSchema(envelopeSchema, BASE_SCHEMA_ID);
    this.baseValidator = this.compileSchema(BASE_SCHEMA_ID, envelopeSchema);

    this.register("ui.session.state", uiSessionStateSchema);
    this.register("ui.command.invoke", uiCommandInvokeSchema);
    this.register("ui.panel.initialize", uiPanelInitializeSchema);
    this.register("ui.transcript.append", uiTranscriptAppendSchema);
    this.register("ui.transcript.commit", uiTranscriptCommitSchema);
    this.register("ui.transcript.remove", uiTranscriptRemoveSchema);
    this.register("ui.transcript.truncated", uiTranscriptTruncatedSchema);
    this.register("ui.telemetry.event", uiTelemetryEventSchema);
    this.register("ui.error.notice", uiErrorNoticeSchema);
    this.register("audio.control.state", audioControlStateSchema);
    this.register("audio.stream.frame", audioStreamFrameSchema);
    this.register("audio.feedback.control", audioFeedbackControlSchema);
    this.register("audio.feedback.state", audioFeedbackStateSchema);
    this.register("audio.feedback.event", audioFeedbackEventSchema);
    this.register("stt.transcript.delta", sttTranscriptDeltaSchema);
    this.register("stt.transcript.final", sttTranscriptFinalSchema);
    this.register("tts.play.request", ttsPlayRequestSchema);
    this.register("tts.play.chunk", ttsPlayChunkSchema);
    this.register("telemetry.metric.push", telemetryMetricPushSchema);
    this.register("error.frame", errorFrameSchema);
    this.register(CHUNK_TYPE, transportChunkSchema);
  }

  hasSchema(type: string): boolean {
    return this.validators.has(type);
  }

  getValidator(type?: string): ValidateFunction {
    if (!type || !this.validators.has(type)) {
      return this.baseValidator;
    }
    return this.validators.get(type)!;
  }

  private register(type: string, schema: unknown): void {
    const schemaId =
      typeof schema === "object" && schema !== null && "$id" in schema
        ? String((schema as { $id?: unknown }).$id)
        : undefined;
    const compiled = this.compileSchema(schemaId ?? type, schema);
    this.validators.set(type, compiled);
  }

  private compileSchema(schemaId: string, schema: unknown): ValidateFunction {
    let validator = this.ajv.getSchema(schemaId);
    if (!validator) {
      validator = this.ajv.compile(schema as object);
    }
    return validator;
  }
}

const registry = new MessageSchemaRegistry();

/**
 * Normalises incoming timestamps into ISO-8601 strings.
 */
function toIsoTimestamp(value?: Date | string): string {
  if (!value) {
    return new Date().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new MessageValidationError(
      `Invalid timestamp provided: ${String(value)}`,
    );
  }
  return parsed.toISOString();
}

/**
 * Formats Ajv validation errors into user-friendly strings for diagnostics.
 */
function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors) {
    return [];
  }
  return errors.map((error) => {
    const instancePath = error.instancePath || "/";
    const keyword = error.keyword;
    const details = [error.message, JSON.stringify(error.params)]
      .filter(Boolean)
      .join(" ");
    return `${instancePath} (${keyword}) ${details}`;
  });
}

export function createEnvelope<TPayload>(
  options: CreateEnvelopeOptions<TPayload>,
): MessageEnvelope<TPayload> {
  const {
    type,
    version,
    source,
    payload,
    id,
    timestamp,
    correlationId,
    privacyTier,
    sequence,
    validate = true,
    allowUnknownType = false,
  } = options;

  const envelope: MessageEnvelope<TPayload> = {
    id: id ?? randomUUID(),
    type,
    version,
    timestamp: toIsoTimestamp(timestamp),
    source,
    payload,
  };

  if (correlationId) {
    envelope.correlationId = correlationId;
  }
  if (privacyTier) {
    envelope.privacyTier = privacyTier;
  }
  if (typeof sequence === "number") {
    envelope.sequence = sequence;
  }

  if (validate) {
    validateEnvelope(envelope, {
      expectedType: type,
      allowUnknownType,
    });
  }

  return envelope;
}

/**
 * Validates an incoming envelope against the registered schema catalogue.
 *
 * @throws {@link MessageValidationError} when the payload fails schema validation.
 */
export function validateEnvelope<TPayload = unknown>(
  input: unknown,
  options: ValidateEnvelopeOptions = {},
): MessageEnvelope<TPayload> {
  if (!input || typeof input !== "object") {
    throw new MessageValidationError("Envelope must be an object");
  }

  const candidate = input as Partial<MessageEnvelope<TPayload>>;
  const typeValue = candidate.type;
  if (typeof typeValue !== "string") {
    throw new MessageValidationError("Envelope missing type identifier");
  }
  if (options.expectedType && typeValue !== options.expectedType) {
    throw new MessageValidationError(
      `Expected envelope type ${options.expectedType} but received ${typeValue}`,
    );
  }

  if (!options.allowUnknownType && typeValue) {
    const hasSchema = registry.hasSchema(typeValue);
    if (!hasSchema) {
      throw new MessageValidationError(
        `No schema registered for envelope type ${typeValue}`,
      );
    }
  }

  const validator = registry.getValidator(typeValue);
  const valid = validator(candidate);
  if (!valid) {
    const errors = formatErrors(validator.errors);
    throw new MessageValidationError(
      `Envelope validation failed for type ${typeValue}`,
      errors,
    );
  }

  return candidate as MessageEnvelope<TPayload>;
}

/**
 * Splits an envelope into multiple transport-safe chunks when its serialized
 * representation exceeds the configured byte budget.
 */
export function chunkEnvelopePayload<TPayload>(
  envelope: MessageEnvelope<TPayload>,
  options: ChunkEnvelopeOptions = {},
): Array<MessageEnvelope<TPayload | TransportChunkPayload>> {
  const maxBytes = options.maxBytes ?? MAX_ENVELOPE_BYTES;
  if (maxBytes <= 0) {
    throw new MessageValidationError("maxBytes must be greater than zero");
  }

  const serialized = Buffer.from(JSON.stringify(envelope), "utf8");
  if (serialized.byteLength <= maxBytes) {
    return [envelope];
  }

  const chunkCount = Math.ceil(serialized.byteLength / maxBytes);
  const chunks: Array<MessageEnvelope<TPayload | TransportChunkPayload>> = [];

  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * maxBytes;
    const end = Math.min(start + maxBytes, serialized.byteLength);
    const slice = serialized.subarray(start, end);
    const base64 = slice.toString("base64");

    const chunkEnvelope = createEnvelope<TransportChunkPayload>({
      type: CHUNK_TYPE,
      version: DEFAULT_CHUNK_VERSION,
      source: envelope.source,
      correlationId: envelope.correlationId ?? envelope.id,
      privacyTier: envelope.privacyTier,
      sequence: index,
      payload: {
        originalType: envelope.type,
        chunkIndex: index,
        chunkCount,
        data: base64,
        compression: options.compression ?? "none",
      },
    });

    chunks.push(chunkEnvelope);
  }

  return chunks;
}

/**
 * Reconstructs a previously chunked envelope, restoring the original payload.
 */
export function reassembleChunks(
  chunks: Array<MessageEnvelope<TransportChunkPayload>>,
): MessageEnvelope<unknown> | null {
  if (chunks.length === 0) {
    return null;
  }

  const sorted = [...chunks].sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
  );
  const first = sorted[0];
  const total = first.payload.chunkCount;
  if (sorted.length !== total) {
    return null;
  }

  const buffers = sorted.map((chunk) =>
    Buffer.from(chunk.payload.data, "base64"),
  );
  const serialized = Buffer.concat(buffers).toString("utf8");

  try {
    const parsed = JSON.parse(serialized);
    return validateEnvelope(parsed, {
      expectedType: first.payload.originalType,
      allowUnknownType: false,
    });
  } catch (error: unknown) {
    throw new MessageValidationError("Failed to reassemble chunked envelope", [
      error instanceof Error ? error.message : String(error ?? "unknown"),
    ]);
  }
}

export class MessageEnvelopeUtils {
  static readonly MAX_BYTES = MAX_ENVELOPE_BYTES;
  /**
   * Convenience alias for {@link createEnvelope}. Retained for legacy call sites migrating off the utility wrapper.
   */
  static create = createEnvelope;
  /** Convenience alias for {@link validateEnvelope}. */
  static validate = validateEnvelope;
  /** Convenience alias for {@link chunkEnvelopePayload}. */
  static chunk = chunkEnvelopePayload;
  /** Convenience alias for {@link reassembleChunks}. */
  static reassemble = reassembleChunks;
}
