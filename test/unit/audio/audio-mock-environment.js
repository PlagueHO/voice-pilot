"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockAudioContext = exports.MockMediaStreamAudioDestinationNode = exports.MockAudioWorkletNode = exports.MockAnalyserNode = exports.MockGainNode = exports.MockMediaStreamAudioSourceNode = exports.MockMediaStream = exports.MockMediaStreamTrack = void 0;
exports.installMockAudioEnvironment = installMockAudioEnvironment;
const assert = __importStar(require("assert"));
let contextIdCounter = 0;
let streamIdCounter = 0;
let trackIdCounter = 0;
class MockMediaStreamTrack {
    kind = "audio";
    enabled = true;
    muted = false;
    readyState = "live";
    label;
    listeners = new Map();
    sampleRate;
    channelCount;
    constructor(label, options = {}) {
        this.label = label;
        this.id = `mock-track-${++trackIdCounter}`;
        this.sampleRate = options.sampleRate ?? 24000;
        this.channelCount = options.channelCount ?? 1;
    }
    id;
    stop() {
        if (this.readyState === "ended") {
            return;
        }
        this.readyState = "ended";
        this.dispatch("ended");
    }
    addEventListener(type, listener) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type).add(listener);
    }
    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }
    getSettings() {
        return {
            deviceId: this.label,
            channelCount: this.channelCount,
            sampleRate: this.sampleRate,
        };
    }
    dispatch(type) {
        for (const handler of this.listeners.get(type) ?? []) {
            handler();
        }
    }
}
exports.MockMediaStreamTrack = MockMediaStreamTrack;
class MockMediaStream {
    id = `mock-stream-${++streamIdCounter}`;
    tracks;
    constructor(tracks) {
        this.tracks = tracks;
    }
    getTracks() {
        return [...this.tracks];
    }
    getAudioTracks() {
        return this.getTracks();
    }
}
exports.MockMediaStream = MockMediaStream;
class MockMediaStreamAudioSourceNode {
    connections = [];
    context;
    constructor(context, options) {
        this.context = context;
        assert.ok(options.mediaStream, "Source node requires a media stream");
    }
    connect(target) {
        this.connections.push(target);
    }
    disconnect() {
        this.connections.length = 0;
    }
}
exports.MockMediaStreamAudioSourceNode = MockMediaStreamAudioSourceNode;
class MockGainNode {
    connections = [];
    gain = { value: 1 };
    context;
    constructor(context) {
        this.context = context;
    }
    connect(target) {
        this.connections.push(target);
    }
    disconnect() {
        this.connections.length = 0;
    }
}
exports.MockGainNode = MockGainNode;
class MockAnalyserNode {
    connections = [];
    fftSize = 2048;
    smoothingTimeConstant = 0.8;
    minDecibels = -90;
    maxDecibels = -10;
    context;
    constructor(context) {
        this.context = context;
    }
    connect(target) {
        this.connections.push(target);
    }
    disconnect() {
        this.connections.length = 0;
    }
    getFloatTimeDomainData(array) {
        array.fill(0);
    }
}
exports.MockAnalyserNode = MockAnalyserNode;
class MockAudioWorkletNode {
    connections = [];
    port = {
        close: () => {
            this.portClosed = true;
        },
    };
    portClosed = false;
    context;
    name;
    options;
    constructor(context, name, options) {
        this.context = context;
        this.name = name;
        this.options = options;
    }
    connect(target) {
        this.connections.push(target);
    }
    disconnect() {
        this.connections.length = 0;
    }
}
exports.MockAudioWorkletNode = MockAudioWorkletNode;
class MockMediaStreamAudioDestinationNode {
    stream;
    connections = [];
    context;
    constructor(context) {
        this.context = context;
        const processedTrack = new MockMediaStreamTrack("processed-track");
        this.stream = new MockMediaStream([processedTrack]);
    }
    connect() {
        // no-op for tests
    }
    disconnect() {
        this.connections.length = 0;
    }
}
exports.MockMediaStreamAudioDestinationNode = MockMediaStreamAudioDestinationNode;
class MockAudioContext {
    id = ++contextIdCounter;
    state = "suspended";
    options;
    audioWorklet = {
        addModule: async (url) => {
            this.loadedModules.push(url);
        },
    };
    destination = {};
    sampleRate;
    listeners = {};
    constructor(options) {
        this.options = options;
        createdContexts.push(this);
        this.sampleRate = options.sampleRate ?? 24000;
    }
    loadedModules = [];
    addEventListener(type, listener) {
        if (!this.listeners[type]) {
            this.listeners[type] = new Set();
        }
        this.listeners[type].add(listener);
    }
    createMediaStreamSource(stream) {
        return new MockMediaStreamAudioSourceNode(this, { mediaStream: stream });
    }
    createGain() {
        return new MockGainNode(this);
    }
    createAnalyser() {
        return new MockAnalyserNode(this);
    }
    removeEventListener(type, listener) {
        this.listeners[type]?.delete(listener);
    }
    async resume() {
        this.state = "running";
        this.emit("statechange");
    }
    async suspend() {
        this.state = "suspended";
        this.emit("statechange");
    }
    async close() {
        this.state = "closed";
        this.emit("statechange");
    }
    emit(type) {
        for (const listener of this.listeners[type] ?? []) {
            listener();
        }
    }
}
exports.MockAudioContext = MockAudioContext;
const createdContexts = [];
function installMockAudioEnvironment() {
    const workletModules = [];
    const capturedStreams = [];
    const original = {
        AudioContext: globalThis.AudioContext,
        webkitAudioContext: globalThis.webkitAudioContext,
        MediaStream: globalThis.MediaStream,
        MediaStreamTrack: globalThis.MediaStreamTrack,
        MediaStreamAudioSourceNode: globalThis.MediaStreamAudioSourceNode,
        AudioWorkletNode: globalThis.AudioWorkletNode,
        MediaStreamAudioDestinationNode: globalThis.MediaStreamAudioDestinationNode,
        navigator: globalThis.navigator,
        navigatorDescriptor: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
        createObjectURL: URL.createObjectURL,
        revokeObjectURL: URL.revokeObjectURL,
    };
    globalThis.AudioContext = class extends MockAudioContext {
        constructor(options) {
            super(options);
            const originalAddModule = this.audioWorklet.addModule.bind(this.audioWorklet);
            this.audioWorklet.addModule = async (url) => {
                await originalAddModule(url);
                workletModules.push(url);
            };
        }
    };
    globalThis.webkitAudioContext = undefined;
    globalThis.MediaStream = MockMediaStream;
    globalThis.MediaStreamTrack = MockMediaStreamTrack;
    globalThis.MediaStreamAudioSourceNode = MockMediaStreamAudioSourceNode;
    globalThis.AudioWorkletNode = MockAudioWorkletNode;
    globalThis.MediaStreamAudioDestinationNode =
        MockMediaStreamAudioDestinationNode;
    let lastUserMediaStream;
    const mockNavigator = {
        mediaDevices: {
            getUserMedia: async () => {
                const track = new MockMediaStreamTrack("default-mic");
                lastUserMediaStream = new MockMediaStream([track]);
                capturedStreams.push(lastUserMediaStream);
                return lastUserMediaStream;
            },
            enumerateDevices: async () => {
                return [
                    {
                        deviceId: "mock-device",
                        groupId: "group",
                        kind: "audioinput",
                        label: "Mock Microphone",
                        toJSON: () => ({}),
                    },
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
    }
    else {
        globalThis.navigator = mockNavigator;
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
        restore() {
            globalThis.AudioContext = original.AudioContext;
            globalThis.webkitAudioContext = original.webkitAudioContext;
            globalThis.MediaStream = original.MediaStream;
            globalThis.MediaStreamTrack = original.MediaStreamTrack;
            globalThis.MediaStreamAudioSourceNode =
                original.MediaStreamAudioSourceNode;
            globalThis.AudioWorkletNode = original.AudioWorkletNode;
            globalThis.MediaStreamAudioDestinationNode =
                original.MediaStreamAudioDestinationNode;
            if (original.navigatorDescriptor) {
                Object.defineProperty(globalThis, "navigator", original.navigatorDescriptor);
            }
            else if (original.navigator !== undefined) {
                globalThis.navigator = original.navigator;
            }
            else {
                delete globalThis.navigator;
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
//# sourceMappingURL=audio-mock-environment.js.map