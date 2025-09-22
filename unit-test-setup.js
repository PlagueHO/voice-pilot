// Unit test setup - provide VS Code mock via module cache manipulation
// This runs before any tests and ensures 'vscode' module resolves to our mock

const Module = require('module');
const path = require('path');

// Import our VS Code mock (compiled version)
const vscode = require('./out/test/vscode-mock.js');

// Store original _resolveFilename
const originalResolveFilename = Module._resolveFilename;

// Override module resolution for 'vscode' requests
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'vscode') {
    return 'vscode-mock';
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// Register mock in cache
require.cache['vscode-mock'] = {
  id: 'vscode-mock',
  filename: 'vscode-mock',
  loaded: true,
  children: [],
  parent: null,
  paths: [],
  exports: vscode
};

console.log('✓ VS Code mock registered for unit tests');
