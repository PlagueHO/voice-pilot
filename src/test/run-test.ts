// Legacy test runner - @vscode/test-cli is now the recommended approach
// This file is kept for backward compatibility

import { runTests } from '@vscode/test-electron';
import * as path from 'path';

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');

    // The path to test runner
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './index');

    // Download VS Code, unzip it and run the integration test
    // Ensure Mocha uses the TDD UI so `suite`/`setup` globals are defined in tests
    process.env.MOCHA_UI = process.env.MOCHA_UI || 'tdd';
    // Preload the TDD shim inside the extension host process so globals exist
    // before Mocha loads test files. Use Node/Electron --require option.
    const tddShimPath = path.resolve(extensionDevelopmentPath, 'out', 'test', 'setupMochaTddShim.js');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions', '--require', tddShimPath], // Preload shim
      extensionTestsEnv: {
        MOCHA_UI: process.env.MOCHA_UI || 'tdd'
      }
    });
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
