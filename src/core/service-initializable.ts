export interface ServiceInitializable {
  initialize(): Promise<void>;
  dispose(): void;
  isInitialized(): boolean;
}
