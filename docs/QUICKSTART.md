# Quick Start Guide for Developing VS Code Extensions

## Overview

This guide provides a quick start for developing Visual Studio Code extensions. It covers the essential steps to set up your development environment, create a new extension, and publish it.

## Prerequisites

- **Node.js**: Ensure you have Node.js installed. You can download it from [nodejs.org](https://nodejs.org/).
- **Visual Studio Code**: Download and install Visual Studio Code from [code.visualstudio.com](https://code.visualstudio.com/).
- **Yeoman and VS Code Extension Generator**: Install Yeoman and the VS Code Extension Generator globally using the following command:

  ```bash
  npm install -g yo generator-code
  ```

## Creating a New Extension

1. **Open a Terminal**: Navigate to the directory where you want to create your extension.

2. **Run the Generator**: Execute the following command to start the generator:

   ```bash
   yo code
   ```

3. **Follow the Prompts**: Choose the type of extension you want to create (e.g., TypeScript), provide a name (e.g., "VoicePilot"), and fill in other details as prompted.

4. **Navigate to Your Extension Directory**:

   ```bash
   cd VoicePilot
   ```

## Development

### Structure

Your extension will have the following structure:

```
VoicePilot
├── src
│   ├── extension.ts
│   ├── audio
│   ├── copilot
│   ├── codebase
│   ├── github
│   ├── ui
│   ├── services
│   └── types
├── package.json
├── tsconfig.json
├── webpack.config.js
├── vsc-extension-quickstart.md
└── README.md
```

### Key Files

- **src/extension.ts**: The main entry point for your extension. Initialize your extension here.
- **src/audio/**: Contains files for handling audio input and output.
- **src/copilot/**: Integrates with GitHub Copilot for enhanced coding assistance.
- **src/codebase/**: Manages interactions with the codebase, including file analysis and searching.
- **src/github/**: Handles GitHub API interactions, including issue creation.
- **src/ui/**: Manages the user interface components of your extension.
- **src/services/**: Contains services for Azure integration and authentication.
- **src/types/**: Defines types and interfaces used throughout the project.

### Running Your Extension

1. **Open the Extension in VS Code**: Open the project folder in Visual Studio Code.

2. **Run the Extension**: Press `F5` to launch a new VS Code window with your extension loaded.

3. **Debugging**: Use the Debug Console to view logs and debug your extension.

## Publishing Your Extension

1. **Install the VSCE Tool**: If you haven't already, install the VSCE tool for packaging and publishing your extension:

   ```bash
   npm install -g vsce
   ```

2. **Package Your Extension**: Run the following command in your extension directory:

   ```bash
   vsce package
   ```

3. **Publish**: Follow the instructions in the [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) documentation to publish your extension to the Visual Studio Code Marketplace.

## Best Practices

- **Use TypeScript**: TypeScript provides type safety and better tooling support.
- **Follow VS Code Extension Guidelines**: Adhere to the [VS Code Extension Guidelines](https://code.visualstudio.com/api) for best practices in extension development.
- **Test Your Extension**: Regularly test your extension to ensure it works as expected.

## Conclusion

This guide provides a foundational understanding of developing a Visual Studio Code extension. For more detailed information, refer to the official [VS Code API documentation](https://code.visualstudio.com/api). Happy coding!
