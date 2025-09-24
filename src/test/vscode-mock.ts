// Mock VS Code API for unit tests
export const OutputChannel = class {
  appendLine(value: string): void {}
  append(value: string): void {}
  clear(): void {}
  show(): void {}
  hide(): void {}
  dispose(): void {}
};

export const window = {
  createOutputChannel: (name: string) => new OutputChannel(),
  showErrorMessage: (message: string) => Promise.resolve(undefined),
  showWarningMessage: (message: string) => Promise.resolve(undefined),
  showInformationMessage: (message: string) => Promise.resolve(undefined)
};

export const workspace = {
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
  getConfiguration: () => ({
    get: () => undefined,
    has: () => false,
    inspect: () => undefined,
    update: () => Promise.resolve()
  })
};

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: () => Promise.resolve()
};

export const extensions = {
  getExtension: () => undefined
};

export const Uri = {
  parse: (value: string) => ({ toString: () => value })
};

export const Disposable = class {
  dispose(): void {}
};

export const EventEmitter = class {
  event: any = () => ({ dispose: () => {} });
  fire(): void {}
  dispose(): void {}
};

export const ExtensionContext = class {
  subscriptions: any[] = [];
  extensionUri: any = Uri.parse('file://test');
  globalState: any = {
    get: () => undefined,
    update: () => Promise.resolve()
  };
  workspaceState: any = {
    get: () => undefined,
    update: () => Promise.resolve()
  };
  secrets: any = {
    get: () => Promise.resolve(undefined),
    store: () => Promise.resolve(),
    delete: () => Promise.resolve()
  };
};

export const LogLevel = {
  Trace: 0,
  Debug: 1,
  Info: 2,
  Warning: 3,
  Error: 4,
  Critical: 5,
  Off: 6
};
