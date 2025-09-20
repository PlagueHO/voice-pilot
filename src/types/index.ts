export interface AudioInput {
    start(): Promise<void>;
    stop(): Promise<void>;
    onData(callback: (data: Buffer) => void): void;
}

export interface STTService {
    transcribe(audioData: Buffer): Promise<string>;
}

export interface TTSService {
    speak(text: string): Promise<void>;
}

export interface ChatIntegration {
    sendPrompt(prompt: string): Promise<string>;
}

export interface PromptHandler {
    formatPrompt(userInput: string): string;
}

export interface FileAnalyzer {
    analyzeFile(filePath: string): Promise<string>;
}

export interface SearchService {
    search(query: string): Promise<string[]>;
}

export interface ContextBuilder {
    buildContext(codeSnippets: string[]): string;
}

export interface IssueCreator {
    createIssue(title: string, body: string): Promise<void>;
}

export interface ApiClient {
    authenticate(token: string): Promise<void>;
    makeRequest(endpoint: string, method: string, data?: any): Promise<any>;
}

export interface ChatPanel {
    displayMessage(message: string): void;
}

export interface StatusBar {
    updateStatus(message: string): void;
}

export interface TranscriptView {
    updateTranscript(transcript: string): void;
}

export interface AzureService {
    authenticate(): Promise<void>;
    callGPTRealtime(prompt: string): Promise<string>;
}

export interface AuthService {
    login(username: string, password: string): Promise<void>;
    logout(): Promise<void>;
}

export * from './configuration';
export * from './credentials';
export * from './ephemeral';

