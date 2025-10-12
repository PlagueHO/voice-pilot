export interface ResourceTracker {
  trackDisposable(id: string): () => void;
}

export interface TimerTracker extends ResourceTracker {
  trackTimer(id: string): () => void;
}

export interface AudioResourceTracker extends ResourceTracker {
  trackMediaStream(id: string): () => void;
  trackAudioNode?(id: string): () => void;
}

export interface DataChannelTracker extends ResourceTracker {
  trackDataChannel(id: string): () => void;
}
