# VoicePilot Development Container

This development container provides a complete, production-ready environment for developing the VoicePilot VS Code extension with all necessary tools, dependencies, and best practices pre-configured.

## 🚀 What's Included

### Base Environment
- **Node.js 22 LTS** with TypeScript support and latest toolchain
- **VS Code Extension Development** tools with debugging capabilities
- **Audio development libraries** (ALSA, PortAudio, PulseAudio, SoX, FFmpeg)
- **Azure CLI** with AI/ML extensions and dev tools
- **GitHub CLI** for seamless repository management
- **Docker-in-Docker** support for containerized workflows

### Essential VS Code Extensions
- **GitHub Copilot & Copilot Chat** - AI-powered coding assistance
- **TypeScript & JavaScript** - Full IntelliSense, debugging, and formatting
- **Testing Suite** - Jest, Test Explorer, Coverage reporting
- **Azure Development** - Functions, Storage, Cosmos DB, App Service, Static Web Apps
- **Code Quality** - ESLint, Prettier, Spell checker, Security analysis
- **Git & GitHub** - GitLens, PR management, GitHub Actions integration
- **Documentation** - Markdown support, Mermaid diagrams, live preview

### Pre-installed Global Packages
- `@vscode/vsce` - VS Code Extension packaging and publishing
- `typescript` - TypeScript compiler (latest)
- `eslint` & `prettier` - Code quality and formatting
- `jest` & `ts-jest` - Testing framework
- `nodemon` & `concurrently` - Development utilities

## 🛠 Quick Start

### GitHub Codespaces (Recommended)
1. Click **"Code"** → **"Codespaces"** → **"Create codespace on main"**
2. Wait for the container to build (2-3 minutes)
3. VS Code will open automatically with all extensions loaded
4. Run `npm install` if dependencies aren't already installed
5. Press **`F5`** to start debugging the extension

### Local Development with Docker
1. **Prerequisites:**
   - [Docker Desktop](https://www.docker.com/products/docker-desktop) (latest version)
   - [VS Code](https://code.visualstudio.com/) with [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

2. **Setup:**
   ```bash
   git clone https://github.com/PlagueHO/voice-pilot.git
   cd voice-pilot
   code .
   ```

3. **Open in Container:**
   - Click **"Reopen in Container"** when prompted, or
   - Press `Ctrl+Shift+P` → **"Dev Containers: Reopen in Container"**

4. **Start Development:**
   - Press **`F5`** to launch Extension Development Host
   - Make changes and test in real-time

## 🎯 Development Workflow

### Extension Development

```bash
# Install dependencies
npm install

# Build the extension
npm run compile

# Watch for changes during development
npm run watch

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Format code
npm run format

# Package extension for distribution
vsce package

# Publish to marketplace
vsce publish
```

### Debugging & Testing

1. **Extension Host Debugging:**
   - Press **`F5`** to launch Extension Development Host
   - Set breakpoints in TypeScript files
   - Use VS Code's built-in debugger

2. **Unit Testing:**
   - Run `npm test` for Jest tests
   - Use Test Explorer for interactive testing
   - View coverage reports in `coverage/` directory

3. **Integration Testing:**
   - Test with mock VS Code APIs
   - Validate Azure service integrations
   - Test audio features with different devices

### Audio Development

The container includes comprehensive audio libraries:

- **ALSA** - Advanced Linux Sound Architecture
- **PortAudio** - Cross-platform audio I/O library  
- **PulseAudio** - Sound server for Linux
- **SoX** - Sound processing toolkit
- **FFmpeg** - Audio/video processing

**Audio Testing Commands:**

```bash
# List audio devices
aplay -l

# Test audio system
speaker-test -t wav -c 2

# Record audio test
arecord -d 5 -f cd test.wav && aplay test.wav
```

## ☁️ Azure Integration

### Pre-configured Services

**Azure CLI** with extensions for:

- `azure-devops` - Azure DevOps integration
- `ml` - Azure Machine Learning
- `cognitiveservices` - Azure Cognitive Services
- `azure-dev` - Azure Developer CLI

### Authentication

```bash
# Login to Azure
az login

# Set subscription
az account set --subscription <subscription-id>

# Verify authentication
az account show
```

### Azure OpenAI Integration

```bash
# Set environment variables for development
export AZURE_OPENAI_ENDPOINT="your-endpoint"
export AZURE_OPENAI_API_KEY="your-api-key"
export AZURE_SPEECH_API_KEY="your-speech-key"
export AZURE_SPEECH_REGION="your-region"
```

## 🔧 Advanced Configuration

### Port Forwarding

- **3000** - Development server
- **5000/5001** - Web application (HTTP/HTTPS)
- **8080** - Alternative development server
- **9229** - Node.js debugging port

### Optional Services

Start additional services using Docker Compose profiles:

```bash
# Start with database support
docker-compose --profile database up

# Start with caching support  
docker-compose --profile cache up

# Start with reverse proxy
docker-compose --profile proxy up

# Start all services
docker-compose --profile full up
```

### VS Code Settings

The container includes optimized settings for:

- TypeScript development with auto-imports
- Automatic formatting on save
- ESLint integration with auto-fix
- GitHub Copilot configuration
- Testing and debugging setup

## 🐛 Troubleshooting

### Common Issues

#### Extension Won't Load

```bash
# Check Extension Development Host console for errors
# Verify package.json activation events
npm run compile
# Restart the Extension Development Host (F5)
```

#### Audio Issues

```bash
# Check audio permissions
sudo usermod -a -G audio $USER

# Restart audio service
sudo systemctl restart pulseaudio

# Test audio devices
aplay -l && arecord -l
```

#### Azure Authentication

```bash
# Clear Azure CLI cache
az account clear

# Re-authenticate
az login --use-device-code

# Verify permissions
az account list-locations
```

#### Build Failures

```bash
# Clean install
rm -rf node_modules package-lock.json
npm install

# Clear TypeScript cache
rm -rf out/
npm run compile
```

#### Container Performance

```bash
# Check container resources
docker stats

# Prune unused resources
docker system prune -f

# Rebuild container
docker-compose build --no-cache app
```

### Performance Optimization

#### Node.js Memory Issues

```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
```

#### Docker Performance

- Use named volumes for `node_modules`
- Enable BuildKit for faster builds
- Adjust memory limits in docker-compose.yml

## 📚 Resources

### VS Code Extension Development

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

### Azure Development

- [Azure SDK for JavaScript](https://docs.microsoft.com/en-us/azure/developer/javascript/)
- [Azure OpenAI Service](https://docs.microsoft.com/en-us/azure/cognitive-services/openai/)
- [Azure Speech Services](https://docs.microsoft.com/en-us/azure/cognitive-services/speech-service/)

### Audio Development

- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [PortAudio Documentation](http://portaudio.com/docs.html)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)

## 🔒 Security Considerations

- **API Keys**: Use VS Code secret storage, never commit to source control
- **Authentication**: Leverage VS Code's built-in GitHub auth when possible
- **Audio Privacy**: Process audio locally, clear buffers after use
- **Network Security**: All Azure calls use HTTPS with certificate validation
- **Container Security**: Run as non-root user, use security profiles

## 🆘 Support

If you encounter issues:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review VS Code Extension Host logs
3. Validate Azure service connectivity
4. Create an issue in the repository with:
   - Operating system and Docker version
   - VS Code version and extensions installed
   - Complete error messages and logs
   - Steps to reproduce the issue

---

**Happy coding with VoicePilot! 🎤✨**