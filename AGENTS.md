# AGENTS.md

## Project Overview

VoicePilot is a VS Code extension that enables voice-driven interaction with GitHub Copilot and codebases. Built with TypeScript, it integrates Azure AI services for speech-to-text (GPT-Realtime), text-to-speech, and provides conversational coding assistance through natural language.

## Core Architecture

- **Extension Entry**: `src/extension.ts` - VS Code extension activation and command registration
- **Audio Pipeline**: `src/audio/` - STT via Azure GPT-Realtime, TTS via Azure Speech, microphone capture
- **Copilot Integration**: `src/copilot/` - Chat with GitHub Copilot extension APIs
- **Codebase Context**: `src/codebase/` - File analysis, search, and context building using VS Code APIs
- **GitHub Integration**: `src/github/` - Issue creation via GitHub API
- **UI Components**: `src/ui/` - Chat panels, status bar, transcript views

## Development Commands

```bash
# Install dependencies
npm install

# Build extension
npm run compile

# Watch mode for development
npm run watch

# Package extension
npm run package

# Run tests
npm run test

# Lint code
npm run lint
```

## VS Code Extension Development

- **Test the extension**: Press F5 to launch Extension Development Host
- **Debug**: Set breakpoints in TypeScript files, use VS Code debugger
- **Package**: Use `vsce package` to create .vsix file for distribution
- **Dependencies**: Key packages include `@azure/openai`, `@vscode/vscode-uri`, `vscode` API types

## Azure Integration Patterns

All Azure services use consistent authentication and configuration:

```typescript
// Azure OpenAI for GPT-Realtime STT
const client = new AzureOpenAI({
    endpoint: config.azureOpenAI.endpoint,
    apiKey: config.azureOpenAI.apiKey,
    apiVersion: "2024-10-01-preview"
});

// Azure Speech for TTS
const speechConfig = SpeechConfig.fromSubscription(
    config.azureSpeech.apiKey,
    config.azureSpeech.region
);
```

## Code Style & Conventions

- **TypeScript**: Strict mode enabled, prefer interfaces over types
- **Async/Await**: Use throughout for all async operations
- **Error Handling**: Wrap Azure API calls in try-catch, log errors with context
- **VS Code APIs**: Use `vscode.window`, `vscode.workspace`, `vscode.commands` namespaces
- **File Organization**: Group by feature (audio, copilot, github) not by type

## Testing Instructions

- **Unit Tests**: Jest with VS Code extension testing framework
- **Integration Tests**: Test with mock VS Code APIs and Azure services
- **Manual Testing**: Use Extension Development Host to test voice flows
- **Audio Testing**: Test with different microphones and audio devices

## Critical Dependencies

- `vscode` - VS Code extension API (engine compatibility in package.json)
- `@azure/openai` - GPT-Realtime for speech-to-text
- `@azure/cognitiveservices-speech-sdk` - Text-to-speech
- `@vscode/copilot-chat` - Integration with GitHub Copilot Chat extension
- `ws` - WebSocket for real-time audio streaming

## Configuration Management

Extension uses VS Code settings for user configuration:

- `voicepilot.azureOpenAI.*` - Azure OpenAI credentials and endpoints
- `voicepilot.azureSpeech.*` - Azure Speech service configuration
- `voicepilot.github.*` - GitHub authentication and repository settings

## Security Considerations

- **API Keys**: Store in VS Code secret storage, never in plain text
- **Authentication**: Use VS Code's built-in GitHub auth when possible
- **Audio Privacy**: Process audio locally when possible, clear buffers after use
- **Network**: All Azure calls use HTTPS, validate SSL certificates

## Extension Lifecycle

1. **Activation**: Register commands, initialize services, setup UI
2. **Voice Input**: Capture audio → Azure STT → process command
3. **Copilot Interaction**: Send prompt → receive response → TTS output
4. **GitHub Actions**: Create issues, search repositories
5. **Deactivation**: Cleanup resources, dispose services

## Debugging Tips

- **Audio Issues**: Check microphone permissions, Azure Speech service quotas
- **Copilot Integration**: Verify GitHub Copilot Chat extension is installed and active
- **Azure Connectivity**: Test endpoints with curl, check API key validity
- **VS Code APIs**: Use VS Code Extension Host logs for API debugging

## Common Commands

```bash
# Install VS Code Extension CLI
npm install -g @vscode/vsce

# Package for marketplace
vsce package

# Publish to marketplace
vsce publish

# Generate types for VS Code API
npm run vscode:prepublish
```
