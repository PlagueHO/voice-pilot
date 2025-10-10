# VoicePilot VS Code Extension Development Guide

## Project Overview

VoicePilot is a VS Code extension that turns Azure OpenAI GPT Realtime into a full-duplex voice copilot for GitHub Copilot Chat. The extension orchestrates configuration, authentication, realtime audio streaming, and Copilot prompt delivery through a service-based dependency injection layer. Treat this guide as the single source for automated agents working in this repository.

## Tech Stack

- **Runtime**: VS Code extension host (Node.js 22+, ES2022)
- **Language**: TypeScript 5 with strict mode and ES module syntax compiled to CommonJS
- **AI**: Azure OpenAI GPT Realtime (`gpt-realtime`) via WebRTC (preferred) with WebSocket fallback
- **Auth**: `@azure/identity` (`DefaultAzureCredential`) with optional ephemeral key issuance
- **Networking**: `openai` SDK (Azure-compatible), `ws`, `axios`
- **Audio**: WebRTC transport, AudioWorklets, PCM pipelines, interruption engine
- **Tooling**: TypeScript compiler, ESLint (flat config), Mocha + `@vscode/test-electron`, Webpack, NYC coverage, VSCE packaging

## Development Environment Setup

### Requirements

- Node.js 22 or later, VS Code 1.104+, Azure CLI with Bicep, Git, PowerShell (for Bicep tasks)

### Setup

```bash
npm install
az version
az bicep version
```

Optional: `npm install -g @vscode/vsce` for packaging.

## Project Structure

```text
voice-pilot/
├── src/
│   ├── extension.ts                     # Activation entry point
│   ├── core/                            # ExtensionController, retry utilities, logger
│   ├── config/                          # Configuration manager, sections, validators
│   ├── auth/                            # Credential + ephemeral key services, validators
│   ├── services/                        # Privacy, audio feedback, realtime STT, error handling
│   ├── audio/                           # WebRTC transport, capture, processing chain, worklets
│   ├── conversation/                    # State machine, transcript privacy aggregation
│   ├── copilot/                         # Copilot Chat bridge + prompt flow
│   ├── session/                         # Session manager, timers, interruption engine
│   ├── telemetry/                       # Lifecycle + metrics logging
│   ├── ui/                              # Voice control panel, status bar, error presenter
│   └── test/                            # Unit + integration specs and fixtures
├── docs/                                # Design references and technical indices
├── infra/                               # Azure Bicep templates and scripts
├── media/                               # Webview assets (JS/CSS/worklets)
└── .vscode/                             # Tasks, launch configs
```

## Core Development Principles

- Obey single-responsibility modules and service injection contracts (`ServiceInitializable` lifecycle).
- Follow clean TypeScript practices: strict typing, async/await, no implicit `any`, camelCase variables, PascalCase classes, kebab-case filenames.
- Prefer composition over inheritance; avoid long methods or monolithic classes.
- Keep configuration, authentication, session, and UI initialization in the documented order.
- Log with structured metadata and sanitize user content before persistence or telemetry.

## Development Workflow and Architecture

- `ExtensionController` orchestrates dependency initialization, error orchestration, privacy purges, and UI wiring.
- Boot sequence: `ConfigurationManager` → `CredentialManagerImpl`/`EphemeralKeyServiceImpl` → `SessionManagerImpl` (with timers + recovery) → UI surfaces (`VoiceControlPanel`, `StatusBar`, `ErrorPresenter`).
- Conversation execution flows through `ConversationStateMachine`, `ChatIntegration`, `TranscriptPrivacyAggregator`, `AudioFeedbackServiceImpl`, and `InterruptionEngineImpl`.
- Error handling relies on `ErrorEventBusImpl`, `RecoveryOrchestrator`, retry providers/executors, and typed `VoicePilotError` envelopes.
- Privacy controls (`PrivacyController`) manage transcript lifecycle, purge commands, and policy enforcement.

## TypeScript & Code Quality

- Read `.github/instructions/typescript-5-es2022.instructions.md` before touching `*.ts` files.
- Use ES module syntax in source; compiled output lives only in `out/` (never edit compiled JS).
- ESLint (flat config) is authoritative; fix lint before running integration tests.
- Prefer interfaces for object shapes, discriminated unions for events, and utility types instead of `any`.

## Azure and External Service Integration

- Default to keyless auth with `DefaultAzureCredential` + `getBearerTokenProvider`. Ephemeral keys remain available for WebRTC startups.
- Use `AzureOpenAI` from the `openai` SDK with deployment + API version set by configuration (`2025-04-01-preview` for REST, `2025-08-28` for realtime).
- All credentials persist in VS Code `SecretStorage` via `CredentialManagerImpl`; never write secrets to disk or logs.
- Network retries go through `RecoveryOrchestrator` and `RetryExecutorImpl`; do not implement ad-hoc retry logic.

## Realtime Audio Architecture

- `WebRTCAudioService` negotiates WebRTC sessions with diagnostics emitted by `webrtc-transport.ts`.
- `audio-context-provider.ts`, `audio-processing-chain.ts`, and worklets manage microphone capture, gain control, and playback jitter buffers.
- `RealtimeSpeechToTextService` ingests Azure realtime events, publishes deltas via `SessionManagerImpl`, and syncs transcripts to UI + privacy pipelines.
- Turn detection combines VAD defaults (`turn-detection-defaults.ts`) with conversation hooks to pause/resume Copilot prompts.

## VS Code Extension Patterns

- Activation ensures Copilot Chat extension availability (`ensureCopilotChatInstalled`) and sets `voicepilot.copilotAvailable`/`voicepilot.activated` contexts.
- Commands registered in `package.json`: `voicepilot.startConversation`, `voicepilot.endConversation`, `voicepilot.openSettings`. Keep command IDs stable for tests and UI bindings.
- Webview assets live in `media/`; sanitize outbound HTML via `media/sanitize-html.js` and keep scripts CSP-compliant.

## UI and User Experience

- `VoiceControlPanel` renders the sidebar webview and streams transcripts, playback state, and command buttons.
- `StatusBar` shows session state and mute indicators; update messaging through provided methods only.
- `ErrorPresenter` provides unified surfacing for recoverable vs fatal errors; wire new errors through the event bus instead of direct dialogs.

## Configuration Management

- `ConfigurationManager` loads `voicepilot.*` settings, validates sections, and debounces change propagation.
- Update config schemas in `package.json` plus matching validator rules under `src/config/validators/`.
- Use `ConfigSection` implementations for new namespaces; register them in `ConfigurationManager`.

## Secret Storage Pattern

- `CredentialManagerImpl` stores Azure keys/tokens in `SecretStorage`; use descriptive keys under the `voicepilot.*` namespace.
- The `EphemeralKeyServiceImpl` handles lifecycle, renewal, and error events for short-lived WebRTC credentials.

## Testing and Quality Assurance

- Unit tests (`src/test/unit/**/*.ts`) target Node-only services using stubbed VS Code APIs. Run via `Test Unit` task or `npm run test:unit`.
- Integration tests (`@vscode/test-electron`) verify activation, command wiring, and webview interactions. Run via `Test Extension` or `npm test`.
- `npm run test:all` executes unit then integration; use before commits.
- Coverage is enforced by NYC thresholds (90/85/90/90). Run `npm run test:coverage` if instrumentation is needed.
- For performance probes, use `npm run test:perf` (outputs JSON payload for telemetry analysis).
- The repository uses Mocha as the test runner. Wrap specs with `suite` from `src/test/mocha-globals`, prefixing names with `Unit:` or `Integration:` as appropriate, and define scenarios with `test`. Chai is the assertion library; always import `{ expect }` (plus `chai-as-promised` helpers when dealing with async flows) and express checks in BDD style—never fall back to Node's `assert`/`should`. Keep shared setup in `before`/`after` hooks, reset mutable state in `afterEach`, and isolate side effects with fakes so every run is deterministic.

## VS Code Tasks Workflow

- Prefer VS Code tasks over raw scripts (`Tasks: Run Task`). Key entries:
  - **Compile Extension** → `npm run compile`
  - **Watch Extension** → `npm run watch`
  - **Test Unit**, **Test Extension**, **Test All**, **Test Headless**, **Test Coverage**, **Test Performance**
  - **Lint Extension** → `npm run lint`
  - **Build Bicep** for infra updates (requires PowerShell + az)
  - **Package Extension** → `npm run package`
  - **Format TypeScript** → `npx prettier --write src/**/*.ts`
  - **Quality Gate Sequence** chains lint + tests + perf checks
- Use `npm run quality:gate` to execute the scripted guard outside VS Code tasks when necessary.

## Service Architecture Pattern

```typescript
interface ServiceInitializable {
  initialize(): Promise<void>;
  dispose(): void;
  isInitialized(): boolean;
}
```

- Never bypass `ExtensionController` when wiring services; it coordinates telemetry, recovery, and disposal.
- Always await `initialize()` before use and call `dispose()` during teardown to avoid orphaned sessions or timers.

## TypeScript Configuration

- Target: ES2022; Module: CommonJS; `esModuleInterop`, `strict`, `skipLibCheck: false`.
- Source lives in `src/`; compiled output in `out/`. `tsconfig.json` already aligns with VS Code extension host expectations.
- Use path-relative imports within `src/`; avoid tsconfig path aliases to keep webpack bundling straightforward.

## Azure Integration Patterns

```typescript
import { AzureOpenAI } from "openai";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import { OpenAIRealtimeWS } from "openai/beta/realtime/ws";

async function createRealtimeClient({ endpoint, deployment, apiVersion }: {
  endpoint: string;
  deployment: string;
  apiVersion: string;
}) {
  const credential = new DefaultAzureCredential();
  const scope = "https://cognitiveservices.azure.com/.default";
  const azureADTokenProvider = getBearerTokenProvider(credential, scope);
  const client = new AzureOpenAI({ azureADTokenProvider, endpoint, deployment, apiVersion });
  const realtime = await OpenAIRealtimeWS.azure(client);
  realtime.socket.on("open", () => {
    realtime.send({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        model: "gpt-realtime",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16"
      }
    });
  });
  return realtime;
}
```

- Honour negotiation timeouts (`webrtc-transport.ts`) and emit telemetry via `connectionDiagnostics` observers.
- Fallback to WebSocket only after exhausting WebRTC retries logged by the recovery orchestrator.

## Realtime Transport Diagnostics

- Negotiation enforces a 5s SDP timeout and structured error logging with `WebRTCErrorCode` metadata.
- `WebRTCAudioService.addTelemetryObserver` exposes audio stats (`audioPacketsSent/Received`, jitter, RTT, negotiation latency) every 5s.
- Recovery strategies (exponential backoff, transport downgrades) are orchestrated via `ConnectionRecoveryManager` and reported through the error bus.

## Command Registration Pattern

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand("voicepilot.startConversation", async () => {
    await controller?.startConversation();
  }),
);
```

- Wrap handlers in try/catch; delegate error presentation to `handleServiceError` helpers where available.
- Update command palette titles and icons via `package.json` when adding or renaming commands.

## Useful References

- Internal index: `docs/design/TECHNICAL-REFERENCE-INDEX.md`
- VS Code API docs: <https://code.visualstudio.com/api>
- Azure OpenAI realtime quickstart (TypeScript, keyless): <https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-quickstart?tabs=keyless%2Cwindows&pivots=programming-language-typescript>
- Web Audio API + AudioWorklet references: see `TECHNICAL-REFERENCE-INDEX.md`

Keep this document current; update tooling, architecture notes, and task references whenever implementation changes land.
