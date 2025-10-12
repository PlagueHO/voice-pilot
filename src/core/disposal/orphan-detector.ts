import { OrphanSnapshot } from "../../types/disposal";

type ResourceCategory = "timer" | "audio" | "media" | "data" | "disposable";

export class OrphanDetector {
  private readonly timers = new Set<string>();
  private readonly audioNodes = new Set<string>();
  private readonly mediaStreams = new Set<string>();
  private readonly dataChannels = new Set<string>();
  private readonly disposables = new Set<string>();

  trackTimer(id: string): () => void {
    return this.track("timer", id);
  }

  trackAudioNode(id: string): () => void {
    return this.track("audio", id);
  }

  trackMediaStream(id: string): () => void {
    return this.track("media", id);
  }

  trackDataChannel(id: string): () => void {
    return this.track("data", id);
  }

  trackDisposable(id: string): () => void {
    return this.track("disposable", id);
  }

  async captureSnapshot(): Promise<OrphanSnapshot> {
    return {
      timers: this.timers.size,
      audioNodes: this.audioNodes.size,
      mediaStreams: this.mediaStreams.size,
      dataChannels: this.dataChannels.size,
      disposables: this.disposables.size,
    };
  }

  reset(): void {
    this.timers.clear();
    this.audioNodes.clear();
    this.mediaStreams.clear();
    this.dataChannels.clear();
    this.disposables.clear();
  }

  private track(category: ResourceCategory, id: string): () => void {
    const collection = this.resolveCollection(category);
    collection.add(id);
    return () => {
      collection.delete(id);
    };
  }

  private resolveCollection(category: ResourceCategory): Set<string> {
    switch (category) {
      case "timer":
        return this.timers;
      case "audio":
        return this.audioNodes;
      case "media":
        return this.mediaStreams;
      case "data":
        return this.dataChannels;
      case "disposable":
      default:
        return this.disposables;
    }
  }
}
