import * as vscode from "vscode";
import { STTService } from "./audio/sttService";
import { TTSService } from "./audio/ttsService";
import { FileAnalyzer } from "./codebase/fileAnalyzer";
import { ChatIntegration } from "./copilot/chatIntegration";
import { ApiClient } from "./github/apiClient";
import { IssueCreator } from "./github/issueCreator";
import { AuthService } from "./services/authService";
import { AzureService } from "./services/azureService";
import { ChatPanel } from "./ui/chatPanel";
import { StatusBar } from "./ui/statusBar";
import { TranscriptView } from "./ui/transcriptView";

export function activate(context: vscode.ExtensionContext) {
    // Initialize services with required parameters
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT || "";
    const deploymentName =
        process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-4o-realtime-preview";
    const apiVersion = process.env.OPENAI_API_VERSION || "2025-08-28";

    const sttService = new STTService(endpoint, deploymentName, apiVersion);
    const ttsService = new TTSService();
    const chatIntegration = new ChatIntegration();
    const fileAnalyzer = new FileAnalyzer([]);
    const issueCreator = new IssueCreator(
        new ApiClient("https://api.github.com")
    );
    const azureService = new AzureService();
    const authService = new AuthService();
    const chatPanel = new ChatPanel(context.extensionUri);
    const statusBar = new StatusBar();
    const transcriptView = new TranscriptView();

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand("voicepilot.startListening", () => {
            sttService.start();
        }),
        vscode.commands.registerCommand("voicepilot.stopListening", () => {
            sttService.stop();
        }),
        vscode.commands.registerCommand("voicepilot.sendPrompt", async () => {
            const prompt = await vscode.window.showInputBox({
                prompt: "Enter your prompt",
            });
            if (prompt) {
                const response = await chatIntegration.sendPrompt(prompt);
                ttsService.speak(response);
            }
        }),
        vscode.commands.registerCommand("voicepilot.createIssue", async () => {
            const repo = await vscode.window.showInputBox({
                prompt: "Enter repository (owner/repo)",
            });
            const title = await vscode.window.showInputBox({
                prompt: "Enter issue title",
            });
            const body = await vscode.window.showInputBox({
                prompt: "Enter issue description",
            });
            if (repo && title && body) {
                issueCreator.createIssue(repo, title, body);
            }
        })
    );

    // Set up status bar
    statusBar.updateStatus("VoicePilot is active");

    // Set up event listeners
    vscode.window.onDidChangeActiveTextEditor(() => {
        const activeFile = vscode.window.activeTextEditor?.document.fileName;
        if (activeFile) {
            // Note: analyzeFiles method doesn't match the intended usage,
            // this may need to be refactored based on actual requirements
            fileAnalyzer.analyzeFiles();
        }
    });

    // Initialize transcript view (remove if initialize method doesn't exist)
    // transcriptView.initialize();
}

export function deactivate() {
    // Cleanup resources if necessary
}
