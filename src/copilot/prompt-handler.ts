export class PromptHandler {
  private prompt: string;

  constructor() {
    this.prompt = "";
  }

  public setPrompt(prompt: string): void {
    this.prompt = prompt;
  }

  public formatPrompt(): string {
    // Format the prompt for sending to the Copilot integration
    return `User Prompt: ${this.prompt}`;
  }

  public clearPrompt(): void {
    this.prompt = "";
  }
}
