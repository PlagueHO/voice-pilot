# AGENTS.md

## Project Overview

VoicePilot is a VS Code extension that enables natural, low‑latency voice interaction with GitHub Copilot and the active codebase. It leverages Azure OpenAI Realtime (WebRTC) for streaming speech-to-text + reasoning, Azure Speech for high‑quality TTS, and provides an interruption‑friendly conversational assistant.

## Core Architecture

- **Extension Entry**: `src/extension.ts` - Activation, command registration
- **Audio Pipeline**: `src/audio/` - Capture, STT (Realtime), TTS output
- **Copilot Integration**: `src/copilot/` - Bridge to GitHub Copilot chat APIs
- **Codebase Context**: `src/codebase/` - File analysis, search, context assembly
- **GitHub Integration**: `src/github/` - Issue creation & API calls
- **UI Components**: `src/ui/` - Sidebar panel, status bar, transcripts

## Development Commands (npm scripts)

```bash
# Install dependencies
npm install

# One-shot compile (TypeScript -> out/)
npm run compile

# Watch recompile during development
npm run watch

# Run tests (pretest: compile + lint)
npm test

# Lint sources
npm run lint

# Package VSIX (runs compile via vscode:prepublish)
npm run package
```

## VS Code Tasks Workflow (`.vscode/tasks.json`)

Use Command Palette → “Tasks: Run Task”.

| Task | Purpose | When To Run | Notes |
|------|---------|------------|-------|
| Build Bicep | Compile all infra `main.bicep` files to JSON | After infra edits | PowerShell script enumerates nested templates |
| Compile Extension | Single TypeScript build | Quick validation | Default build task (Ctrl+Shift+B) |
| Watch Extension | Continuous incremental build | Active feature work | Background task; stop when idle |
| Test Extension | Execute test suite | Before commit / PR | Runs after compile + lint (pretest) |
| Lint Extension | Static analysis | During refactor / before PR | Add `--fix` manually if needed |
| Package Extension | Produce `.vsix` | Release prep | Depends on compiled output |

### Recommended Inner Loop

1. Start `Watch Extension`.
2. Implement changes in `src/`.
3. Press F5 (Extension Development Host) to interact.
4. Run `Test Extension` then `Lint Extension`.
5. (Infra changes) Run `Build Bicep` & inspect JSON outputs.
6. Commit; `Package Extension` when distributing.

### Fast Patch Flow

`Compile Extension` → F5 → verify → commit.

### Infra (Bicep) Change Flow

1. Edit files under `infra/`.
2. Run `Build Bicep`.
3. Review generated `*.json` siblings (confirm intended drift).
4. Commit only expected changes.

## VS Code Extension Development

- **Run / Debug**: Press F5 to launch Extension Development Host
- **Breakpoints**: Place in TypeScript sources; sourcemaps map to `out/`
- **Packaging**: `npm run package` produces a `.vsix` (uses `vsce`)
- **Dependencies**: `openai`, `microsoft-cognitiveservices-speech-sdk`, `@azure/identity`, `ws`, `axios`, VS Code API types
- **Target Version**: VS Code 1.104+ (Node.js 22+) for modern JavaScript features

## TypeScript Compilation & Output

**Target Configuration**: Extension targets ES2022 for Node.js 22+ (VS Code 1.104+)

- **Modern Output**: Native async/await, class fields, all ES2022+ features
- **Build Directory**: Compiled `.js` files go to `out/` directory only
- **Source Control**: Only `.ts` files in `src/` directory

### TypeScript Configuration

Ensure `tsconfig.json` targets modern JavaScript:

```json
{
  "compilerOptions": {
    "target": "ES2022",        // Node.js 22+ native support
    "module": "commonjs",     // Node.js compatibility
    "outDir": "./out",        // Compiled output
    "rootDir": "./src"        // Source location
  }
}
```

## Azure Integration Patterns

Realtime voice (planned) uses ephemeral token + WebRTC. Fallback / non‑realtime uses REST via the `openai` client pointed at Azure OpenAI deployment endpoint.

```typescript
import OpenAI from 'openai';
import { SpeechConfig } from 'microsoft-cognitiveservices-speech-sdk';

const openai = new OpenAI({
  apiKey: config.azureOpenAI.apiKey,
  baseURL: `${config.azureOpenAI.endpoint}/openai/deployments/${config.azureOpenAI.deployment}`
});

async function getEphemeralKey() {
  // Backend required (not in repo) to exchange permanent Azure key server-side
  return ephemeralService.fetchKey();
}

const speechConfig = SpeechConfig.fromSubscription(
  config.azureSpeech.apiKey,
  config.azureSpeech.region
);
speechConfig.speechSynthesisVoiceName = config.azureSpeech.voice;
```

### Realtime Flow (Conceptual)

1. Fetch ephemeral key
2. Create `RTCPeerConnection` + attach microphone track
3. Exchange SDP with Azure OpenAI Realtime endpoint
4. Stream user audio; receive partial transcripts & assistant events
5. Local VAD interruption → send stop / resume events
6. Close & release resources; discard ephemeral key

## Code Style & Conventions

- **Strict TypeScript**: Prefer interfaces; no `any` unless isolated
- **Async**: `async/await` for all async IO
- **Error Handling**: Contextual logging with lightweight error objects
- **Separation**: Feature-based folder structure (audio, copilot, github, etc.)
- **Source Purity**: Only `.ts` files in `src/`; compiled `.js` output goes to `out/`

## Testing

- **Unit**: Core services (mock VS Code + Azure clients)
- **Integration**: Extension activation & command flows
- **Manual Voice**: Use dev host; test microphone permission + latency
- **Add Tests**: Place under `src/test` or existing `src/test` pattern (current: `src/test/` -> compiled to `out/test`)

## Critical Dependencies

- `vscode` - Extension API
- `openai` - Azure OpenAI compatible client
- `microsoft-cognitiveservices-speech-sdk` - Azure Speech TTS
- `@azure/identity` - Future credential flows / managed identity
- `ws` - Realtime / fallback streaming support
- `axios` - HTTP (ephemeral key service, auxiliary endpoints)

## Configuration Management

VS Code settings namespace: `voicepilot.*`

- `voicepilot.azureOpenAI.*` (endpoint, deployment, apiKey storage key)
- `voicepilot.azureSpeech.*` (apiKey, region, voice)
- `voicepilot.github.*` (repo, auth mode)

Secrets (keys) stored via VS Code SecretStorage; never persisted in plaintext.

## Security & Privacy

- **Ephemeral Keys**: Short-lived for Realtime; renewal cadence (planned) ~50s
- **Local Processing**: VAD / preprocessing local where possible
- **No Audio Persistence**: Raw audio buffers cleared after use
- **HTTPS Only**: All network calls over TLS

## Extension Lifecycle (Updated)

1. Activation
2. Conversation start (mic access, VAD init, ephemeral fetch)
3. Realtime / streaming loop
4. Intent + context resolution
5. Copilot bridge / augmentation
6. Code action execution
7. TTS streaming & interruption handling
8. Teardown & cleanup

## Debugging Tips

- **Microphone Issues**: Check OS permission & device availability
- **Latency**: Inspect network / console logs for SDP or ICE delays
- **Copilot**: Ensure GitHub Copilot Chat extension installed & enabled
- **STT / TTS**: Validate endpoint & region values in settings
- **Node.js APIs**: Use Node.js 22+ features without compatibility concerns

## Common Commands & Task References

```bash
# Install packaging CLI
npm install -g @vscode/vsce

# Build (default task)
Ctrl+Shift+B

# Watch
npm run watch

# Tests
npm test

# Lint
npm run lint

# Build infra (Task: Build Bicep recommended)
# bicep build infra/main.bicep

# Package
npm run package
```

### After Making Changes

1. Ensure `Watch Extension` running OR run `Compile Extension`.
2. Press F5 to launch Extension Development Host.
3. Exercise feature or voice flow.
4. Run `Test Extension`.
5. Run `Lint Extension`.
6. (Infra changed) Run `Build Bicep`, review JSON outputs.
7. Commit; `Package Extension` if releasing.

### Pre-Release Checklist

- [ ] Tests passing
- [ ] Lint clean
- [ ] No debug-only logs left
- [ ] Version bumped (if publishing)
- [ ] Manual voice test passes
- [ ] `.vsix` installs & activates cleanly

---

This document guides contributors through development, tasks, infrastructure validation, realtime integration planning, and packaging for VoicePilot.
