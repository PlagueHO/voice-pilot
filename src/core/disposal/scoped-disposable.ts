import { DisposalReason, ScopedDisposable } from "../../types/disposal";

type DisposeHandler = (reason: DisposalReason) => Promise<void> | void;
type IsDisposedHandler = () => boolean;

export interface DisposableScopeOptions {
  id: string;
  priority: number;
  dispose: DisposeHandler;
  isDisposed: IsDisposedHandler;
}

export class DisposableScope implements ScopedDisposable {
  private disposed = false;

  constructor(private readonly options: DisposableScopeOptions) {}

  get id(): string {
    return this.options.id;
  }

  get priority(): number {
    return this.options.priority;
  }

  async dispose(reason: DisposalReason): Promise<void> {
    if (this.disposed) {
      return;
    }
    await this.options.dispose(reason);
    this.disposed = this.options.isDisposed();
  }

  isDisposed(): boolean {
    return this.disposed || this.options.isDisposed();
  }
}

export function createServiceScope(
  id: string,
  priority: number,
  service: {
    dispose(): void;
    isInitialized?: () => boolean;
  },
): DisposableScope {
  return new DisposableScope({
    id,
    priority,
    dispose: () => service.dispose(),
    isDisposed: () => !(service.isInitialized?.() ?? false),
  });
}
