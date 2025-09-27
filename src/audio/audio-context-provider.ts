import { Logger } from "../core/logger";
import type { AudioConfiguration } from "../types/webrtc";

const IDENTITY_WORKLET_NAME = "voicepilot-identity-processor";
const IDENTITY_WORKLET_SOURCE = `
class VoicePilotIdentityProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output) {
      return true;
    }

    const channelCount = Math.min(input.length, output.length);
    for (let channel = 0; channel < channelCount; channel++) {
      output[channel].set(input[channel]);
    }

    return true;
  }
}

registerProcessor('${IDENTITY_WORKLET_NAME}', VoicePilotIdentityProcessor);
`;

const registeredContexts = new WeakSet<AudioContext>();

export type AudioContextStateListener = (state: AudioContextState) => void;

export interface AudioGraphNodes {
  source: MediaStreamAudioSourceNode;
  processor: AudioWorkletNode;
  destination: MediaStreamAudioDestinationNode;
}

export class AudioContextProvider {
  private readonly logger: Logger;
  private configuration?: AudioConfiguration;
  private contextPromise?: Promise<AudioContext>;
  private context?: AudioContext;
  private readonly stateListeners = new Set<AudioContextStateListener>();
  private readonly loadedWorkletUrls = new Set<string>();

  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger("AudioContextProvider");
  }

  configure(configuration: AudioConfiguration): void {
    this.configuration = configuration;

    if (this.context && configuration.workletModuleUrls.length > 0) {
      void this.loadExternalWorklets(configuration.workletModuleUrls, this.context);
    }
  }

  requiresUserGesture(): boolean {
    return !!this.configuration?.audioContextProvider.requiresUserGesture;
  }

  registerStateListener(listener: AudioContextStateListener): void {
    this.stateListeners.add(listener);

    const context = this.context;
    if (context) {
      listener(context.state);
    }
  }

  unregisterStateListener(listener: AudioContextStateListener): void {
    this.stateListeners.delete(listener);
  }

  async getOrCreateContext(): Promise<AudioContext> {
    if (!this.contextPromise) {
      this.contextPromise = this.createContext();
    }

    return this.contextPromise;
  }

  async resume(): Promise<void> {
    const context = await this.getOrCreateContext();
    if (context.state === "suspended") {
      await context.resume();
      this.logger.debug("AudioContext resumed");
    }
  }

  async suspend(): Promise<void> {
    if (!this.context) {
      return;
    }

    if (this.context.state === "running") {
      await this.context.suspend();
      this.logger.debug("AudioContext suspended");
    }
  }

  async close(): Promise<void> {
    if (!this.context) {
      return;
    }

    this.context.removeEventListener("statechange", this.handleStateChange);
    await this.context.close();
    this.notifyStateListeners("closed");

    this.context = undefined;
    this.contextPromise = undefined;
    this.loadedWorkletUrls.clear();
  }

  async createGraphForStream(stream: MediaStream): Promise<AudioGraphNodes> {
    const context = await this.getOrCreateContext();
    await this.ensureIdentityWorklet(context);

    const source = new MediaStreamAudioSourceNode(context, {
      mediaStream: stream,
    });

    const processor = new AudioWorkletNode(context, IDENTITY_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });

    const destination = new MediaStreamAudioDestinationNode(context, {
      channelCount: 1,
    });

    source.connect(processor);
    processor.connect(destination);

    this.logger.debug("Audio processing graph created", {
      sourceTrackCount: stream.getTracks().length,
      destinationTrackCount: destination.stream.getTracks().length,
    });

    return { source, processor, destination };
  }

  async connectStreamToDestination(
    stream: MediaStream,
  ): Promise<MediaStreamAudioSourceNode> {
    const context = await this.getOrCreateContext();
    const source = new MediaStreamAudioSourceNode(context, {
      mediaStream: stream,
    });
    source.connect(context.destination);
    return source;
  }

  private async createContext(): Promise<AudioContext> {
    if (!this.configuration) {
      throw new Error(
        "AudioContextProvider requires configuration before creating a context.",
      );
    }

    const AudioContextCtor =
      (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;

    if (!AudioContextCtor) {
      throw new Error("AudioContext API is not available in this environment.");
    }

    const latencyHint =
      this.configuration.audioContextProvider.latencyHint ?? "interactive";

    const context = new AudioContextCtor({
      latencyHint,
      sampleRate: this.configuration.sampleRate,
    }) as AudioContext;

    context.addEventListener("statechange", this.handleStateChange);

    await this.ensureIdentityWorklet(context);
    await this.loadExternalWorklets(
      this.configuration.workletModuleUrls,
      context,
    );

    this.context = context;
    return context;
  }

  private readonly handleStateChange = (): void => {
    const state = this.context?.state ?? "closed";
    this.notifyStateListeners(state as AudioContextState);
  };

  private notifyStateListeners(state: AudioContextState): void {
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch (error: any) {
        this.logger.error("AudioContext state listener failed", {
          error: error?.message,
        });
      }
    }
  }

  private async ensureIdentityWorklet(context: AudioContext): Promise<void> {
    if (registeredContexts.has(context)) {
      return;
    }

    if (!context.audioWorklet) {
      throw new Error(
        "AudioWorklet API is required but not available in this environment.",
      );
    }

    const moduleBlob = new Blob([IDENTITY_WORKLET_SOURCE], {
      type: "text/javascript",
    });
    const moduleUrl = URL.createObjectURL(moduleBlob);

    try {
      await context.audioWorklet.addModule(moduleUrl);
      registeredContexts.add(context);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
  }

  private async loadExternalWorklets(
    urls: ReadonlyArray<string>,
    contextOverride?: AudioContext,
  ): Promise<void> {
    if (!urls || urls.length === 0) {
      return;
    }

    const context = contextOverride ?? (await this.getOrCreateContext());

    if (!context.audioWorklet) {
      this.logger.warn("AudioWorklet API not available; skipping external worklet loading");
      return;
    }

    const pendingLoads = urls
      .filter((url) => !this.loadedWorkletUrls.has(url))
      .map(async (url) => {
        try {
          await context.audioWorklet.addModule(url);
          this.loadedWorkletUrls.add(url);
          this.logger.debug("Loaded audio worklet module", { url });
        } catch (error: any) {
          this.logger.error("Failed to load audio worklet", {
            url,
            error: error?.message,
          });
          throw error;
        }
      });

    await Promise.all(pendingLoads);
  }
}

export const sharedAudioContextProvider = new AudioContextProvider();
