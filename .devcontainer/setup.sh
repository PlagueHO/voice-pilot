#!/bin/bash
set -e

echo "🚀 Setting up Agent Voice development environment..."

# Update package lists
echo "📦 Updating package lists..."
sudo apt-get update

# Install GUI dependencies for VS Code extension testing
echo "🖥️ Installing GUI and X11 dependencies..."
sudo apt-get install -y \
    libnspr4 \
    libnss3 \
    libgconf-2-4 \
    libxss1 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm1 \
    libasound2 \
    xvfb \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxfixes3 \
    libxi6 \
    libxtst6 \
    libxcursor1

# Ensure Azure Developer CLI is available
echo "☁️ Installing Azure Developer CLI (azd)..."
if ! command -v azd >/dev/null 2>&1; then
  curl -fsSL https://aka.ms/install-azd.sh | sudo bash
else
  echo "Azure Developer CLI already installed."
fi

# Ensure Bicep CLI is available via Azure CLI extension
if command -v az >/dev/null 2>&1; then
  echo "🏗️ Installing Bicep CLI..."
  if ! az bicep version >/dev/null 2>&1; then
    az bicep install
  else
    echo "Bicep CLI already installed."
  fi
else
  echo "⚠️ Azure CLI not found; skipping Bicep CLI installation."
fi

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Setup Playwright Test agents when definitions are absent.
echo "🎭 Setting up Playwright Test Agents..."
PLAYWRIGHT_AGENT_DIR=".github/playwright"
if ! npx --yes playwright@latest --version >/dev/null 2>&1; then
  echo "⚠️ Unable to download Playwright CLI; skipping agent generation."
else
  if [ ! -d "$PLAYWRIGHT_AGENT_DIR" ]; then
    if npx --yes playwright@latest init-agents --loop=vscode; then
      echo "✅ Playwright Test agent definitions generated."
    else
      echo "⚠️ Playwright agent generation failed; rerun 'npx playwright init-agents --loop=vscode' manually."
    fi
  else
    echo "🎭 Playwright agent definitions already present; skipping generation."
  fi
fi

# Install global packages
echo "🌐 Installing global packages..."
npm install -g @vscode/vsce

# Install GitHub Copilot CLI
echo "🤖 Installing GitHub Copilot CLI..."
if command -v gh >/dev/null 2>&1; then
  if ! gh extension list | grep -q "github/gh-copilot"; then
    gh extension install github/gh-copilot
    echo "✅ GitHub Copilot CLI installed successfully."
  else
    echo "GitHub Copilot CLI already installed."
  fi
else
  echo "⚠️ GitHub CLI (gh) not found; skipping GitHub Copilot CLI installation."
fi

# Create test index file if missing
echo "🧪 Setting up test environment..."
if [ ! -f "test/index.ts" ]; then
    echo "Creating missing test index file..."
    cat > test/index.ts << 'EOF'
import * as path from 'path';
import * as Mocha from 'mocha';
import * as glob from 'glob';

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    timeout: 20000
  });

  const testsRoot = path.resolve(__dirname, '..');

  return new Promise((resolve, reject) => {
    glob('**/**.test.js', { cwd: testsRoot }, (err, files) => {
      if (err) {
        return reject(err);
      }

      files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

      try {
        mocha.run(failures => {
          if (failures > 0) {
            reject(new Error(`${failures} tests failed.`));
          } else {
            resolve();
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}
EOF
fi

# Add glob dependency if missing
echo "📦 Adding missing test dependencies..."
if ! npm list glob --depth=0 > /dev/null 2>&1; then
    npm install --save-dev glob @types/glob
fi

# Create directory for test output
mkdir -p out/test

# Build the project
echo "🔨 Building project..."
if npm run compile; then
    echo "✅ Project compiled successfully!"
else
    echo "⚠️  Compilation failed, but continuing setup..."
    echo "    You can fix compilation issues and run 'npm run compile' later."
fi

# Start virtual display for tests (background)
echo "🖼️ Starting virtual display..."
export DISPLAY=:99
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &

# Setup git if needed
if [ ! -f ~/.gitconfig ]; then
    echo "⚙️ Setting up git configuration..."
    git config --global user.name "Agent Voice Developer"
    git config --global user.email "developer@agentvoice.dev"
    git config --global init.defaultBranch main
fi

echo "✅ Development environment setup complete!"
echo ""
echo "📋 What was configured:"
echo "  • GUI dependencies for VS Code extension testing"
echo "  • Node.js packages and global tools (@vscode/vsce)"
echo "  • Playwright Test agent definitions (planner, generator, healer)"
echo "  • Test environment with Mocha and proper test index"
echo "  • Virtual display (Xvfb) for headless testing"
echo "  • Git configuration (if needed)"
echo ""
echo "🎯 Quick start commands:"
echo "  npm run compile    # Build the extension"
echo "  npm run watch      # Watch for changes"
echo "  npm test           # Run tests"
echo "  npm run lint       # Check code style"
echo "  F5                 # Debug extension in VS Code"
echo ""
echo "🖥️  Desktop access available at:"
echo "  http://localhost:6080 (noVNC web interface)"
echo ""
