import { OrphanDetector } from "./orphan-detector";
import type {
    AudioResourceTracker,
    DataChannelTracker,
    ResourceTracker,
    TimerTracker,
} from "./resource-tracker";

/**
 * Connects {@link OrphanDetector} category registries to the resource-tracking
 * interfaces consumed by higher-level services.
 */
export class OrphanResourceTracker
  implements TimerTracker, AudioResourceTracker, DataChannelTracker
{
  constructor(private readonly orphanDetector: OrphanDetector) {}

  trackDisposable(id: string): () => void {
    return this.orphanDetector.trackDisposable(id);
  }

  trackTimer(id: string): () => void {
    return this.orphanDetector.trackTimer(id);
  }

  trackMediaStream(id: string): () => void {
    return this.orphanDetector.trackMediaStream(id);
  }

  trackAudioNode(id: string): () => void {
    return this.orphanDetector.trackAudioNode(id);
  }

  trackDataChannel(id: string): () => void {
    return this.orphanDetector.trackDataChannel(id);
  }
}

export type AggregatedResourceTracker =
  & ResourceTracker
  & TimerTracker
  & AudioResourceTracker
  & DataChannelTracker;
