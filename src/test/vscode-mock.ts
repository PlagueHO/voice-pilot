// Mock VS Code API for unit tests
import * as fsp from "node:fs/promises";
import * as path from "node:path";

interface MockUri {
  scheme: string;
  authority: string;
  path: string;
  fsPath: string;
  query: string;
  fragment: string;
  toString(): string;
  toJSON(): string;
  with(changes: Partial<Omit<MockUri, "with" | "toString" | "toJSON">>): MockUri;
}

const normaliseFsPath = (input: string): string => path.resolve(input);

const toUriPath = (fsPath: string): string => {
  const normalised = normaliseFsPath(fsPath).split(path.sep).join(path.posix.sep);
  return normalised.startsWith("/") ? normalised : `/${normalised}`;
};

const toUriString = (fsPath: string): string => `file://${toUriPath(fsPath)}`;

const createMockUri = (components: {
  scheme?: string;
  authority?: string;
  path?: string;
  fsPath: string;
  query?: string;
  fragment?: string;
}): MockUri => {
  const scheme = components.scheme ?? "file";
  const fsPath = normaliseFsPath(components.fsPath);
  const uriPath = components.path ?? toUriPath(fsPath);
  const authority = components.authority ?? "";
  const query = components.query ?? "";
  const fragment = components.fragment ?? "";

  return {
    scheme,
    authority,
    path: uriPath,
    fsPath,
    query,
    fragment,
    toString: () => {
      if (scheme === "file") {
        return toUriString(fsPath);
      }
      const base = `${scheme}://${authority}${uriPath}`;
      const querySuffix = query ? `?${query}` : "";
      const fragmentSuffix = fragment ? `#${fragment}` : "";
      return `${base}${querySuffix}${fragmentSuffix}`;
    },
    toJSON: () => {
      if (scheme === "file") {
        return toUriString(fsPath);
      }
      const querySuffix = query ? `?${query}` : "";
      const fragmentSuffix = fragment ? `#${fragment}` : "";
      return `${scheme}://${authority}${uriPath}${querySuffix}${fragmentSuffix}`;
    },
    with: (changes) =>
      createMockUri({
        scheme: changes.scheme ?? scheme,
        authority: changes.authority ?? authority,
        fsPath: changes.fsPath ?? fsPath,
        path: changes.path ?? uriPath,
        query: changes.query ?? query,
        fragment: changes.fragment ?? fragment,
      }),
  };
};

const createFileUri = (fsPath: string): MockUri => createMockUri({ fsPath });

const parseUri = (value: string): MockUri => {
  if (value.startsWith("file://")) {
    const withoutScheme = value.replace(/^file:\/\//, "");
    const decoded = decodeURIComponent(withoutScheme);
    return createFileUri(decoded);
  }

  try {
    const url = new URL(value);
    return createMockUri({
      scheme: url.protocol.replace(/:$/, ""),
      authority: url.host,
      path: url.pathname,
      fsPath: url.pathname,
      query: url.search.replace(/^\?/, ""),
      fragment: url.hash.replace(/^#/, ""),
    });
  } catch {
    return createFileUri(value);
  }
};

const ensureUint8Array = (buffer: Uint8Array | Buffer): Uint8Array =>
  buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

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
  showInformationMessage: (message: string) => Promise.resolve(undefined),
};

export const workspace = {
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
  getConfiguration: () => ({
    get: () => undefined,
    has: () => false,
    inspect: () => undefined,
    update: () => Promise.resolve(),
  }),
  workspaceFolders: [] as any[],
  fs: {
    async createDirectory(uri: MockUri): Promise<void> {
      await fsp.mkdir(uri.fsPath, { recursive: true });
    },
    async writeFile(uri: MockUri, content: Uint8Array): Promise<void> {
      await fsp.mkdir(path.dirname(uri.fsPath), { recursive: true });
      await fsp.writeFile(uri.fsPath, Buffer.from(content));
    },
    async readFile(uri: MockUri): Promise<Uint8Array> {
      const data = await fsp.readFile(uri.fsPath);
      return ensureUint8Array(data);
    },
    async delete(uri: MockUri, options?: { recursive?: boolean }): Promise<void> {
      await fsp.rm(uri.fsPath, { recursive: options?.recursive ?? false, force: true });
    },
    async readDirectory(uri: MockUri): Promise<[string, number][]> {
      try {
        const directory = await fsp.readdir(uri.fsPath, { withFileTypes: true });
        return directory.map((entry) => [
          entry.name,
          entry.isDirectory()
            ? FileType.Directory
            : entry.isFile()
              ? FileType.File
              : FileType.Unknown,
        ]);
      } catch (error: any) {
        if (error?.code === "ENOENT") {
          return [];
        }
        throw error;
      }
    },
  },
};

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: () => Promise.resolve(),
};

export const extensions = {
  getExtension: () => undefined,
};

export const Uri = {
  parse: (value: string) => parseUri(value),
  file: (fsPath: string) => createFileUri(fsPath),
  joinPath: (base: MockUri, ...segments: string[]) =>
    createFileUri(path.join(base.fsPath, ...segments)),
};

export const Disposable = class {
  private readonly callOnDispose?: () => void;
  private readonly disposables?: { dispose(): unknown }[];

  constructor(onDispose?: (() => void) | { dispose(): unknown }[]) {
    if (Array.isArray(onDispose)) {
      this.disposables = onDispose;
      this.callOnDispose = undefined;
    } else {
      this.callOnDispose = onDispose;
      this.disposables = undefined;
    }
  }

  dispose(): void {
    if (typeof this.callOnDispose === "function") {
      try {
        this.callOnDispose();
      } catch {
        // Ignore disposal errors in the mock.
      }
      return;
    }

    if (!this.disposables) {
      return;
    }
    for (const disposable of this.disposables) {
      try {
        disposable.dispose();
      } catch {
        // Ignore disposal errors in the mock.
      }
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  static from(...disposables: { dispose(): unknown }[]): Disposable {
    return new Disposable(disposables);
  }
};

export const EventEmitter = class {
  event: any = () => ({ dispose: () => {} });
  fire(): void {}
  dispose(): void {}
};

export const ExtensionContext = class {
  subscriptions: any[] = [];
  extensionUri: any = Uri.parse("file://test");
  globalState: any = {
    get: () => undefined,
    update: () => Promise.resolve(),
  };
  workspaceState: any = {
    get: () => undefined,
    update: () => Promise.resolve(),
  };
  secrets: any = {
    get: () => Promise.resolve(undefined),
    store: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  };
};

export const LogLevel = {
  Trace: 0,
  Debug: 1,
  Info: 2,
  Warning: 3,
  Error: 4,
  Critical: 5,
  Off: 6,
};

export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
};

export type { MockUri };
