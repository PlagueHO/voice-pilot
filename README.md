# VoicePilot: Hands/Eyes Free Planning and Specification Assistant for VS Code

## Project Overview

VoicePilot is a desktop-based VS Code extension designed to enable hands/eyes free interaction with GitHub Copilot for specification writing, project planning, and task management. It enables natural conversation for ideation, feature scoping, architecture planning, and GitHub issue creation through speech-to-text and text-to-speech. The tool serves both accessibility needs (visual impairments, conditions like Bell's Palsy) and enables fluid conversational workflows in situations where traditional keyboard/screen interaction isn't practical (e.g., commuting, walking, or when maintaining conversational flow is more important than precise code editing).

**Implementation Approach**: VoicePilot functions as an AI manager agent that orchestrates the VS Code GitHub Copilot Agent, acting as an intelligent translator between voice interactions and Copilot's planning and specification capabilities. This design enables 100% hands/eyes free communication by converting spoken planning discussions into appropriate Copilot prompts and translating responses back into natural speech. By leveraging Copilot's existing system context awareness and MCP server integrations, VoicePilot can help with specification writing and planning that considers existing codebases, design documents, and external system knowledge without reimplementing these complex integrations.

## Why GitHub Copilot Integration?

**Leveraging Existing Context**: When planning features for existing systems, context matters tremendously. GitHub Copilot already has sophisticated understanding of:

- Your current codebase structure and patterns
- Existing design documents and architecture decisions
- Dependencies and technology stack
- Code quality standards and conventions

**MCP Server Access**: Rather than reimplementing integrations with external systems, VoicePilot leverages GitHub Copilot's existing MCP (Model Context Protocol) server connections. This provides access to:

- GitHub repositories and issue tracking
- Documentation systems and wikis
- Project management tools
- External APIs and services
- Custom organizational knowledge bases

**Proven AI Planning Capabilities**: GitHub Copilot has already invested heavily in understanding software planning workflows, requirement analysis, and architectural decision-making. VoicePilot amplifies these capabilities through natural voice interaction rather than rebuilding them from scratch.

## Key Features

- **Hands/Eyes Free Operation**: Complete voice-only interaction for accessibility and situational needs
- **Voice Input**: Use Azure AI Foundry's GPT-Realtime for real-time transcription
- **Text-to-Speech**: Use Azure OpenAI Realtime audio (gpt-realtime) for synthesized audio output
- **Copilot Integration**: Leverage GitHub Copilot's existing system context and MCP server access for informed planning
- **Specification Writing**: Voice-driven creation of requirements, architecture docs, and technical specifications
- **Project Planning**: Conversational ideation, feature scoping, and task breakdown
- **Context Awareness**: Leverage existing codebase and design documentation through Copilot's knowledge
- **GitHub Issue Management**: Create and manage issues via voice for planning and task tracking
- **Conversational Flow**: Natural dialogue with follow-up questions and conversational memory
- **Conversation Persistence**: Resume, browse, and delete past voice sessions stored locally in VS Code user data storage per workspace

## Architecture Components

1. **VS Code Extension Shell**
    - Language: TypeScript
    - APIs: vscode.window, vscode.workspace, vscode.authentication
    - UI: Status bar button, chat panel, transcript log
2. **Speech-to-Text (STT)**
    - Primary: Azure AI Foundry GPT-Realtime (for low-latency transcription)
    - Integration: Microphone capture via Node.js or Electron module
3. **Text-to-Speech (TTS)**
    - Primary: Azure OpenAI Realtime audio (gpt-realtime) for synthesized audio output
    - Optional: OS-native TTS for fallback
4. **Copilot Integration (AI Manager Agent)**
    - Orchestrate GitHub Copilot Agent through Chat extension APIs
    - Act as intelligent translator between voice input and Copilot commands
    - Convert spoken planning discussions into structured @vscode/copilot-chat prompts
    - Process Copilot responses for optimal voice delivery and specification formatting
    - Leverage Copilot's existing system context (codebase, design docs) for informed planning
    - Utilize Copilot's MCP server integrations without reimplementation
    - Manage conversation context and follow-up interactions for planning sessions
    - Reference: Copilot Chat GitHub Repo
5. **Conversation History Storage**
    - Persist conversations on the local device using VS Code workspace storage (`Memento`) scoped to the active repository
    - Restore the latest session automatically after VS Code restarts with the same workspace open
    - Provide quick switching between historical sessions while the same workspace is open
    - Support secure deletion and retention policies honoring local-only storage
6. **Codebase Context**
    - Use VS Code APIs to:
        - Read open files
        - Search workspace
        - Summarize code segments
7. **GitHub Integration**
    - Preferred: GitHub MCP server for issue creation and repo actions
    - Alternative: GitHub REST API via octokit.js
    - Authentication: VS Code GitHub auth API or PAT

## Development Phases

### Phase 1: Voice I/O Prototype

- Set up microphone capture
- Integrate GPT-Realtime for STT
- Implement Azure TTS for response playback

### Phase 2: AI Manager Agent & Copilot Orchestration

- Implement AI manager agent layer
- Connect to GitHub Copilot Chat extension APIs
- Develop intelligent prompt translation (voice planning → Copilot commands)
- Create response processing pipeline (Copilot → optimized speech for specifications)
- Establish conversation context management for planning sessions
- Enable seamless hands/eyes free interaction flow

### Phase 3: Specification & Planning Workflows

- Implement voice-driven document creation (requirements, architecture specs)
- Leverage Copilot's codebase context for informed planning
- Create planning session templates and workflows

### Phase 4: Task & Issue Management

- Draft issues and tasks from planning conversations
- Leverage Copilot's GitHub integrations and MCP servers
- Voice-driven issue creation and task breakdown

### Phase 5: Accessibility & UX Polish

- Optimize for screen-free operation
- Add conversation transcription and replay
- Support for planning session management
- Implement local conversation storage, resume support, and history management UI
- Optimize latency for conversational flow

## Reference Projects & APIs

- [Copilot Chat Extension](https://github.com/microsoft/vscode-copilot-chat)
- [Azure AI Foundry Realtime Audio Quickstart](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-quickstart?tabs=keyless%2Cwindows&pivots=programming-language-typescript)
- [Azure AI Services](https://learn.microsoft.com/en-us/azure/ai-services/)
- [VS Code API](https://code.visualstudio.com/api)
- [Octokit.js](https://github.com/octokit/octokit.js)
