---
title: Core Extension Activation & Lifecycle
version: 1.0
date_created: 2025-09-19
last_updated: 2025-09-19
owner: Agent Voice Project
tags: [architecture, extension, lifecycle, vscode]
---

# Introduction

This specification defines the core VS Code extension activation lifecycle for Agent Voice, including activation events, command registration, component initialization, and proper teardown procedures. It establishes the foundation for all other extension components and ensures proper integration with the VS Code extension host.

## 1. Purpose & Scope

This specification defines the activation and lifecycle management requirements for the Agent Voice VS Code extension. It covers:

- Extension activation triggers and events
- Component initialization sequence
- Command and UI registration
- Service coordination and dependency management
- Extension deactivation and cleanup procedures

**Intended Audience**: Extension developers, architecture reviewers, and integration testers.

**Assumptions**:

- VS Code Extension API knowledge
- TypeScript development environment
- Understanding of VS Code extension host architecture

## 2. Definitions

- **Extension Host**: VS Code process that runs extensions in isolation
- **Activation Event**: VS Code event that triggers extension loading
- **Command Palette**: VS Code's command execution interface (Ctrl+Shift+P)
- **Activity Bar**: VS Code's primary navigation sidebar
- **Webview**: Sandboxed HTML/JS context within VS Code for custom UI
- **Extension Context**: VS Code object providing extension lifecycle and storage APIs
- **Contribution Points**: Extension manifest declarations for UI elements and commands

## 3. Requirements, Constraints & Guidelines

### Activation Requirements

- **REQ-001**: Extension SHALL activate on first user interaction with Agent Voice commands
- **REQ-002**: Extension SHALL activate when Agent Voice sidebar panel is opened
- **REQ-003**: Extension SHALL register all commands during activation
- **REQ-004**: Extension SHALL initialize core services in dependency order
- **REQ-005**: Extension SHALL display activity bar icon after successful activation

### Security Requirements

- **SEC-001**: Extension SHALL validate all command inputs before processing
- **SEC-002**: Extension SHALL not expose sensitive configuration in command registration
- **SEC-003**: Extension SHALL secure all inter-component message passing

### Lifecycle Constraints

- **CON-001**: Extension activation MUST complete within 5 seconds
- **CON-002**: Extension MUST not block VS Code startup
- **CON-003**: Extension MUST handle activation failures gracefully
- **CON-004**: Extension MUST properly dispose of all resources on deactivation

### Architecture Guidelines

- **GUD-001**: Use dependency injection pattern for service management
- **GUD-002**: Implement proper error handling and logging throughout lifecycle
- **GUD-003**: Follow VS Code extension best practices for performance
- **GUD-004**: Maintain clear separation between extension host and webview contexts

### Implementation Patterns

- **PAT-001**: Initialize services in order: Configuration → Authentication → Session → UI
- **PAT-002**: Use VS Code's built-in disposal pattern for cleanup
- **PAT-003**: Register commands with consistent naming convention: `agentvoice.*`
- **PAT-004**: Implement graceful degradation when dependencies are unavailable

## 4. Interfaces & Data Contracts

### Extension Manifest (package.json)

```json
{
  "engines": {
    "vscode": "^1.75.0"
  },
  "contributes": {
    "commands": [
      {
        "command": "agentvoice.startConversation",
        "title": "Agent Voice: Start Conversation"
      },
      {
        "command": "agentvoice.endConversation",
        "title": "Agent Voice: End Conversation"
      },
      {
        "command": "agentvoice.openSettings",
        "title": "Agent Voice: Open Settings"
      }
    ],
    "views": {
      "agentvoice": [
        {
          "id": "agentvoice.sidebar",
          "name": "Agent Voice",
          "when": "agentvoice.activated"
        }
      ]
    },
    "viewsContainers": {
      "activitybar": [
        {
          "id": "agentvoice",
          "title": "Agent Voice",
          "icon": "resources/icon.png"
        }
      ]
    }
  }
}
```

### Extension Controller Interface

```typescript
interface ExtensionController {
  initialize(): Promise<void>;
  dispose(): void;
  isInitialized(): boolean;
  getConfigurationManager(): ConfigurationManager;
  getSessionManager(): SessionManager;
  getEphemeralKeyService(): EphemeralKeyService;
  getVoiceControlPanel(): VoiceControlPanel;
}
```

### Service Initialization Contract

```typescript
interface ServiceInitializable {
  initialize(): Promise<void>;
  dispose(): void;
  isInitialized(): boolean;
}
```

### Command Registration Contract

```typescript
interface CommandDefinition {
  id: string;
  handler: (...args: any[]) => any;
  thisArg?: any;
}
```

## 5. Acceptance Criteria

- **AC-001**: Given VS Code is starting, When user opens Agent Voice sidebar, Then extension activates within 5 seconds
- **AC-002**: Given extension is activating, When activation completes, Then all commands are registered and functional
- **AC-003**: Given extension is active, When user executes `agentvoice.startConversation`, Then conversation UI appears
- **AC-004**: Given extension is active, When VS Code is closing, Then extension deactivates cleanly without errors
- **AC-005**: Given activation fails, When error occurs, Then user sees helpful error message with troubleshooting steps
- **AC-006**: Given extension is activated, When configuration changes, Then services reload appropriately
- **AC-007**: The extension SHALL initialize all core services (Configuration, Authentication, Session, UI) in correct dependency order
- **AC-008**: The extension SHALL register activity bar icon with correct states (inactive, active, error)

## 6. Test Automation Strategy

- **Test Levels**: Unit tests for service initialization, Integration tests for VS Code API interactions, End-to-End tests for complete activation flow
- **Frameworks**: VS Code Extension Test Runner, Mocha for unit tests, VS Code API mocking for isolation
- **Test Data Management**: Mock VS Code extension context, isolated test workspaces
- **CI/CD Integration**: GitHub Actions with VS Code extension testing environment
- **Coverage Requirements**: 90% code coverage for activation/deactivation paths
- **Performance Testing**: Activation time benchmarks, memory usage validation

## 7. Rationale & Context

The extension lifecycle design prioritizes:

1. **Fast Activation**: Lazy loading and on-demand activation prevent VS Code startup delays
2. **Reliability**: Proper error handling and graceful degradation ensure stable operation
3. **Resource Management**: Clear disposal patterns prevent memory leaks and resource conflicts
4. **VS Code Integration**: Following VS Code patterns ensures consistent user experience
5. **Testability**: Service abstraction and dependency injection enable comprehensive testing

The activation sequence (Configuration → Authentication → Session → UI) ensures each service has its dependencies available during initialization.

## 8. Dependencies & External Integrations

### VS Code Platform Dependencies

- **PLT-001**: VS Code Extension API - Version 1.60+ required for webview and language model APIs
- **PLT-002**: Node.js Runtime - Version 16+ for modern TypeScript and async/await patterns

### Extension API Dependencies

- **EXT-001**: VS Code Extension Context - Required for storage, secrets, and lifecycle management
- **EXT-002**: VS Code Commands API - For command registration and execution
- **EXT-003**: VS Code Webview API - For audio processing UI components
- **EXT-004**: VS Code Activity Bar API - For sidebar integration and icon states

### Internal Service Dependencies

- **SVC-001**: Configuration Manager - Settings validation and change notification
- **SVC-002**: Ephemeral Key Service - Azure authentication token management
- **SVC-003**: Session Manager - Audio session lifecycle coordination
- **SVC-004**: Voice Control Panel - Primary user interface component
- **SVC-005**: Logger - Structured logging with level filtering and output channel integration

### Infrastructure Dependencies

- **INF-001**: TypeScript Compilation - Build-time type checking and ES module generation
- **INF-002**: VS Code Extension Packaging - VSIX generation and marketplace distribution

## 9. Examples & Edge Cases

### Basic Activation Flow

```typescript
// src/extension.ts
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  try {
    const controller = new ExtensionController();
    await controller.activate(context);

    // Store controller for deactivation
    context.subscriptions.push({
      dispose: () => controller.deactivate()
    });

    vscode.commands.executeCommand('setContext', 'agentvoice.activated', true);
  } catch (error) {
    vscode.window.showErrorMessage(`Agent Voice activation failed: ${error.message}`);
    throw error;
  }
}

export async function deactivate(): Promise<void> {
  // VS Code handles disposal of context.subscriptions automatically
}
```

### Error Handling Example

```typescript
class ExtensionController {
  async activate(context: vscode.ExtensionContext): Promise<void> {
    try {
      // Initialize services in dependency order
      await this.configManager.initialize(context);
      await this.keyService.initialize(context);
      await this.sessionManager.initialize(context);
      await this.voicePanel.initialize(context);

      this.registerCommands(context);
      this.registerUI(context);

    } catch (error) {
      // Cleanup any partially initialized services
      await this.cleanup();
      throw new Error(`Extension activation failed: ${error.message}`);
    }
  }
}
```

### Edge Case: Activation During VS Code Shutdown

```typescript
// Handle case where VS Code is shutting down during activation
private activationCancellation = new vscode.CancellationTokenSource();

async activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(this.activationCancellation);

  if (this.activationCancellation.token.isCancellationRequested) {
    throw new Error('Activation cancelled due to shutdown');
  }

  // Continue with normal activation...
}
```

## 10. Validation Criteria

- Extension activates successfully in VS Code 1.60+ environments
- All commands are registered and respond correctly
- Activity bar icon displays with appropriate states
- Extension deactivates cleanly without resource leaks
- Activation completes within performance constraints (5 seconds)
- Error conditions are handled gracefully with user feedback
- Extension context and subscriptions are properly managed
- Service initialization follows dependency order requirements

## 11. Related Specifications / Further Reading

- [VS Code Extension API Documentation](https://code.visualstudio.com/api)
- [Extension Activation Best Practices](https://code.visualstudio.com/api/references/activation-events)
- SP-002: Configuration & Settings Management
- SP-013: UI Sidebar Panel & Layout
- SP-028: Error Handling & Recovery Framework
