import * as assert from "assert";

interface ListenerMap {
  [type: string]: Set<() => void>;
}

let contextIdCounter = 0;
let streamIdCounter = 0;
let trackIdCounter = 0;

export class MockMediaStreamTrack {
  public readonly kind = "audio";
  public enabled = true;
  public muted = false;
  public readyState: MediaStreamTrackState = "live";
  public readonly label: string;
  private readonly listeners: Map<string, Set<() => void>> = new Map();
  private readonly sampleRate: number;
  private readonly channelCount: number;

  constructor(
    label: string,
    options: { sampleRate?: number; channelCount?: number } = {},
  ) {
    this.label = label;
    this.id = `mock-track-${++trackIdCounter}`;
    this.sampleRate = options.sampleRate ?? 24000;
    this.channelCount = options.channelCount ?? 1;
  }

  public readonly id: string;

  stop(): void {
    if (this.readyState === "ended") {
      return;
    }
    this.readyState = "ended";
    this.dispatch("ended");
  }

  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  getSettings(): MediaTrackSettings {
    return {
      deviceId: this.label,
      channelCount: this.channelCount,
      sampleRate: this.sampleRate,
    } as MediaTrackSettings;
  }

  dispatch(type: string): void {
    for (const handler of this.listeners.get(type) ?? []) {
      handler();
    }
  }
}

export class MockMediaStream {
  public readonly id = `mock-stream-${++streamIdCounter}`;
  private readonly tracks: MockMediaStreamTrack[];

  constructor(tracks: MockMediaStreamTrack[]) {
    this.tracks = tracks;
  }

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks] as unknown as MediaStreamTrack[];
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.getTracks();
  }
}

export class MockMediaStreamAudioSourceNode {
  public readonly connections: any[] = [];
  public readonly context: MockAudioContext;

  constructor(
    context: MockAudioContext,
    options: { mediaStream: MockMediaStream },
  ) {
    this.context = context;
    assert.ok(options.mediaStream, "Source node requires a media stream");
  }

  connect(target: any): void {
    this.connections.push(target);
  }

  disconnect(): void {
    this.connections.length = 0;
  }
}

export class MockGainNode {
  public readonly connections: any[] = [];
  public readonly gain = { value: 1 };
  public readonly context: MockAudioContext;

  constructor(context: MockAudioContext) {
    this.context = context;
  }

  connect(target: any): void {
    this.connections.push(target);
  }

  disconnect(): void {
    this.connections.length = 0;
  }
}

export class MockAnalyserNode {
  public readonly connections: any[] = [];
  public fftSize = 2048;
  public smoothingTimeConstant = 0.8;
  public minDecibels = -90;
  public maxDecibels = -10;
  public readonly context: MockAudioContext;

  constructor(context: MockAudioContext) {
    this.context = context;
  }

  connect(target: any): void {
    this.connections.push(target);
  }

  disconnect(): void {
    this.connections.length = 0;
  }

  getFloatTimeDomainData(array: Float32Array): void {
    array.fill(0);
  }
}

export class MockAudioWorkletNode {
  public readonly connections: any[] = [];
  public readonly port = {
    close: () => {
      this.portClosed = true;
    },
  };
  public portClosed = false;
  public readonly context: MockAudioContext;
  public readonly name: string;
  public readonly options?: AudioWorkletNodeOptions;

  constructor(
    context: MockAudioContext,
    name: string,
    options?: AudioWorkletNodeOptions,
  ) {
    this.context = context;
    this.name = name;
    this.options = options;
  }

  connect(target: any): void {
    this.connections.push(target);
  }

  disconnect(): void {
    this.connections.length = 0;
  }
}

export class MockMediaStreamAudioDestinationNode {
  public readonly stream: MockMediaStream;
  public readonly connections: any[] = [];
  public readonly context: MockAudioContext;

  constructor(context: MockAudioContext) {
    this.context = context;
    const processedTrack = new MockMediaStreamTrack("processed-track");
    this.stream = new MockMediaStream([processedTrack]);
  }

  connect(): void {
    // no-op for tests
  }

  disconnect(): void {
    this.connections.length = 0;
  }
}

export class MockAudioContext {
  public readonly id = ++contextIdCounter;
  public state: AudioContextState = "suspended";
  public readonly options: AudioContextOptions;
  public readonly audioWorklet = {
    addModule: async (url: string) => {
      this.loadedModules.push(url);
    },
  };
  public readonly destination = {};
  public readonly sampleRate: number;

  private readonly listeners: ListenerMap = {};

  constructor(options: AudioContextOptions) {
    this.options = options;
    createdContexts.push(this);
    this.sampleRate = options.sampleRate ?? 24000;
  }

  public readonly loadedModules: string[] = [];

  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners[type]) {
      this.listeners[type] = new Set();
    }
    this.listeners[type]!.add(listener);
  }

  createMediaStreamSource(stream: MockMediaStream): MockMediaStreamAudioSourceNode {
    return new MockMediaStreamAudioSourceNode(this, { mediaStream: stream });
  }

  createGain(): MockGainNode {
    return new MockGainNode(this);
  }

  createAnalyser(): MockAnalyserNode {
    return new MockAnalyserNode(this);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners[type]?.delete(listener);
  }

  async resume(): Promise<void> {
    this.state = "running";
    this.emit("statechange");
  }

  async suspend(): Promise<void> {
    this.state = "suspended";
    this.emit("statechange");
  }

  async close(): Promise<void> {
    this.state = "closed";
    this.emit("statechange");
  }

  private emit(type: string): void {
    for (const listener of this.listeners[type] ?? []) {
      listener();
    }
  }
}

export interface AudioMockEnvironment {
  createdContexts: MockAudioContext[];
  workletModules: string[];
  lastUserMediaStream?: MockMediaStream;
  capturedStreams: MockMediaStream[];
  restore(): void;
}

const createdContexts: MockAudioContext[] = [];

export function installMockAudioEnvironment(): AudioMockEnvironment {
  const workletModules: string[] = [];
  const capturedStreams: MockMediaStream[] = [];

  const original = {
    AudioContext: (globalThis as any).AudioContext,
    webkitAudioContext: (globalThis as any).webkitAudioContext,
    MediaStream: (globalThis as any).MediaStream,
    MediaStreamTrack: (globalThis as any).MediaStreamTrack,
    MediaStreamAudioSourceNode: (globalThis as any).MediaStreamAudioSourceNode,
    AudioWorkletNode: (globalThis as any).AudioWorkletNode,
    MediaStreamAudioDestinationNode:
      (globalThis as any).MediaStreamAudioDestinationNode,
    navigator: (globalThis as any).navigator,
    navigatorDescriptor: Object.getOwnPropertyDescriptor(
      globalThis,
      "navigator",
    ),
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };

  (globalThis as any).AudioContext = class extends MockAudioContext {
    constructor(options: AudioContextOptions) {
      super(options);
      const originalAddModule = this.audioWorklet.addModule.bind(
        this.audioWorklet,
      );
      this.audioWorklet.addModule = async (url: string) => {
        await originalAddModule(url);
        workletModules.push(url);
      };
    }
  };
  (globalThis as any).webkitAudioContext = undefined;
  (globalThis as any).MediaStream = MockMediaStream;
  (globalThis as any).MediaStreamTrack = MockMediaStreamTrack;
  (globalThis as any).MediaStreamAudioSourceNode = MockMediaStreamAudioSourceNode;
  (globalThis as any).AudioWorkletNode = MockAudioWorkletNode;
  (globalThis as any).MediaStreamAudioDestinationNode =
    MockMediaStreamAudioDestinationNode;

  let lastUserMediaStream: MockMediaStream | undefined;

  const mockNavigator = {
    mediaDevices: {
      getUserMedia: async (): Promise<MediaStream> => {
        const track = new MockMediaStreamTrack("default-mic");
        lastUserMediaStream = new MockMediaStream([track]);
        capturedStreams.push(lastUserMediaStream);
        return lastUserMediaStream as unknown as MediaStream;
      },
      enumerateDevices: async (): Promise<MediaDeviceInfo[]> => {
        return [
          {
            deviceId: "mock-device",
            groupId: "group",
            kind: "audioinput",
            label: "Mock Microphone",
            toJSON: () => ({}),
          } as MediaDeviceInfo,
        ];
      },
    },
  };

  if (original.navigatorDescriptor) {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      enumerable: original.navigatorDescriptor.enumerable,
      writable: true,
      value: mockNavigator,
    });
  } else {
    (globalThis as any).navigator = mockNavigator;
  }

  URL.createObjectURL = (() => {
    let counter = 0;
    return () => `mock://blob/${++counter}`;
  })();
  URL.revokeObjectURL = () => {
    // no-op for tests
  };

  return {
    createdContexts,
    workletModules,
    get lastUserMediaStream() {
      return lastUserMediaStream;
    },
    capturedStreams,
    restore(): void {
      (globalThis as any).AudioContext = original.AudioContext;
      (globalThis as any).webkitAudioContext = original.webkitAudioContext;
      (globalThis as any).MediaStream = original.MediaStream;
      (globalThis as any).MediaStreamTrack = original.MediaStreamTrack;
      (globalThis as any).MediaStreamAudioSourceNode =
        original.MediaStreamAudioSourceNode;
      (globalThis as any).AudioWorkletNode = original.AudioWorkletNode;
      (globalThis as any).MediaStreamAudioDestinationNode =
        original.MediaStreamAudioDestinationNode;
      if (original.navigatorDescriptor) {
        Object.defineProperty(
          globalThis,
          "navigator",
          original.navigatorDescriptor,
        );
      } else if (original.navigator !== undefined) {
        (globalThis as any).navigator = original.navigator;
      } else {
        delete (globalThis as any).navigator;
      }
      URL.createObjectURL = original.createObjectURL;
      URL.revokeObjectURL = original.revokeObjectURL;
      createdContexts.length = 0;
      workletModules.length = 0;
      lastUserMediaStream = undefined;
      capturedStreams.length = 0;
      contextIdCounter = 0;
      streamIdCounter = 0;
      trackIdCounter = 0;
    },
  };
}
