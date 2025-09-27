/**
 * Maintains the current user prompt and generates formatted payloads for Copilot.
 */
export class PromptHandler {
  /** Last prompt captured from the conversation pipeline. */
  private prompt: string;

  /**
   * Creates a prompt handler with an empty initial prompt state.
   */
  constructor() {
    this.prompt = "";
  }

  /**
   * Updates the stored prompt text prior to dispatching.
   *
   * @param prompt Raw prompt text gathered from the conversation.
   */
  public setPrompt(prompt: string): void {
    this.prompt = prompt;
  }

  /**
   * Formats the prompt for downstream Copilot integration.
   *
   * @returns A user-friendly prompt wrapper string.
   */
  public formatPrompt(): string {
    // Format the prompt for sending to the Copilot integration
    return `User Prompt: ${this.prompt}`;
  }

  /**
   * Clears the prompt buffer to avoid reusing stale text.
   */
  public clearPrompt(): void {
    this.prompt = "";
  }
}
