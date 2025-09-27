// Ensure TDD globals are available for tests that use suite/setup
import "./setupMochaTddShim";

// This file is no longer needed with @vscode/test-cli
// The test CLI automatically discovers and runs tests
// Keeping for backward compatibility

export function run(): Promise<void> {
  // @vscode/test-cli handles test discovery and execution
  // This function exists for compatibility but is not used
  return Promise.resolve();
}
