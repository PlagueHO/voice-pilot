import type { VoicePilotFaultDomain } from '../../types/error/error-taxonomy';
import type {
    RecoveryFallbackMode,
    RecoveryPlan,
    RecoveryRegistrar,
    RecoveryStep
} from '../../types/error/voice-pilot-error';

class DomainRecoveryRegistrar implements RecoveryRegistrar {
  private readonly steps: RecoveryStep[] = [];
  private readonly fallbacks = new Map<RecoveryFallbackMode, () => Promise<void>>();
  private notifyUser = true;
  private suppressionWindowMs?: number;

  constructor(private readonly domain: VoicePilotFaultDomain) {}

  addStep(step: RecoveryStep): void {
    this.steps.push(step);
  }

  addFallback(mode: RecoveryFallbackMode, handler: () => Promise<void>): void {
    if (!mode) {
      return;
    }
    this.fallbacks.set(mode, handler);
  }

  setNotification(options: { notifyUser?: boolean; suppressionWindowMs?: number }): void {
    if (typeof options.notifyUser === 'boolean') {
      this.notifyUser = options.notifyUser;
    }
    if (typeof options.suppressionWindowMs === 'number') {
      this.suppressionWindowMs = Math.max(0, options.suppressionWindowMs);
    }
  }

  toRecoveryPlan(defaults?: Partial<Omit<RecoveryPlan, 'steps'>>): RecoveryPlan {
    return {
      steps: [...this.steps],
      fallbackMode: defaults?.fallbackMode,
      notifyUser: defaults?.notifyUser ?? this.notifyUser,
      suppressionWindowMs: defaults?.suppressionWindowMs ?? this.suppressionWindowMs,
      fallbackHandlers: this.fallbacks.size
        ? Object.fromEntries(this.fallbacks.entries()) as RecoveryPlan['fallbackHandlers']
        : undefined
    };
  }

  getDomain(): VoicePilotFaultDomain {
    return this.domain;
  }
}

export class RecoveryRegistrationCenter {
  private readonly plans = new Map<VoicePilotFaultDomain, RecoveryPlan>();

  register(domain: VoicePilotFaultDomain, configure: (registrar: RecoveryRegistrar) => void, defaults?: Partial<Omit<RecoveryPlan, 'steps'>>): void {
    const registrar = new DomainRecoveryRegistrar(domain);
    configure(registrar);
    const plan = registrar.toRecoveryPlan(defaults);
    this.plans.set(domain, plan);
  }

  get(domain: VoicePilotFaultDomain): RecoveryPlan | undefined {
    return this.plans.get(domain);
  }

  clear(domain: VoicePilotFaultDomain): void {
    this.plans.delete(domain);
  }

  clearAll(): void {
    this.plans.clear();
  }
}

export function createDomainRegistrar(domain: VoicePilotFaultDomain): RecoveryRegistrar {
  return new DomainRecoveryRegistrar(domain);
}
