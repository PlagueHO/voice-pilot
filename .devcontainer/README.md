# VoicePilot Development Container

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/PlagueHO/voice-pilot)

This development container sets up the tooling needed to build and test the VoicePilot VS Code extension. The configuration reflects the files in `.devcontainer/devcontainer.json` and `.devcontainer/setup.sh` so you know exactly what is provisioned. This .devcontainer can also be used in GitHub Codespaces.

## What's Included

### Base Image & Features

- Node.js 22.12.0 via the `typescript-node:1-22` devcontainer image and the `node` feature.
- GitHub CLI and Azure CLI supplied by devcontainer features.
- Desktop Lite feature with a lightweight Fluxbox desktop, exposed by noVNC (`6080`) and VNC (`5901`).
- Forwarded ports: `9229` (Node debugger), `6080` (noVNC), `5901` (VNC).

### Post-create Setup (`setup.sh`)

- Installs required GUI/X11 libraries plus `xvfb` for headless VS Code extension testing.
- Installs the Azure Developer CLI (`azd`) if missing and ensures the Azure CLI has the Bicep CLI available.
- Runs `npm install` for repository dependencies and adds `glob`/`@types/glob` if they are not already present.
- Generates Playwright Test Agent definitions (`npx playwright init-agents --loop=vscode`) when missing so AI-driven test workflows are ready immediately.
- Installs global npm CLIs `@vscode/vsce` and `@github/copilot`.
- Creates `src/test/index.ts` when absent to keep the Mocha harness functional.
- Builds the project with `npm run compile` (non-blocking) and starts an `Xvfb` session on display `:99`.
- Seeds a default git configuration on first run for convenience.

### VS Code Extensions

The container pre-installs the following extensions through `devcontainer.json`:

- `ms-vscode.extension-test-runner`
- `ms-vscode.vscode-typescript-next`
- `GitHub.copilot`
- `GitHub.copilot-chat`
- `esbenp.prettier-vscode`
- `dbaeumer.vscode-eslint`
- `ms-azuretools.vscode-azure-github-copilot`
- `ms-azuretools.vscode-azureresourcegroups`
- `ms-vscode.azure-repos`
- `bradlc.vscode-tailwindcss`
- `hbenl.vscode-test-explorer`
- `ms-vscode.test-adapter-converter`
- `ms-azuretools.azure-dev`
- `DavidAnson.vscode-markdownlint`
- `ms-azuretools.vscode-bicep`
- `bierner.markdown-mermaid`
- `github.vscode-github-actions`

### What Is Not Included

- Audio toolchains such as ALSA, PulseAudio, PortAudio, SoX, or FFmpeg are **not** installed.
- Docker-in-Docker services, extra forwarded ports (3000/5000/8080), and additional Azure CLI extensions are not configured by default.
- Additional global npm utilities (for example `typescript`, `eslint`, `jest`, `nodemon`) remain project-local and are not installed globally by the setup script.

## Getting Started

1. Open the repository in VS Code and choose **Dev Containers: Reopen in Container** (or create a Codespace).
2. Wait for the container build and the `postCreateCommand` to finish. The output in the terminal will confirm when setup completes.
3. Run `npm run compile`, `npm run lint`, or `npm test` as needed—dependencies are already installed during setup.
4. Launch the extension in the Extension Development Host with **F5**.

## Helpful Commands

```bash
# Re-run dependency installation if needed
npm install

# Compile the extension
npm run compile

# Execute the default test suite
npm test

# Start the watch compiler
npm run watch

# Package the extension (requires @vscode/vsce which is installed globally)
vsce package
```

## Desktop Access

- Open `http://localhost:6080` for the web-based desktop supplied by the Desktop Lite feature. The default password is `vscode`.
- Connect to `localhost:5901` with a VNC client if you prefer a native viewer.

## Maintenance Notes

- If you need additional system packages (for example audio libraries), add them to `.devcontainer/setup.sh` so the README continues to reflect the actual environment.
- When changing forwarded ports or VS Code extensions, update both `devcontainer.json` and this document to keep them in sync.

Happy building! 🎤✨
