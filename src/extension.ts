import * as vscode from 'vscode';
import { STTService } from './audio/sttService';
import { TTSService } from './audio/ttsService';
import { ChatIntegration } from './copilot/chatIntegration';
import { FileAnalyzer } from './codebase/fileAnalyzer';
import { IssueCreator } from './github/issueCreator';
import { AzureService } from './services/azureService';
import { AuthService } from './services/authService';
import { ChatPanel } from './ui/chatPanel';
import { StatusBar } from './ui/statusBar';
import { TranscriptView } from './ui/transcriptView';

export function activate(context: vscode.ExtensionContext) {
    const sttService = new STTService();
    const ttsService = new TTSService();
    const chatIntegration = new ChatIntegration();
    const fileAnalyzer = new FileAnalyzer();
    const issueCreator = new IssueCreator();
    const azureService = new AzureService();
    const authService = new AuthService();
    const chatPanel = new ChatPanel();
    const statusBar = new StatusBar();
    const transcriptView = new TranscriptView();

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('voicepilot.startListening', () => {
            sttService.start();
        }),
        vscode.commands.registerCommand('voicepilot.stopListening', () => {
            sttService.stop();
        }),
        vscode.commands.registerCommand('voicepilot.sendPrompt', async () => {
            const prompt = await vscode.window.showInputBox({ prompt: 'Enter your prompt' });
            if (prompt) {
                const response = await chatIntegration.sendPrompt(prompt);
                ttsService.speak(response);
            }
        }),
        vscode.commands.registerCommand('voicepilot.createIssue', async () => {
            const issueDetails = await vscode.window.showInputBox({ prompt: 'Enter issue details' });
            if (issueDetails) {
                issueCreator.createIssue(issueDetails);
            }
        })
    );

    // Set up status bar
    statusBar.updateStatus('VoicePilot is active');

    // Set up event listeners
    vscode.window.onDidChangeActiveTextEditor(() => {
        const activeFile = vscode.window.activeTextEditor?.document.fileName;
        if (activeFile) {
            fileAnalyzer.analyzeFile(activeFile);
        }
    });

    // Initialize transcript view
    transcriptView.initialize();
}

export function deactivate() {
    // Cleanup resources if necessary
}