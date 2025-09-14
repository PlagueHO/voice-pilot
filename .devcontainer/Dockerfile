# Use the latest official VS Code dev container base for Node.js/TypeScript
FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# Set environment variables early for optimization
ENV NODE_ENV=development \
    EXTENSION_DEVELOPMENT_HOST=true \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    DEBIAN_FRONTEND=noninteractive

# Install system dependencies for audio development and VS Code extension testing
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Audio development libraries for voice features
    libasound2-dev \
    portaudio19-dev \
    libpulse-dev \
    libsox-dev \
    ffmpeg \
    # Additional development tools
    curl \
    git \
    wget \
    unzip \
    xvfb \
    # Cleanup in same layer to reduce image size
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Switch to node user for security best practices
USER node

# Set up workspace directory
WORKDIR /workspaces/voice-pilot

# Copy package files for dependency installation (with proper ownership)
COPY --chown=node:node package*.json ./

# Install global npm packages for VS Code extension development
RUN npm install -g \
    @vscode/vsce@latest \
    typescript@latest \
    eslint@latest \
    prettier@latest \
    jest@latest \
    ts-jest@latest \
    @types/node@latest \
    nodemon@latest \
    concurrently@latest

# Install project dependencies with npm ci for reproducible builds
RUN npm ci --only=production && npm cache clean --force

# Copy the rest of the application code
COPY --chown=node:node . .

# Create directories for VS Code extension development
RUN mkdir -p \
    .vscode \
    out \
    coverage \
    node_modules/.cache

# Set proper permissions for development
RUN chmod -R 755 /workspaces/voice-pilot

# Expose ports for debugging and development
EXPOSE 3000 5000 5001 8080 9229

# Health check for container
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node --version || exit 1

# Default command (will be overridden by docker-compose)
CMD ["sleep", "infinity"]