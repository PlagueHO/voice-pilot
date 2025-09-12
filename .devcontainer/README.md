# VoicePilot Development Container

This development container provides a complete environment for developing the VoicePilot VS Code extension with all necessary tools and dependencies pre-installed.

## What's Included

### Base Environment
- **Node.js 20** with TypeScript support
- **VS Code Extension Development** tools and debugging capabilities
- **Audio development libraries** (ALSA, PortAudio, PulseAudio, SoX, FFmpeg)
- **Azure CLI** with AI/ML extensions
- **GitHub CLI** for repository management

### VS Code Extensions
- **GitHub Copilot & Copilot Chat** - AI-powered coding assistance
- **TypeScript & JavaScript** support with IntelliSense
- **Testing frameworks** (Jest, Test Explorer)
- **Azure development tools** (Functions, Storage, Cosmos DB, etc.)
- **Code quality tools** (ESLint, Prettier, Markdown linting)
- **Git integration** (GitLens, GitHub PRs & Actions)

### Pre-installed Global Packages
- `@vscode/vsce` - VS Code Extension packaging
- `typescript` - TypeScript compiler
- `eslint` - Code linting
- `prettier` - Code formatting
- `jest` & `ts-jest` - Testing framework

## Quick Start

### GitHub Codespaces
1. Click "Code" → "Codespaces" → "Create codespace on main"
2. Wait for the container to build and VS Code to open
3. Run `npm install` if not already done
4. Press `F5` to start debugging the extension

### Local Development
1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop)
2. Install [VS Code](https://code.visualstudio.com/) with [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
3. Clone the repository
4. Open in VS Code and click "Reopen in Container" when prompted
5. Wait for the container to build
6. Press `F5` to start debugging the extension

## Available Commands

```bash
# Install dependencies
npm install

# Build the extension
npm run compile

# Watch for changes during development
npm run watch

# Run tests
npm test

# Lint code
npm run lint

# Package extension for distribution
vsce package

# Start extension debugging (or press F5)
code --extensionDevelopmentPath=$PWD
```

## Audio Development

The container includes audio libraries needed for voice features:
- **ALSA** - Advanced Linux Sound Architecture
- **PortAudio** - Cross-platform audio I/O library
- **PulseAudio** - Sound server for Linux
- **SoX** - Sound processing toolkit
- **FFmpeg** - Audio/video processing

## Azure Integration

Pre-configured Azure CLI with extensions:
- `azure-devops` - Azure DevOps integration
- `ml` - Azure Machine Learning
- `cognitiveservices` - Azure Cognitive Services

## Development Workflow

1. **Extension Host**: Press `F5` to launch a new VS Code window with your extension loaded
2. **Live Reload**: Use `npm run watch` for automatic compilation on file changes
3. **Testing**: Run `npm test` to execute unit tests
4. **Debugging**: Set breakpoints in TypeScript files for debugging
5. **Packaging**: Use `vsce package` to create a `.vsix` file for distribution

## Port Forwarding

The following ports are automatically forwarded:
- **3000** - Development server
- **8080** - Alternative web server
- **9229** - Node.js debugging

## Environment Variables

- `NODE_ENV=development` - Development mode
- `EXTENSION_DEVELOPMENT_HOST=true` - Extension development flag

## Troubleshooting

### Audio Issues
If you encounter audio-related problems:
```bash
# Check audio devices
aplay -l

# Test audio system
speaker-test -t wav
```

### Extension Loading Issues
If the extension doesn't load:
1. Check the Extension Development Host console for errors
2. Verify `package.json` has correct activation events
3. Ensure all dependencies are installed with `npm install`

### Azure Authentication
To authenticate with Azure services:
```bash
# Login to Azure
az login

# Set subscription (if needed)
az account set --subscription <subscription-id>
```

## Optional Services

The docker-compose setup includes optional services that can be enabled:
```bash
# Start with Redis for caching
docker-compose --profile tools up
```