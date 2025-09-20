#!/bin/bash
set -e

echo "🚀 Setting up VoicePilot development environment..."

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

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Install global packages
echo "🌐 Installing global packages..."
npm install -g @vscode/vsce

# Create test index file if missing
echo "🧪 Setting up test environment..."
if [ ! -f "src/test/index.ts" ]; then
    echo "Creating missing test index file..."
    cat > src/test/index.ts << 'EOF'
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
    git config --global user.name "VoicePilot Developer"
    git config --global user.email "developer@voicepilot.dev"
    git config --global init.defaultBranch main
fi

echo "✅ Development environment setup complete!"
echo ""
echo "📋 What was configured:"
echo "  • GUI dependencies for VS Code extension testing"
echo "  • Node.js packages and global tools (@vscode/vsce)"
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
