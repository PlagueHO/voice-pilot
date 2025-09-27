import { randomUUID } from "crypto";
import * as vscode from "vscode";
import type { CopilotResponseEvent } from "../conversation/conversation-state-machine";
import { Logger } from "../core/logger";

/**
 * Metadata used when dispatching prompts to GitHub Copilot.
 */
export interface CopilotPromptOptions {
  /** Maps the prompt to an existing VoicePilot conversation. */
  conversationId?: string;
  /** Associates the prompt with a specific conversation turn. */
  turnId?: string;
  /** Carries arbitrary structured metadata for downstream processors. */
  metadata?: Record<string, unknown>;
}

/**
 * Bridges VoicePilot conversation events to the Copilot Chat APIs.
 *
 * @remarks
 * This implementation currently emits placeholder responses while the
 * official Copilot integration APIs are finalized. It still raises lifecycle
 * events to keep the conversation state machine in sync.
 */
export class ChatIntegration {
  private readonly responseEmitter =
    new vscode.EventEmitter<CopilotResponseEvent>();
  private readonly logger: Logger;

  /**
   * Creates a new chat integration instance.
   *
   * @param logger Optional logger instance; defaults to a scoped logger.
   */
  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger("ChatIntegration");
    this.logger.info("ChatIntegration initialized (placeholder)");
  }

  /**
   * Registers a listener for Copilot response events.
   *
   * @param handler Callback invoked whenever a response event is emitted.
   * @returns Disposable that removes the listener when disposed.
   */
  public onResponse(
    handler: (event: CopilotResponseEvent) => void,
  ): vscode.Disposable {
    return this.responseEmitter.event(handler);
  }

  /**
   * Releases resources held by the chat integration.
   */
  public dispose(): void {
    this.responseEmitter.dispose();
  }

  /**
   * Sends a prompt to Copilot and emits lifecycle events representing the
   * request progress.
   *
   * @param prompt Text prompt to forward to Copilot.
   * @param options Optional metadata linking the prompt to the current session.
   * @returns The Copilot response content (placeholder implementation).
   * @throws Error when the underlying call fails or encounters an unexpected issue.
   */
  public async sendPrompt(
    prompt: string,
    options?: CopilotPromptOptions,
  ): Promise<string> {
    const requestId = randomUUID();
    const timestamp = new Date().toISOString();
    this.responseEmitter.fire({
      requestId,
      status: "pending",
      timestamp,
      context: {
        conversationId: options?.conversationId,
        turnId: options?.turnId,
        metadata: options?.metadata,
        promptLength: prompt.length,
      },
    });

    try {
      this.logger.debug("Dispatching prompt to Copilot placeholder", {
        requestId,
        promptPreview: prompt.slice(0, 40),
        promptLength: prompt.length,
      });

      // Placeholder implementation until official Copilot Chat APIs are available
      const response = `Placeholder response to: ${prompt.slice(0, 60)}`;

      this.responseEmitter.fire({
        requestId,
        status: "completed",
        timestamp: new Date().toISOString(),
        content: response,
        context: {
          conversationId: options?.conversationId,
          turnId: options?.turnId,
        },
      });

      return response;
    } catch (error: any) {
      const message = error?.message ?? "Unknown Copilot error";
      this.logger.error("Copilot prompt failed", { requestId, message });
      this.responseEmitter.fire({
        requestId,
        status: "failed",
        timestamp: new Date().toISOString(),
        error: {
          message,
          retryable: false,
        },
        context: {
          conversationId: options?.conversationId,
          turnId: options?.turnId,
        },
      });
      throw new Error("Failed to get response from Copilot");
    }
  }
}
