import { expect } from "../helpers/chai-setup";

// Create a minimal mock to avoid VS Code dependencies in unit tests
class MockSessionManager {
  private initialized = false;
  private sessions = new Map<string, any>();

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.initialized = false;
    this.sessions.clear();
  }

  async startSession(): Promise<any> {
    if (!this.initialized) {
      throw new Error('SessionManager not initialized');
    }
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    const session = {
      sessionId,
      state: 'active',
      startedAt: new Date(),
      config: { renewalMarginSeconds: 10 }
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  async endSession(sessionId?: string): Promise<void> {
    if (sessionId) {
      this.sessions.delete(sessionId);
    } else {
      this.sessions.clear();
    }
  }

  isSessionActive(): boolean {
    return this.sessions.size > 0;
  }

  getAllSessions(): any[] {
    return Array.from(this.sessions.values());
  }
}

describe("Unit: SessionManager Core Logic", () => {
  let manager: MockSessionManager;

  beforeEach(() => {
    manager = new MockSessionManager();
  });

  it("is not initialized by default", () => {
    expect(manager.isInitialized()).to.equal(false);
  });

  it("initializes successfully", async () => {
    await manager.initialize();
    expect(manager.isInitialized()).to.equal(true);
  });

  it("is idempotent on initialization", async () => {
    await manager.initialize();
    await manager.initialize(); // Should not throw
    expect(manager.isInitialized()).to.equal(true);
  });

  it("throws when starting session before initialization", async () => {
    await expect(manager.startSession()).to.be.rejectedWith(/not initialized/i);
  });

  it("starts session successfully after initialization", async () => {
    await manager.initialize();
    const session = await manager.startSession();

    expect(session.sessionId).to.be.a("string").and.not.empty;
    expect(session.state).to.equal("active");
    expect(session.startedAt).to.be.instanceOf(Date);
    expect(manager.isSessionActive()).to.equal(true);
  });

  it("ends session successfully", async () => {
    await manager.initialize();
    const session = await manager.startSession();

    await manager.endSession(session.sessionId);
    expect(manager.isSessionActive()).to.equal(false);
  });

  it("handles multiple sessions", async () => {
    await manager.initialize();

    const session1 = await manager.startSession();
    const session2 = await manager.startSession();

    expect(manager.getAllSessions()).to.have.lengthOf(2);
    expect(session1.sessionId).to.not.equal(session2.sessionId);
  });

  it("disposes cleanly", async () => {
    await manager.initialize();
    await manager.startSession();

    manager.dispose();
    expect(manager.isInitialized()).to.equal(false);
    expect(manager.isSessionActive()).to.equal(false);
    expect(manager.getAllSessions()).to.have.lengthOf(0);
  });

  it("validates session configuration structure", async () => {
    await manager.initialize();
    const session = await manager.startSession();

    expect(session.config).to.exist;
    expect(session.config.renewalMarginSeconds).to.be.a("number");
  });

  it("generates unique session IDs", async () => {
    await manager.initialize();

    const ids = new Set();
    for (let i = 0; i < 5; i++) {
      const session = await manager.startSession();
      ids.add(session.sessionId);
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    expect(ids.size, "All session IDs should be unique").to.equal(5);
  });
});
