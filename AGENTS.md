# VoicePilot VS Code Extension Development Guide

## Project Overview

This repository contains a VS Code extension for voice interaction with GitHub Copilot. VoicePilot enables natural, low-latency voice interaction with GitHub Copilot and the active codebase using Azure OpenAI Realtime API, Azure Speech Services, and a service-based dependency injection architecture. The extension serves as an AI manager agent that orchestrates VS Code GitHub Copilot, acting as an intelligent translator between voice interactions and Copilot's planning and specification capabilities.

When working on the project interactively with an agent, please follow the guidelines below to ensure the development experience – particularly TypeScript compilation and VS Code extension debugging – continues to work smoothly.

## Tech Stack

- **Framework**: VS Code Extension API with TypeScript
- **Language**: TypeScript 5.0+ (ES2022 target)
- **Voice Input**: Azure OpenAI Realtime API (WebRTC) / Azure Speech SDK
- **Text-to-Speech**: Azure Speech Services / microsoft-cognitiveservices-speech-sdk
- **AI Integration**: GitHub Copilot Chat Extension APIs
- **Authentication**: Azure Identity SDK, VS Code SecretStorage
- **HTTP Client**: OpenAI SDK (Azure-compatible), Axios
- **WebSocket**: ws library for realtime connections
- **Testing**: Mocha with @vscode/test-electron
- **Build System**: TypeScript compiler, VS Code Extension packaging
- **Infrastructure**: Azure Bicep templates
- **Development**: VS Code Tasks system, ESLint, npm scripts

## Development Environment Setup

### Installation Requirements

- **Node.js 22+** (for VS Code 1.104+ compatibility)
- **VS Code 1.104+** (modern JavaScript features support)
- **Azure CLI** (for infrastructure deployment)
- **Git** (version control)
- **PowerShell** (for Bicep build tasks)

### Installation Steps

```bash
# Clone and install dependencies
git clone <repository-url>
cd voice-pilot
npm install

# Install global tools (if needed)
npm install -g @vscode/vsce  # Extension packaging

# Install Azure CLI and Bicep
az --version
az bicep version
```

**Key Dependencies**: `openai`, `microsoft-cognitiveservices-speech-sdk`, `@azure/identity`, `ws`, `axios`

## Project Structure

```text
voice-pilot/
├── src/                                # Source code
│   ├── extension.ts                    # Extension entry point
│   ├── core/                          # Core services and patterns
│   │   ├── ExtensionController.ts     # Central service coordinator
│   │   ├── ServiceInitializable.ts    # Service lifecycle interface
│   │   └── logger.ts                  # Structured logging
│   ├── config/                        # Configuration management
│   │   ├── ConfigurationManager.ts    # VS Code settings integration
│   │   ├── sections/                  # Config section handlers
│   │   └── validators/                # Configuration validation
│   ├── auth/                          # Authentication services
│   │   ├── EphemeralKeyService.ts     # Azure token management
│   │   ├── CredentialManager.ts       # Credential handling
│   │   └── validators/                # Credential validation
│   ├── audio/                         # Voice I/O services
│   │   ├── audioCapture.ts            # Microphone input
│   │   ├── sttService.ts              # Speech-to-text
│   │   └── ttsService.ts              # Text-to-speech
│   ├── copilot/                       # GitHub Copilot integration
│   │   ├── chatIntegration.ts         # Copilot Chat API bridge
│   │   └── promptHandler.ts           # Voice → Copilot translation
│   ├── session/                       # Voice session management
│   │   └── SessionManager.ts          # Conversation state
│   ├── ui/                           # User interface components
│   │   ├── VoiceControlPanel.ts       # Main sidebar panel
│   │   ├── statusBar.ts               # Status bar integration
│   │   └── transcriptView.ts          # Conversation history
│   ├── types/                         # TypeScript definitions
│   │   ├── configuration.ts           # Config type definitions
│   │   ├── credentials.ts             # Auth type definitions
│   │   └── index.ts                   # Exported types
│   └── test/                          # Test suites
│       ├── extension.lifecycle.test.ts
│       ├── auth/                      # Authentication tests
│       ├── config/                    # Configuration tests
│       └── session/                   # Session management tests
├── infra/                             # Azure infrastructure
│   ├── main.bicep                     # Main deployment template
│   ├── cognitive-services/            # Azure AI services
│   └── core/                          # Shared infrastructure
├── docs/                              # Documentation
│   ├── design/                        # Architecture documents
│   ├── spikes/                        # Technical investigations
│   └── validation/                    # Acceptance criteria
├── package.json                       # Extension manifest
├── tsconfig.json                      # TypeScript configuration
└── .vscode/                          # VS Code workspace settings
    ├── tasks.json                     # Build and development tasks
    └── launch.json                    # Debug configurations
```

## Core Development Principles

### Development Principles

> [!IMPORTANT]
> You MUST read and follow these principles to ensure code quality, maintainability, and collaboration. No code shall be created or merged that violates these principles.

- **Clean Code**: Always use clean code principles and TypeScript best practices
- **Modular Design**: Feature-based folder structure; single responsibility per module
- **Async/Await**: Use async/await for all asynchronous operations
- **SOLID**: Follow SOLID principles for maintainable code
- **DRY**: Avoid code duplication; abstract common logic
- **Code Smells**: Refactor to eliminate long methods, large classes, and complex conditionals
- **Naming Conventions**: Consistent camelCase for variables/functions, PascalCase for classes/interfaces. Prioritize meaningful names and self-documenting code
- **Prioritize Readability**: Clear naming, comments, and documentation
- **Code Documentation**: Use JSDoc comments for all public APIs and complex logic. Prioritize readable code over excessive comments

### Development Workflow and Architecture

- Use VS Code Tasks workflow exclusively; avoid direct npm commands during agent sessions
- Follow service-based dependency injection pattern with ServiceInitializable interface
- Use F5 (Extension Development Host) for testing and debugging
- Maintain strict initialization order: Config → Auth → Session → UI

### TypeScript and Code Quality

- Use TypeScript 5.0+ with ES2022 target for modern JavaScript features
- Enable strict mode; avoid `any` types; prefer interfaces over types for object shapes
- Use modern async/await patterns; avoid generators and callbacks
- Implement feature-based folder structure with single responsibility modules

### Azure and External Service Integration

- Use `openai` package pointed at Azure endpoints (not `@azure/openai`)
- Implement ephemeral key pattern for Azure OpenAI Realtime API
- Use `microsoft-cognitiveservices-speech-sdk` for text-to-speech
- Store credentials securely using VS Code SecretStorage

### Extension Development Best Practices

- Use VS Code extension APIs following official guidelines and patterns
- Implement proper command registration with error handling
- Use webview panels for complex UI with proper security settings
- Follow VS Code's contribution points for UI integration (commands, views, settings)

### Testing Guidelines

- Use Mocha with `@vscode/test-electron` for Extension Development Host testing
- Implement unit, integration, compatibility, and performance tests
- Never run Mocha directly; always use VS Code test runner
- Use headless testing with xvfb for CI environments

### Performance and Error Handling

- Implement lazy loading for heavy services to optimize startup time
- Use debounced updates for configuration changes
- Implement structured error handling with proper user feedback
- Follow VS Code extension performance guidelines for memory and CPU usage

### VS Code Tasks Workflow

**Always use VS Code Tasks** from the Command Palette → "Tasks: Run Task" for development workflows.

**Do _not_ run commands like `npm run build` or `npm run watch` directly** in terminal during agent sessions. The VS Code task system properly manages background processes and dependencies.

**Use F5 (Extension Development Host)** to test changes, not `code --extensionDevelopmentPath`.

| Task | Purpose | When To Use |
|------|---------|-------------|
| `Watch Extension` | Continuous TypeScript build | Start this first, keep running |
| `Compile Extension` | One-time build | Quick validation |
| `Test Extension` | Run test suite | Before commits |
| `Lint Extension` | Static analysis | Before commits |
| `Build Bicep` | Compile infrastructure | After infra changes |
| `Package Extension` | Create `.vsix` | Release preparation |

### Service Architecture Pattern

VoicePilot follows a **dependency injection pattern** with strict initialization order:

```typescript
// All services implement ServiceInitializable interface
interface ServiceInitializable {
  initialize(): Promise<void>;
  dispose(): void;
  isInitialized(): boolean;
}

// Initialization chain: Config → Auth → Session → UI
Configuration Manager → Ephemeral Key Service → Session Manager → Voice Control Panel
```

**Critical Guidelines**:

- **Never directly instantiate services** – use the ExtensionController for coordination
- **Always await initialization** before using any service
- **Follow the disposal pattern** in the `deactivate()` function

### TypeScript Configuration

**Target Configuration**: Extension targets ES2022 for Node.js 22+ (VS Code 1.104+)

- **Target**: ES2022 (Node.js 22+ support in VS Code 1.104+)
- **Output**: Only compiled `.js` files go to `out/` directory
- **Source**: Only `.ts` files in `src/` directory
- **No legacy polyfills**: Modern async/await, class fields, all ES2022+ features

```typescript
// Use modern patterns - no __generator or __awaiter functions
export class ExampleService implements ServiceInitializable {
  private initialized = false;

  async initialize(): Promise<void> {
    // Native async/await, no transpilation needed
    const result = await this.setupService();
    this.initialized = true;
  }
}
```

### Azure Integration Patterns

**Integration Approach**: Use Azure OpenAI compatible clients with VS Code extension architecture

- **REST API**: Use `openai` package (not `@azure/openai`) pointed at Azure endpoints
- **Ephemeral Keys**: Short-lived tokens for Realtime API (backend service required)
- **Speech Services**: `microsoft-cognitiveservices-speech-sdk` for TTS

```typescript
// Standard pattern for Azure OpenAI client
const openai = new OpenAI({
  apiKey: config.azureOpenAI.apiKey,
  baseURL: `${endpoint}/openai/deployments/${deployment}`
});

// Ephemeral key pattern for WebRTC Realtime
async function getEphemeralKey() {
  return ephemeralService.fetchKey(); // Backend-provided short-lived token
}
```

### VS Code Extension Patterns

**Extension Development Guidelines**: Follow VS Code extension best practices for lifecycle and UI

```typescript
// Extension activation pattern
export async function activate(context: vscode.ExtensionContext) {
  const controller = new ExtensionController(context);
  await controller.initialize();

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('voicepilot.startSession',
      () => controller.startVoiceSession())
  );
}

// Extension deactivation with proper cleanup
export async function deactivate() {
  await ExtensionController.dispose();
}
```

## UI and User Experience

### Extension UI Components

**Main Interface**: Sidebar panel with voice control and transcript view

```typescript
// Voice Control Panel implementation
export class VoiceControlPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'voicepilot.voiceControl';

  constructor(private readonly context: vscode.ExtensionContext) {}

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
  }
}
```

### Status Bar Integration

**Status Indicator**: Show current voice session state

```typescript
// Status bar item for voice session status
const statusBarItem = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Right, 100
);
statusBarItem.text = "$(mic) VoicePilot";
statusBarItem.command = 'voicepilot.toggleSession';
statusBarItem.show();
```

## Configuration Management

### VS Code Settings Integration

**Configuration Pattern**: Use VS Code's configuration API with validation

```typescript
// Configuration section implementation
export class AzureOpenAIConfigSection implements ConfigSection {
  readonly name = 'azureOpenAI';

  validate(config: vscode.WorkspaceConfiguration): ValidationResult {
    const endpoint = config.get<string>('endpoint');
    const deployment = config.get<string>('deployment');

    if (!endpoint || !deployment) {
      return { isValid: false, errors: ['Missing required Azure OpenAI configuration'] };
    }

    return { isValid: true, errors: [] };
  }
}
```

### Secret Storage Pattern

**Credential Management**: Use VS Code SecretStorage for sensitive data

```typescript
// Secure credential storage
export class CredentialManager {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async storeAzureKey(key: string): Promise<void> {
    await this.secrets.store('voicepilot.azure.key', key);
  }

  async getAzureKey(): Promise<string | undefined> {
    return await this.secrets.get('voicepilot.azure.key');
  }
}
```

## Testing and Quality Assurance

### Testing Framework Implementation

**Framework**: Mocha with `@vscode/test-electron` for Extension Development Host testing

**Test Types Implemented**:

- **Unit Tests**: Core service functionality (mocked dependencies)
- **Integration Tests**: Extension activation, command flows, VS Code API interaction
- **Compatibility Tests**: Multi-version VS Code testing (1.104.0, 1.105.0, stable)
- **Performance Tests**: Extension startup time and benchmark measurements

**Test Execution**:

- **Local Development**: Use `F5` (Extension Development Host) or `npm test`
- **CI Pipeline**: Headless testing with xvfb display for Linux environments
- **Test Discovery**: Automatic via glob pattern `out/test/**/*.test.js`

**Enhanced NPM Scripts**:

```bash
npm run test:headless    # CI-compatible headless testing
npm run test:coverage    # Coverage reporting with nyc
npm run test:perf        # Performance benchmarks
```

**Critical Guidelines**:

- **Never run Mocha directly** – always use VS Code test runner
- **Tests fail in containers** without proper headless setup (use xvfb)
- **Structure**: `src/test/` → compiled to `out/test/`
- **Isolation**: Tests run with `--disable-extensions` flag for clean environment

### Code Quality Standards

**TypeScript Guidelines**: Strict typing and modern patterns

- **TypeScript**: ES2022 target, strict mode enabled, no `any` types
- **Async Patterns**: Use modern async/await, avoid generators/callbacks
- **Imports**: Feature-based folder structure, single responsibility modules
- **Error Handling**: Contextual logging with structured error objects
- **Documentation**: JSDoc for public APIs, self-documenting code preferred

## Error Handling and Performance

### Error Handling Patterns

**Extension Error Management**: Graceful error handling with user feedback

```typescript
// Error handling with logging and user notification
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean = true
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

// Error handler utility
export async function handleServiceError(error: unknown, context: string) {
  const logger = getLogger();

  if (error instanceof ServiceError) {
    logger.error(`${context}: ${error.message}`, { code: error.code });

    if (!error.recoverable) {
      vscode.window.showErrorMessage(`VoicePilot: ${error.message}`);
    }
  } else {
    logger.error(`${context}: Unexpected error`, { error });
    vscode.window.showErrorMessage('VoicePilot: An unexpected error occurred');
  }
}
```

### Performance Optimization

**Extension Performance Guidelines**: Optimize for startup time and memory usage

```typescript
// Lazy loading pattern for heavy services
class AudioService implements ServiceInitializable {
  private audioCapture?: AudioCapture;

  async getAudioCapture(): Promise<AudioCapture> {
    if (!this.audioCapture) {
      const { AudioCapture } = await import('./audioCapture');
      this.audioCapture = new AudioCapture();
      await this.audioCapture.initialize();
    }
    return this.audioCapture;
  }
}

// Debounced configuration updates
const debouncedConfigUpdate = debounce(async (config: Configuration) => {
  await configurationManager.updateConfiguration(config);
}, 300);
```

## Extension Development Guidelines

### Development Workflow

**Run / Debug**: Press F5 to launch Extension Development Host
**Breakpoints**: Place in TypeScript sources; sourcemaps map to `out/`
**Packaging**: `npm run package` produces a `.vsix` (uses `vsce`)
**Target Version**: VS Code 1.104+ (Node.js 22+) for modern JavaScript features

### Command Registration Pattern

```typescript
// Command registration with proper error handling
export function registerCommands(context: vscode.ExtensionContext) {
  const commands = [
    { id: 'voicepilot.startSession', handler: () => sessionManager.start() },
    { id: 'voicepilot.stopSession', handler: () => sessionManager.stop() },
    { id: 'voicepilot.toggleMute', handler: () => audioService.toggleMute() }
  ];

  commands.forEach(({ id, handler }) => {
    const disposable = vscode.commands.registerCommand(id, async () => {
      try {
        await handler();
      } catch (error) {
        await handleServiceError(error, `Command: ${id}`);
      }
    });
    context.subscriptions.push(disposable);
  });
}
```

## Useful Commands Reference

| Command | Purpose |
|---------|---------|
| `F5` | Launch Extension Development Host |
| `Ctrl+Shift+B` | Default build task (Compile Extension) |
| `Command Palette → Tasks: Run Task` | Access all development tasks |
| `npm test` | Run test suite with pretest steps |
| `npm run test:headless` | CI-compatible headless testing |
| `npm run test:coverage` | Run tests with coverage reporting |
| `npm run test:perf` | Run performance benchmarks |
| `npm run package` | Create `.vsix` for distribution |
| `npm run package:check` | Validate extension packaging |

---

This comprehensive guide provides a solid foundation for building a scalable, maintainable VS Code extension with voice interaction capabilities, Azure integration, and proper testing practices while following modern TypeScript development patterns.
