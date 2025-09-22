// Unit test setup - provide VS Code mock via module cache manipulation
// This runs before any tests and ensures 'vscode' module resolves to our mock

// Direct CommonJS require for Module access
const Module = require('module');

// Import our VS Code mock
import * as vscode from './vscode-mock';

// Store original _resolveFilename
const originalResolveFilename = Module._resolveFilename;

// Override module resolution for 'vscode' requests
Module._resolveFilename = function (request: string, parent: any, isMain?: boolean, options?: any) {
  if (request === 'vscode') {
    return 'vscode-mock';
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// Register mock in cache with minimal Module interface
(require.cache as any)['vscode-mock'] = {
  id: 'vscode-mock',
  filename: 'vscode-mock',
  loaded: true,
  children: [],
  parent: null,
  paths: [],
  exports: vscode
};

console.log('✓ VS Code mock registered for unit tests');
