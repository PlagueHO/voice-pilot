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
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions'] // Isolate extension during testing
    });
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
