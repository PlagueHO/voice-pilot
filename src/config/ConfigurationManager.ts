import { ServiceInitializable } from '../core/ServiceInitializable';

export class ConfigurationManager implements ServiceInitializable {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    // TODO: Load and validate configuration from VS Code settings
    this.initialized = true;
  }

  isInitialized(): boolean { return this.initialized; }

  dispose(): void {
    // noop for now
  }
}
