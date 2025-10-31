import { Logger } from "../core/logger";
import type { AudioCodecProfileId, AudioConfiguration } from "../types/webrtc";
import type { AudioCodecProfile } from "./codec/audio-codec-profile";

const IDENTITY_WORKLET_NAME = "agentvoice-identity-processor";
const IDENTITY_WORKLET_SOURCE = `
class AgentVoiceIdentityProcessor extends AudioWorkletProcessor {
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

registerProcessor('${IDENTITY_WORKLET_NAME}', AgentVoiceIdentityProcessor,);
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
  private appliedLatencyHint?: AudioContextLatencyCategory | number;
  private appliedCodecProfileId?: AudioCodecProfileId;

  /**
   * Creates a provider with optional logging support for audio context lifecycle events.
   *
   * @param logger - Optional logger instance to use for diagnostics; defaults to a namespaced logger.
   */
  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger("AudioContextProvider");
  }

  /**
   * Applies runtime configuration required to construct and augment an {@link AudioContext}.
   *
   * @param configuration - Audio configuration values including worklet URLs and context options.
   */
  configure(
    configuration: AudioConfiguration,
    codecProfile?: AudioCodecProfile,
  ): void {
    this.configuration = configuration;

    if (this.context && configuration.workletModuleUrls.length > 0) {
      void this.loadExternalWorklets(
        configuration.workletModuleUrls,
        this.context,
      );
    }
  }

  /**
   * Indicates whether the browser requires a user gesture before audio playback can begin.
   *
   * @returns `true` when a user gesture must precede context construction or resume.
   */
  requiresUserGesture(): boolean {
    return !!this.configuration?.audioContextProvider.requiresUserGesture;
  }

  /**
   * Registers a listener that will be notified whenever the audio context state changes.
   *
   * @param listener - Callback invoked with the current {@link AudioContextState}.
   */
  registerStateListener(listener: AudioContextStateListener): void {
    this.stateListeners.add(listener);

    const context = this.context;
    if (context) {
      listener(context.state);
    }
  }

  /**
   * Removes a previously registered state listener.
   *
   * @param listener - Callback reference that should no longer receive updates.
   */
  unregisterStateListener(listener: AudioContextStateListener): void {
    this.stateListeners.delete(listener);
  }

  /**
   * Resolves the shared {@link AudioContext}, creating one if it does not yet exist.
   *
   * @returns Promise that resolves with the active audio context instance.
   */
  async getOrCreateContext(): Promise<AudioContext> {
    if (!this.contextPromise) {
      this.contextPromise = this.createContext();
    }

    return this.contextPromise;
  }

  /**
   * Returns the current {@link AudioContext} instance without creating a new one.
   *
   * @returns The active audio context or `null` when no context has been created yet.
   */
  getCurrentContext(): AudioContext | null {
    return this.context ?? null;
  }

  /**
   * Resumes a suspended {@link AudioContext} to allow audio processing to continue.
   */
  async resume(): Promise<void> {
    const context = await this.getOrCreateContext();
    if (context.state === "suspended") {
      await context.resume();
      this.logger.debug("AudioContext resumed");
    }
  }

  /**
   * Suspends the active {@link AudioContext}, halting audio processing until resumed.
   */
  async suspend(): Promise<void> {
    if (!this.context) {
      return;
    }

    if (this.context.state === "running") {
      await this.context.suspend();
      this.logger.debug("AudioContext suspended");
    }
  }

  /**
   * Closes the current {@link AudioContext} and releases associated resources.
   */
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
    this.appliedLatencyHint = undefined;
    this.appliedCodecProfileId = undefined;
  }

  /**
   * Builds an identity processing graph for the provided media stream.
   *
   * @param stream - Input media stream whose audio tracks should be routed through worklet processing.
   * @returns Audio graph nodes including source, processor, and destination references.
   */
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

  /**
   * Connects a media stream directly to the audio context destination for playback.
   *
   * @param stream - Media stream whose audio should be routed to the output destination.
   * @returns The created source node connected to the context destination.
   */
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

  async ensureContextMatchesConfiguration(): Promise<void> {
    if (!this.configuration) {
      return;
    }

    if (!this.context) {
      return;
    }

    const desiredSampleRate = this.configuration.sampleRate;
    const desiredLatencyHint =
      this.configuration.audioContextProvider.latencyHint ?? "interactive";
    const desiredCodecProfileId = this.configuration.codecProfileId;

    const sampleRateMatches = this.context.sampleRate === desiredSampleRate;
    const latencyMatches =
      typeof this.appliedLatencyHint === "undefined" ||
      this.appliedLatencyHint === desiredLatencyHint;
    const codecMatches =
      typeof this.appliedCodecProfileId === "undefined" ||
      this.appliedCodecProfileId === desiredCodecProfileId;

    if (sampleRateMatches && latencyMatches && codecMatches) {
      return;
    }

    this.logger.info(
      "Reinitializing shared AudioContext to honor negotiated capture settings",
      {
        previousSampleRate: this.context.sampleRate,
        desiredSampleRate,
        previousLatencyHint: this.appliedLatencyHint,
        desiredLatencyHint,
        previousCodecProfileId: this.appliedCodecProfileId,
        desiredCodecProfileId,
      },
    );

    await this.close();
    await this.getOrCreateContext();
  }

  /**
   * Initializes a new {@link AudioContext} instance using the current configuration.
   *
   * @throws When configuration or browser APIs required for audio context creation are unavailable.
   * @returns Promise resolving with the configured audio context.
   */
  private async createContext(): Promise<AudioContext> {
    if (!this.configuration) {
      throw new Error(
        "AudioContextProvider requires configuration before creating a context.",
      );
    }

    const AudioContextCtor =
      (globalThis as any).AudioContext ||
      (globalThis as any).webkitAudioContext;

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
    this.appliedLatencyHint = latencyHint;
    this.appliedCodecProfileId = this.configuration.codecProfileId;
    return context;
  }

  /**
   * Handles native audio context state changes and propagates them to registered listeners.
   */
  private readonly handleStateChange = (): void => {
    const state = this.context?.state ?? "closed";
    this.notifyStateListeners(state as AudioContextState);
  };

  /**
   * Notifies all registered listeners of an audio context state transition.
   *
   * @param state - The new state reported by the audio context.
   */
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

  /**
   * Ensures the identity worklet module is available within the supplied audio context.
   *
   * @param context - Audio context into which the identity worklet should be loaded.
   */
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

  /**
   * Loads additional audio worklet modules specified by configuration, avoiding duplicates.
   *
   * @param urls - Array of external worklet module URLs to load.
   * @param contextOverride - Optional context to use instead of the shared instance.
   */
  private async loadExternalWorklets(
    urls: ReadonlyArray<string>,
    contextOverride?: AudioContext,
  ): Promise<void> {
    if (!urls || urls.length === 0) {
      return;
    }

    const context = contextOverride ?? (await this.getOrCreateContext());

    if (!context.audioWorklet) {
      this.logger.warn(
        "AudioWorklet API not available; skipping external worklet loading",
      );
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

  getActiveCodecProfileId(): AudioCodecProfileId | null {
    return this.appliedCodecProfileId ?? null;
  }
}

export const sharedAudioContextProvider = new AudioContextProvider();
