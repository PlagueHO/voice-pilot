const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig([
  {
    label: 'unitTests',
    files: 'out/test/**/*.test.js',
    version: 'stable',
    mocha: {
      ui: 'bdd',
      timeout: 20000,
      color: true
    },
    launchArgs: [
      '--disable-extensions' // Disable other extensions during testing
    ]
  }
]);
