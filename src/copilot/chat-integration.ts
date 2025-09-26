import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import type { CopilotResponseEvent } from '../conversation/conversation-state-machine';
import { Logger } from '../core/logger';

export interface CopilotPromptOptions {
    conversationId?: string;
    turnId?: string;
    metadata?: Record<string, unknown>;
}

export class ChatIntegration {
    private readonly responseEmitter = new vscode.EventEmitter<CopilotResponseEvent>();
    private readonly logger: Logger;

    constructor(logger?: Logger) {
        this.logger = logger ?? new Logger('ChatIntegration');
        this.logger.info('ChatIntegration initialized (placeholder)');
    }

    public onResponse(handler: (event: CopilotResponseEvent) => void): vscode.Disposable {
        return this.responseEmitter.event(handler);
    }

    public dispose(): void {
        this.responseEmitter.dispose();
    }

    public async sendPrompt(prompt: string, options?: CopilotPromptOptions): Promise<string> {
        const requestId = randomUUID();
        const timestamp = new Date().toISOString();
        this.responseEmitter.fire({
            requestId,
            status: 'pending',
            timestamp,
            context: {
                conversationId: options?.conversationId,
                turnId: options?.turnId,
                metadata: options?.metadata,
                promptLength: prompt.length
            }
        });

        try {
            this.logger.debug('Dispatching prompt to Copilot placeholder', {
                requestId,
                promptPreview: prompt.slice(0, 40),
                promptLength: prompt.length
            });

            // Placeholder implementation until official Copilot Chat APIs are available
            const response = `Placeholder response to: ${prompt.slice(0, 60)}`;

            this.responseEmitter.fire({
                requestId,
                status: 'completed',
                timestamp: new Date().toISOString(),
                content: response,
                context: {
                    conversationId: options?.conversationId,
                    turnId: options?.turnId
                }
            });

            return response;
        } catch (error: any) {
            const message = error?.message ?? 'Unknown Copilot error';
            this.logger.error('Copilot prompt failed', { requestId, message });
            this.responseEmitter.fire({
                requestId,
                status: 'failed',
                timestamp: new Date().toISOString(),
                error: {
                    message,
                    retryable: false
                },
                context: {
                    conversationId: options?.conversationId,
                    turnId: options?.turnId
                }
            });
            throw new Error('Failed to get response from Copilot');
        }
    }
}
