# VoicePilot Extension Development Guide

## Architecture Overview

VoicePilot is a **VS Code extension for hands-free voice interaction with GitHub Copilot**. It bridges voice input/output with Copilot's existing context and planning capabilities through Azure OpenAI Realtime (WebRTC) and Azure Speech services.

### Core Design Pattern: Service-Based Architecture with Dependency Injection

The extension follows a **dependency injection pattern** with strict initialization order:
```
Configuration Manager → Ephemeral Key Service → Session Manager → Voice Control Panel
```

All services implement `ServiceInitializable` interface (`src/core/ServiceInitializable.ts`):
- `initialize()`: Setup with error handling
- `dispose()`: Cleanup resources
- `isInitialized()`: State checking

The `ExtensionController` (`src/core/ExtensionController.ts`) orchestrates all services and handles VS Code lifecycle.

## Critical Development Patterns

### 1. Extension Activation & Commands
- **Entry point**: `src/extension.ts` - Keep minimal, delegate to ExtensionController
- **Commands**: All use `voicepilot.*` prefix, registered in `package.json` contributions
- **Activation**: Lazy loading via VS Code activation events (sidebar open, command execution)
- **Performance constraint**: < 5 seconds activation time

### 2. TypeScript Compilation (Important!)
- **Modern Syntax**: ES2022+ target ensures native async/await, class fields, no generator polyfills
- **VS Code Compatibility**: VS Code 1.104+ runs Node.js 22+ supporting all modern JavaScript features
- **Output**: ONLY in `out/` directory, NEVER commit `.js` files in `src/`
- **Clean build**: `find src -name "*.js" -delete && npm run compile` if you see ugly `__generator` code
- **No Legacy Support**: Targets VS Code 1.104+ only - no backward compatibility needed

### 3. Azure Integration Patterns
```typescript
// REST client for non-realtime operations
const openai = new OpenAI({
  apiKey: config.azureOpenAI.apiKey,
  baseURL: `${endpoint}/openai/deployments/${deployment}`
});

// Ephemeral key pattern for WebRTC Realtime
async function getEphemeralKey() {
  return ephemeralService.fetchKey(); // Backend-provided short-lived token
}
```

### 4. VS Code Tasks Workflow
Use **Command Palette → "Tasks: Run Task"** for development:
- `Watch Extension`: Continuous rebuild during development
- `Test Extension`: Runs pretest (compile + lint) then tests
- `Build Bicep`: Compiles infrastructure templates when changed
- `Package Extension`: Creates `.vsix` for distribution

**Inner loop**: Start `Watch Extension` → code → F5 (Extension Development Host) → `Test Extension` → commit

## Project Structure & Key Files

### Core Components (`src/`)
- `extension.ts`: Minimal entry point, delegates to ExtensionController
- `core/ExtensionController.ts`: Central service coordinator with dependency management
- `core/ServiceInitializable.ts`: Interface for standardized service lifecycle
- `config/ConfigurationManager.ts`: VS Code settings integration
- `auth/EphemeralKeyService.ts`: Azure OpenAI token management
- `session/SessionManager.ts`: Voice session lifecycle
- `ui/VoiceControlPanel.ts`: Primary sidebar interface

### Azure/Voice Integration (`src/`)
- `audio/`: STT (Realtime), TTS, microphone capture
- `copilot/`: GitHub Copilot Chat extension bridge
- `codebase/`: File analysis and workspace context
- `github/`: Issue creation and repository integration

### Infrastructure (`infra/`)
- Bicep templates for Azure resources
- **Pattern**: Each `main.bicep` has generated `main.json` sibling
- **Workflow**: Edit `.bicep` → Run `Build Bicep` task → Review `.json` changes

## Dependencies & Integration Points

### Critical NPM Packages
- `openai`: Azure OpenAI compatible client (NOT `@azure/openai`)
- `microsoft-cognitiveservices-speech-sdk`: Azure Speech TTS
- `@azure/identity`: Credential flows for future managed identity
- `ws`: WebSocket utilities for realtime fallbacks
- `axios`: HTTP requests (ephemeral key service)

### VS Code Integration
- **Activity Bar**: `voicepilot` container with sidebar integration
- **Commands**: Registered in `package.json` contributions, handled by ExtensionController
- **Testing**: Uses `@vscode/test-electron` but requires GUI environment (fails in containers)

### External Dependencies
- **Azure OpenAI**: Realtime API for low-latency voice interaction
- **Azure Speech**: High-quality TTS output
- **GitHub Copilot Chat**: Extension APIs for planning and context

## Testing & Debugging

### Local Development
- **F5**: Launch Extension Development Host for manual testing
- **Tests**: Run `Test Extension` task (note: fails in dev containers due to GUI requirements)
- **Debugging**: Set breakpoints in `.ts` files, sourcemaps handle mapping

### Common Issues
- **JS files in src/**: Delete with `find src -name "*.js" -delete` and recompile
- **Lint cache errors**: Run `npx eslint src --ext ts --no-cache`
- **Test failures**: Expected in containers, use F5 for extension testing

### Infrastructure
- **Bicep builds**: PowerShell script enumerates all `main.bicep` files recursively
- **Generated artifacts**: Commit only expected JSON changes, not all generated files

## Copilot Integration Strategy

VoicePilot acts as an **AI manager agent** that:
1. Translates voice input into structured Copilot prompts
2. Leverages Copilot's existing codebase context and MCP server integrations
3. Converts Copilot responses back to optimized speech output
4. Maintains conversation context for planning sessions

This approach avoids reimplementing Copilot's sophisticated context understanding and external integrations.
