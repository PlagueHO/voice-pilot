# Use the official VS Code dev container base for Node.js/TypeScript
FROM mcr.microsoft.com/devcontainers/typescript-node:1-20-bullseye

# Install audio development libraries for voice features
RUN apt-get update && apt-get install -y \
    libasound2-dev \
    portaudio19-dev \
    libpulse-dev \
    libsox-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install global npm packages for VS Code extension development
RUN npm install -g \
    @vscode/vsce \
    typescript \
    eslint \
    prettier \
    jest \
    ts-jest \
    @types/node

# Install Azure CLI extensions for AI Foundry
RUN az extension add --name cognitiveservices --only-show-errors

# Set up workspace
WORKDIR /workspaces/voice-pilot

# Copy package files for dependency installation
COPY package*.json ./

# Install dependencies
RUN npm install

# Set environment variables for development
ENV NODE_ENV=development
ENV EXTENSION_DEVELOPMENT_HOST=true

# Expose ports for debugging and development
EXPOSE 3000 8080 9229

# Set the default user
USER node