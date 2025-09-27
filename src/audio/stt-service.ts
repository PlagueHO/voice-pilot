import { Logger } from "../core/logger";
import {
  AudioTranscript,
  RealtimeAudioConfig,
  RealtimeAudioService,
} from "./realtime-audio-service";

/**
 * Speech-to-Text service using Azure OpenAI Realtime API
 * This is a wrapper around RealtimeAudioService for backward compatibility
 */
export class STTService {
  private realtimeService: RealtimeAudioService;
  private logger: Logger;
  private transcriptCallback?: (text: string) => void;

  constructor(
    endpoint: string,
    deploymentName: string,
    apiVersion: string,
    logger?: Logger,
  ) {
    this.logger = logger || new Logger("STTService");

    const config: RealtimeAudioConfig = {
      endpoint,
      deploymentName,
      apiVersion,
    };

    this.realtimeService = new RealtimeAudioService(config, this.logger);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle transcription events from the realtime service
    this.realtimeService.onTranscript((transcript: AudioTranscript) => {
      this.logger.debug("STT transcript received", {
        text: transcript.text,
        isFinal: transcript.isFinal,
      });
      this.transcriptCallback?.(transcript.text);
    });

    this.realtimeService.onError((error: Error) => {
      this.logger.error("STT service error", { error: error.message });
    });
  }

  public async initialize(): Promise<void> {
    await this.realtimeService.initialize();
    this.logger.info("STT service initialized");
  }

  public async startRecording(): Promise<void> {
    try {
      await this.realtimeService.startSession();
      this.realtimeService.startRecording();
      this.logger.info("STT recording started");
    } catch (error: any) {
      this.logger.error("Failed to start STT recording", {
        error: error.message,
      });
      throw error;
    }
  }

  public async start(): Promise<void> {
    return this.startRecording();
  }

  public stopRecording(): void {
    this.realtimeService.stopRecording();
    this.logger.info("STT recording stopped");
  }

  public stop(): void {
    this.stopRecording();
  }

  public stopSession(): void {
    this.realtimeService.stopSession();
    this.logger.info("STT session stopped");
  }

  public isRecording(): boolean {
    return this.realtimeService.getIsRecording();
  }

  public isConnected(): boolean {
    return this.realtimeService.getIsConnected();
  }

  public onTranscript(callback: (text: string) => void): void {
    this.transcriptCallback = callback;
  }

  public async sendAudioData(audioData: Buffer): Promise<void> {
    await this.realtimeService.sendAudioData(audioData);
  }

  public dispose(): void {
    this.realtimeService.dispose();
    this.logger.info("STT service disposed");
  }
}
