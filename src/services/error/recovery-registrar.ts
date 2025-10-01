import type { VoicePilotFaultDomain } from '../../types/error/error-taxonomy';
import type {
  RecoveryFallbackMode,
  RecoveryPlan,
  RecoveryRegistrar,
  RecoveryStep
} from '../../types/error/voice-pilot-error';

/**
 * Maintains the recovery plan definition for a specific fault domain, capturing
 * recovery steps, fallback handlers, and notification preferences prior to
 * materializing a {@link RecoveryPlan} instance.
 */
class DomainRecoveryRegistrar implements RecoveryRegistrar {
  private readonly steps: RecoveryStep[] = [];
  private readonly fallbacks = new Map<RecoveryFallbackMode, () => Promise<void>>();
  private notifyUser = true;
  private suppressionWindowMs?: number;

  /**
   * Creates a registrar scoped to the supplied fault domain.
   *
   * @param domain - Fault domain the registrar operates on.
   */
  constructor(private readonly domain: VoicePilotFaultDomain) {}

  /**
   * Appends a recovery step that will be executed as part of the finalized
   * recovery plan.
   *
   * @param step - Structured recovery step descriptor.
   */
  addStep(step: RecoveryStep): void {
    this.steps.push(step);
  }

  /**
   * Registers a fallback handler for the provided fallback mode, invoked when
   * the primary recovery sequence cannot be completed.
   *
   * @param mode - Fallback mode being configured.
   * @param handler - Asynchronous handler to execute for the fallback.
   */
  addFallback(mode: RecoveryFallbackMode, handler: () => Promise<void>): void {
    if (!mode) {
      return;
    }
    this.fallbacks.set(mode, handler);
  }

  /**
   * Overrides notification behavior and optional suppression window applied to
   * the generated recovery plan.
   *
   * @param options - Notification configuration overrides.
   */
  setNotification(options: { notifyUser?: boolean; suppressionWindowMs?: number }): void {
    if (typeof options.notifyUser === 'boolean') {
      this.notifyUser = options.notifyUser;
    }
    if (typeof options.suppressionWindowMs === 'number') {
      this.suppressionWindowMs = Math.max(0, options.suppressionWindowMs);
    }
  }

  /**
   * Produces an immutable recovery plan using the accumulated steps and
   * fallbacks, optionally merging in default attributes.
   *
   * @param defaults - Optional defaults to merge into the plan output.
   * @returns Recovery plan ready for execution.
   */
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

  /**
   * Reports the fault domain used to construct this registrar.
   *
   * @returns Fault domain identifier.
   */
  getDomain(): VoicePilotFaultDomain {
    return this.domain;
  }
}

/**
 * Repository of recovery plans organized by fault domain, allowing the
 * extension to retrieve and manage recovery strategies during runtime.
 */
export class RecoveryRegistrationCenter {
  private readonly plans = new Map<VoicePilotFaultDomain, RecoveryPlan>();

  /**
   * Registers a recovery plan for the supplied fault domain by delegating the
   * configuration to the provided registrar callback.
   *
   * @param domain - Fault domain to associate with the recovery plan.
   * @param configure - Callback that receives a registrar for plan setup.
   * @param defaults - Optional defaults merged into the resulting plan.
   */
  register(domain: VoicePilotFaultDomain, configure: (registrar: RecoveryRegistrar) => void, defaults?: Partial<Omit<RecoveryPlan, 'steps'>>): void {
    const registrar = new DomainRecoveryRegistrar(domain);
    configure(registrar);
    const plan = registrar.toRecoveryPlan(defaults);
    this.plans.set(domain, plan);
  }

  /**
   * Retrieves the recovery plan associated with the specified fault domain.
   *
   * @param domain - Fault domain whose plan should be returned.
   * @returns Matching recovery plan, or undefined if not registered.
   */
  get(domain: VoicePilotFaultDomain): RecoveryPlan | undefined {
    return this.plans.get(domain);
  }

  /**
   * Removes the recovery plan assigned to the specified fault domain.
   *
   * @param domain - Fault domain whose plan should be cleared.
   */
  clear(domain: VoicePilotFaultDomain): void {
    this.plans.delete(domain);
  }

  /**
   * Removes all registered recovery plans across every fault domain.
   */
  clearAll(): void {
    this.plans.clear();
  }
}

/**
 * Convenience factory producing a domain-scoped recovery registrar so callers
 * can configure a recovery plan without interacting with the registration
 * center.
 *
 * @param domain - Fault domain to bind to the registrar.
 * @returns Configurable recovery registrar for the provided domain.
 */
export function createDomainRegistrar(domain: VoicePilotFaultDomain): RecoveryRegistrar {
  return new DomainRecoveryRegistrar(domain);
}
