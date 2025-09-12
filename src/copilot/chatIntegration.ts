import { CopilotChatClient } from '@vscode/copilot-chat'; // Import the Copilot Chat client

export class ChatIntegration {
    private client: CopilotChatClient;

    constructor() {
        this.client = new CopilotChatClient();
    }

    // Method to send a prompt to Copilot and receive a response
    public async sendPrompt(prompt: string): Promise<string> {
        try {
            const response = await this.client.sendMessage(prompt);
            return response.text; // Return the text response from Copilot
        } catch (error) {
            console.error('Error sending prompt to Copilot:', error);
            throw new Error('Failed to get response from Copilot');
        }
    }

    // Method to handle incoming messages from Copilot
    public onMessage(callback: (message: string) => void): void {
        this.client.onMessage((message) => {
            callback(message.text); // Call the callback with the message text
        });
    }
}