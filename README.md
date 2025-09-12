# VoicePilot: Conversational Coding Assistant for VS Code

## Project Overview

VoicePilot is a desktop-based VS Code extension designed to enable developers to interact with GitHub Copilot and their codebase using voice. It streamlines ideation, feature scoping, and GitHub issue creation through natural conversation, supporting both speech-to-text and text-to-speech. The tool is accessibility-friendly but primarily focused on maintaining developer flow during ideation.

## Key Features

- Voice Input: Use Azure AI Foundry's GPT-Realtime or Azure Speech SDK for real-time transcription.
- Text-to-Speech: Read Copilot responses aloud using Azure TTS.
- Copilot Integration: Communicate with GitHub Copilot via VS Code APIs or Copilot Chat extension.
- Codebase Awareness: Search and summarize code using VS Code APIs.
- GitHub Issue Creation: Create issues via GitHub MCP server or REST API.
- Flow-Oriented Design: Concise responses, follow-up questions, and conversational memory.

## Architecture Components

1. **VS Code Extension Shell**
    - Language: TypeScript
    - APIs: vscode.window, vscode.workspace, vscode.authentication
    - UI: Status bar button, chat panel, transcript log
2. **Speech-to-Text (STT)**
    - Primary: Azure AI Foundry GPT-Realtime (for low-latency transcription)
    - Fallback: Azure Speech SDK or Whisper
    - Integration: Microphone capture via Node.js or Electron module
3. **Text-to-Speech (TTS)**
    - Primary: Azure TTS SDK or REST API
    - Optional: OS-native TTS for fallback
4. **Copilot Integration**
    - Use GitHub Copilot Chat extension APIs
    - Reference: Copilot Chat GitHub Repo
    - Use @vscode/copilot-chat commands to send prompts and receive responses
5. **Codebase Context**
    - Use VS Code APIs to:
        - Read open files
        - Search workspace
        - Summarize code segments
6. **GitHub Integration**
    - Preferred: GitHub MCP server for issue creation and repo actions
    - Alternative: GitHub REST API via octokit.js
    - Authentication: VS Code GitHub auth API or PAT

## Development Phases

### Phase 1: Voice I/O Prototype

- Set up microphone capture
- Integrate GPT-Realtime for STT
- Implement Azure TTS for response playback

### Phase 2: Copilot Chat Integration

- Connect to Copilot Chat extension
- Send transcribed prompts
- Receive and display concise responses

### Phase 3: Codebase Awareness

- Implement file search and summarization
- Use AI to interpret code context

### Phase 4: GitHub Issue Creation

- Draft issues from conversation
- Send to MCP server or GitHub API
- Confirm creation via voice

### Phase 5: UX & Polish

- Add transcript panel
- Support voice commands like "edit issue"
- Optimize latency and privacy

## Reference Projects & APIs

- [Copilot Chat Extension](https://github.com/microsoft/vscode-copilot-chat)
- [Azure AI Foundry Realtime Audio Quickstart](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-quickstart?tabs=keyless%2Cwindows&pivots=programming-language-typescript)
- [Azure AI Services](https://learn.microsoft.com/en-us/azure/ai-services/)
- [VS Code API](https://code.visualstudio.com/api)
- [Octokit.js](https://github.com/octokit/octokit.js)