import { ServiceInitializable } from '../core/service-initializable';

export class SessionManager implements ServiceInitializable {
  private initialized = false;
  private active = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    // TODO: Prepare any session state structures
    this.initialized = true;
  }

  isInitialized(): boolean { return this.initialized; }

  dispose(): void {
    // End any active session
    this.active = false;
  }

  async startSession(): Promise<void> {
    if (!this.initialized) {
      throw new Error('SessionManager not initialized');
    }
    this.active = true;
  }

  async endSession(): Promise<void> {
    this.active = false;
  }

  isSessionActive(): boolean { return this.active; }
}

// Backwards-compatible implementation name expected by existing tests
export class SessionManagerImpl extends SessionManager { }
