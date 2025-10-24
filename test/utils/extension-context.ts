import * as vscode from "vscode";

/**
 * Creates an in-memory {@link vscode.Memento} implementation for use inside unit tests.
 *
 * @param store - Backing map that simulates VS Code's persisted state storage.
 * @returns A memento with synchronous read access and async update semantics matching VS Code.
 */
function createMemento(
  store: Map<string, unknown>,
): vscode.Memento & { setKeysForSync(keys: readonly string[]): void } {
  const get = <T>(key: string, defaultValue?: T): T | undefined => {
    if (store.has(key)) {
      return store.get(key) as T;
    }
    return defaultValue;
  };

  const update = async (key: string, value: unknown): Promise<void> => {
    if (value === undefined || value === null) {
      store.delete(key);
      return;
    }
    store.set(key, value);
  };

  const keys = (): readonly string[] => Array.from(store.keys());
  const memento = {
    get,
    update,
    keys,
    setKeysForSync: () => {},
  } as const;

  return memento;
}

/**
 * Builds a lightweight {@link vscode.SecretStorage} stub backed by the provided map.
 *
 * @param store - Persistence layer that mimics secret storage behavior for tests.
 * @returns A secret storage implementation that supports get, store, delete, and change events.
 */
function createSecrets(store: Map<string, string>): vscode.SecretStorage {
  return {
    async get(key: string): Promise<string | undefined> {
      return store.get(key);
    },
    async store(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async keys(): Promise<string[]> {
      return Array.from(store.keys());
    },
    onDidChange: () => ({ dispose() {} }),
  } as vscode.SecretStorage;
}

/**
 * Configuration options accepted by {@link createExtensionContextStub}.
 */
export interface ExtensionContextStubOptions {
  /**
   * Root URI assigned to the synthetic extension context.
   * @defaultValue `"file://voicepilot-unit-test"`
   */
  uri?: string;
  /**
   * Base filesystem location used when resolving `asAbsolutePath` calls.
   * @defaultValue `"/tmp/voicepilot/test"`
   */
  storageBasePath?: string;
  /**
   * Overrides that allow consumers to inject specific context properties.
   */
  overrides?: Partial<vscode.ExtensionContext>;
}

/**
 * Creates a VS Code {@link vscode.ExtensionContext} substitute tailored for unit testing.
 *
 * @remarks
 * The stub supplies sensible defaults for persistent storage, secret storage, and subscriptions while
 * allowing callers to override any property selectively via the `overrides` option.
 *
 * @param options - Optional configuration for URIs, storage roots, and property overrides.
 * @returns A fully populated extension context that mirrors the shape expected by production code.
 */
export function createExtensionContextStub({
  uri = "file://voicepilot-unit-test",
  storageBasePath = "/tmp/voicepilot/test",
  overrides = {},
}: ExtensionContextStubOptions = {}): vscode.ExtensionContext {
  const secretsStore = new Map<string, string>();
  const workspaceStateStore = new Map<string, unknown>();
  const globalStateStore = new Map<string, unknown>();
  const subscriptions: vscode.Disposable[] = [];

  const storageUri = vscode.Uri.parse(`${uri}/storage`);
  const globalStorageUri = vscode.Uri.parse(`${uri}/global`);
  const logUri = vscode.Uri.parse(`${uri}/logs`);
  const defaultExtensionMode = ((vscode as unknown as {
    ExtensionMode?: { Test?: vscode.ExtensionMode };
  }).ExtensionMode?.Test ?? 3) as vscode.ExtensionMode;
  const extensionMode = overrides.extensionMode ?? defaultExtensionMode;

  const base = {
    subscriptions,
    extensionUri: vscode.Uri.parse(uri),
    extensionPath: storageBasePath,
    extensionMode,
    storageUri,
    storagePath: `${storageBasePath}/storage`,
    globalStorageUri,
    globalStoragePath: `${storageBasePath}/global`,
    logUri,
    logPath: `${storageBasePath}/logs`,
    environmentVariableCollection:
      overrides.environmentVariableCollection ??
      ({} as unknown as vscode.EnvironmentVariableCollection),
    secrets: createSecrets(secretsStore),
    workspaceState: createMemento(workspaceStateStore),
    globalState: createMemento(globalStateStore),
    asAbsolutePath(relativePath: string): string {
      if (/^\w+:\/\//.test(relativePath) || relativePath.startsWith("/")) {
        return relativePath;
      }
      return `${storageBasePath}/${relativePath}`;
    },
  };

  return {
    ...base,
    ...overrides,
    subscriptions: overrides.subscriptions ?? subscriptions,
  } as vscode.ExtensionContext;
}
