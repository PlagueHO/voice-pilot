# VoicePilot VS Code Extension Development Guide

## Project Overview

This repository contains a VS Code extension for voice interaction with GitHub Copilot. VoicePilot enables natural, low-latency, full‑duplex voice interaction using the Azure OpenAI GPT Realtime API (speech in / speech out) and a service-based dependency injection architecture. The extension acts as an AI manager agent that orchestrates GitHub Copilot, translating realtime conversational audio streams into Copilot planning/specification workflows.

When working on the project interactively with an agent, please follow the guidelines below to ensure the development experience – particularly TypeScript compilation and VS Code extension debugging – continues to work smoothly.

> Tip: Keep the [Technical Reference Index](docs/design/TECHNICAL-REFERENCE-INDEX.md) handy for authoritative links to Azure and important technical documentation.

## Tech Stack

- **Framework**: VS Code Extension API with TypeScript
- **Language**: TypeScript 5.0+ (ES2022 target)
- **Realtime Audio (Speech In/Out)**: Azure OpenAI GPT Realtime API (WebRTC preferred; WebSocket fallback). Models: `gpt-realtime`.
- **AI Integration**: GitHub Copilot Chat Extension APIs
- **Authentication**: Azure Identity SDK, VS Code SecretStorage
- **HTTP Client**: OpenAI SDK (Azure-compatible), Axios
- **WebSocket**: ws library for realtime connections
- **Testing**: Mocha (unit: Node-only + stubbed `vscode`; integration: `@vscode/test-electron`)
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

**Key Dependencies**: `openai`, `@azure/identity`, `ws`, `axios`
**Removed / Deprecated**: `microsoft-cognitiveservices-speech-sdk` (Azure Speech Services) — replaced by unified GPT Realtime audio.

## Project Structure

```text
voice-pilot/
├── src/                               # Source code
│   ├── extension.ts                   # Extension entry point
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
│   ├── ui/                            # User interface components
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
- **Naming Conventions**: Consistent camelCase for variables/functions, PascalCase for classes/interfaces, kebab-case for filenames. Prioritize meaningful names and self-documenting code
- **File Naming**: Use kebab-case for all TypeScript filenames (e.g., `credential-validator.ts`, `azure-openai-validation-rules.ts`) while keeping class names in PascalCase
- **Prioritize Readability**: Clear naming, comments, and documentation
- **Performance**: Implement lazy loading for heavy services; use debounced updates for configuration changes
- **Error Handling**: Implement structured error handling with proper user feedback

### Development Workflow and Architecture

- Use VS Code Tasks workflow exclusively (see [VS Code Tasks Workflow](#vs-code-tasks-workflow))
- Follow service-based dependency injection pattern with ServiceInitializable interface
- Use F5 (Extension Development Host) for testing and debugging
- Maintain strict initialization order: Config → Auth → Session → UI
- Implement lazy loading for heavy services to optimize startup time
- Use debounced updates for configuration changes
- Follow VS Code extension performance guidelines for memory and CPU usage

### TypeScript and Code Quality

- Use TypeScript 5.0+ with ES2022 target for modern JavaScript features
- **Module System**: Use CommonJS (`"module": "commonjs"`) - required for VS Code extension compatibility
- **MANDATORY**: Use ES module syntax (`import`/`export`) in ALL TypeScript source files - never use `require()` or `module.exports` in `.ts` files
- Enable strict mode; avoid `any` types; prefer interfaces over types for object shapes
- Use modern async/await patterns; avoid generators and callbacks
- Implement feature-based folder structure with single responsibility modules
- **Import/Export**: Use ES module syntax (`import`/`export`) in TypeScript source, compiled to CommonJS output

### Azure and External Service Integration

- Use `openai` package pointed at Azure endpoints (not `@azure/openai`).
- Use Azure OpenAI GPT Realtime API for both STT and TTS (single multimodal stream) — no Azure Speech SDK.
- Authentication: Prefer keyless (Microsoft Entra ID + `DefaultAzureCredential`). Ephemeral key pattern still supported for WebRTC token issuance.
- Store only Azure OpenAI / session credentials in VS Code SecretStorage (Speech keys have been removed).

### Extension Development Best Practices

- Use VS Code extension APIs following official guidelines and patterns
- Implement proper command registration with error handling
- Use webview panels for complex UI with proper security settings
- Follow VS Code's contribution points for UI integration (commands, views, settings)

### Testing Guidelines

The project uses **Mocha** with a **layered test strategy** to optimize feedback speed and reliability.

#### Layer 1: Unit (Node-only)

- Runs against compiled `out/test/unit/**/*.js`.
- Uses a minimal stub of the `vscode` API (no Electron startup).
- Targets pure logic: managers, services, validation, error mapping, timers (with fake or controlled time), credential & session flows.
- Script / Task: `npm run test:unit` / `Test Unit`.
- Goal: sub‑second feedback; run before every commit or even on save.

#### Layer 2: Integration (Extension Host)

- Uses `@vscode/test-electron` to launch a real VS Code instance and load the extension.
- Verifies activation, disposal ordering, command registration, panel lifecycle, real event wiring.
- Script / Task: `npm test` / `Test Extension`.

#### Combined & Auxiliary Tasks

- **`Test All`**: Executes Unit then Integration (fail fast on unit failures).
- **`Test Headless`**: Integration under xvfb for CI containers.
- **`Test Coverage`**: NYC instrumentation (currently over integration; can be narrowed to unit as suite grows).
- **`Test Performance`**: Lightweight timing / perf probe (extend with real metrics as needed).

#### Test Types Implemented

- Unit, Integration, Performance probe, Error mapping, Lifecycle ordering.
- (Optional future) Compatibility matrix across VS Code versions via parameterized test runs.

#### Execution Guidance

| Scenario | Recommended Task |
|----------|------------------|
| Fast inner loop (logic change) | `Test Unit` |
| Behavior / activation change | `Test Extension` |
| Pre-push / PR validation | `Test All` |
| CI pipeline | Unit → Headless Integration → Coverage / Performance |

#### Key Practices

- Do **not** edit compiled JS under `out/`; change `.ts` sources only.
- Provide deterministic mocks (`fetch`, timers, secret storage) for unit tests.
- **DO NOT mock the VS Code API in integration tests** - integration tests run in the VS Code Extension Host where the real `vscode` module is available and should be used directly.
- Avoid real sleeps; use fake timers or controlled tick helpers.
- Keep unit specs <100ms and investigate integration specs >2s.
- Always restore modified globals (e.g. `fetch`) in `afterEach`.
- Run lint before integration to catch simple issues early.
- During integration runs you may see `Timed out waiting for authentication provider 'github'` warnings. These are expected while the GitHub provider registers and can be safely ignored.

#### Development Task Workflow

**Recommended Daily Workflow**:

1. Start `Watch Extension` task for continuous compilation
2. Run `Test Unit` frequently during development (sub-second feedback)
3. Use `Lint Extension` before committing changes
4. Run `Test All` before pushing to repository
5. Use `Package Extension` for release preparation

### VS Code Tasks Workflow

> [!IMPORTANT]
> **PREFER use VS Code Tasks** from the Command Palette → "Tasks: Run Task" for ALL development workflows.
> **AVOID run npm commands directly** in terminal during development sessions.

#### Complete Task Reference

> **CHECK** `.\.vscode\tasks.json` for full task definitions.

| Task | Icon | Type | Purpose | When To Use |
|------|------|------|---------|-------------|
| `Build Bicep` | 🔷 azure | Infrastructure | Compile Bicep templates to ARM JSON | After infra file changes |
| `Compile Extension` | ⚙️ gear | Build (default) | One-time TypeScript compilation | Quick validation / CI step |
| `Watch Extension` | 👁️ watch | Background | Continuous TypeScript build with hot reload | Keep running during active dev |
| `Test Unit` | 🧪 beaker | Test | Fast Node-only unit tests (stubbed `vscode`) | Inner loop development / pre-commit |
| `Test Extension` | 🧪 beaker | Test | Integration tests (extension host) | Full behavior validation |
| `Test All` | 🧪 beaker | Test | Unit then integration sequentially | Pre-push / PR validation |
| `Test Headless` | 🧪 beaker | Test | Integration via xvfb (headless) | CI / container environments |
| `Test Coverage` | 📊 graph | Test | Coverage instrumentation over tests | Coverage reporting / thresholds |
| `Test Performance` | 💓 pulse | Test | Performance / timing probe | Track performance regressions |
| `Lint Extension` | ✅ check | Quality | Static analysis (ESLint) | Before commits / CI gate |
| `Package Extension` | 📦 package | Distribution | Create `.vsix` for distribution | Release preparation |

### Service Architecture Pattern

VoicePilot follows a **dependency injection pattern** with the ServiceInitializable interface:

```typescript
interface ServiceInitializable {
  initialize(): Promise<void>;
  dispose(): void;
  isInitialized(): boolean;
}
```

**Critical Guidelines**:

- **Never directly instantiate services** – use the ExtensionController for coordination
- **Always await initialization** before using any service
- **Follow the disposal pattern** in the `deactivate()` function

### TypeScript Configuration

**Target Configuration**: Extension targets ES2022 for Node.js 22+ (VS Code 1.104+)

- **Target**: ES2022 (Node.js 22+ support in VS Code 1.104+)
- **Module System**: CommonJS (`"module": "commonjs"`) - VS Code Extension Host requirement
- **CRITICAL**: ALWAYS use ES module syntax (`import`/`export`) in TypeScript source files - this is compiled to CommonJS automatically
- **Output**: Only compiled `.js` files go to `out/` directory
- **Source**: Only `.ts` files in `src/` directory
- **No legacy polyfills**: Modern async/await, class fields, all ES2022+ features
- **Interoperability**: `esModuleInterop: true` enables mixing CommonJS and ES module imports

```typescript
// Use modern ES module syntax - ALWAYS in TypeScript files
import { ServiceInitializable } from './service-initializable';
import { Logger } from './logger';

// ES module export - no __generator or __awaiter functions
export class ExampleService implements ServiceInitializable {
  private initialized = false;

  async initialize(): Promise<void> {
    // Native async/await, no transpilation needed
    const result = await this.setupService();
    this.initialized = true;
  }
}

// Named exports
export { Logger };
export type { ServiceInitializable };
```

### Azure Integration Patterns

#### Realtime Integration Approach

- **Transport**: WebRTC (low latency) → fallback to WebSocket (`OpenAIRealtimeWS.azure`).
- **Session Modalities**: `['text','audio']` enabling simultaneous transcription + synthesized output.
- **Events**: `session.update`, `conversation.item.create`, `response.create`, `response.output_text.delta`, `response.output_audio.delta`, `response.output_audio_transcript.delta`, `response.done`.
- **Authentication Options**:
  - Keyless: `DefaultAzureCredential` + bearer token provider (recommended).
  - Ephemeral: short-lived token minted by backend for client WebRTC session.

```typescript
import { OpenAIRealtimeWS } from 'openai/beta/realtime/ws';
import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';

async function initRealtime({ endpoint, deployment, apiVersion }: { endpoint: string; deployment: string; apiVersion: string; }) {
  const credential = new DefaultAzureCredential();
  const scope = 'https://cognitiveservices.azure.com/.default';
  const azureADTokenProvider = getBearerTokenProvider(credential, scope);
  const client = new AzureOpenAI({ azureADTokenProvider, endpoint, deployment, apiVersion });
  const rt = await OpenAIRealtimeWS.azure(client);
  rt.socket.on('open', () => {
    rt.send({ type: 'session.update', session: { modalities: ['text','audio'], model: 'gpt-realtime' }});
  });
  return rt;
}
```

> Adapted from Azure OpenAI GPT Realtime Audio Quickstart (TypeScript). WebRTC variant supersedes WS where available.

#### Realtime Audio Architecture

| Layer | Responsibility |
|-------|----------------|
| `RealtimeAudioService` | Manages session lifecycle & duplex media/text events |
| `audioCapture` | Captures PCM frames from microphone |
| `PlaybackBuffer` | Jitters and plays decoded audio output frames |
| `TranscriptAggregator` | Combines incremental transcript deltas into user-visible text |
| `EphemeralKeyService` | (Optional) Retrieves short-lived tokens for WebRTC when not using keyless auth |

Legacy `sttService.ts` and `ttsService.ts` are deprecated and scheduled for removal after full migration.

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

- **Local Development**: Use `F5` (Extension Development Host) or VS Code Tasks
- **CI Pipeline**: Headless testing with xvfb display for Linux environments
- **Test Discovery**: Automatic via glob pattern `out/test/**/*.test.js`

**Critical Guidelines**:

- **Prefer Unit First**: Fix failures at the unit layer before running integration.
- **Isolation**: Each test re-creates required service instances; no shared mutable singletons.
- **No Editing Compiled Tests**: Change `.ts` sources only; never patch `out/` artifacts.
- **Deterministic Mocks**: Replace network (`fetch`), timers, secret storage in unit tests; integration tests may still mock external HTTP.
- **Headless CI**: Use `Test Headless` (xvfb) for integration in container environments.
- **Performance Budget**: Keep unit tests < 100ms each; flag integration tests exceeding ~2s for review.

### Code Quality Standards

**Code Quality Guidelines**: Follow established patterns and documentation standards

- **Error Handling**: Contextual logging with structured error objects
- **Documentation**: JSDoc for public APIs, self-documenting code preferred

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

---

This comprehensive guide provides a solid foundation for building a scalable, maintainable VS Code extension with voice interaction capabilities, Azure integration, and proper testing practices while following modern TypeScript development patterns.
