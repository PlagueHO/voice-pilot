import {
  isPresenceStateEqual,
  normalizePresenceState,
  PRESENCE_BATCH_WINDOW_MS,
  PresenceUpdate,
  resolvePresenceDescriptor,
  VoicePilotPresenceState,
} from '../../../types/presence';
import { expect } from '../../helpers/chai-setup';
import { suite, test } from '../../mocha-globals';

const detailsBase = {
  retry: false,
  renewal: false,
};

suite('Unit: presence state helpers', () => {
  test('normalizePresenceState maps interrupted to listening and preserves other states', () => {
    const canonical = normalizePresenceState('interrupted');
    expect(canonical).to.equal('listening');

    const states: VoicePilotPresenceState[] = [
      'idle',
      'listening',
      'processing',
      'waitingForCopilot',
      'speaking',
      'suspended',
      'error',
      'offline',
    ];

    for (const state of states) {
      expect(normalizePresenceState(state)).to.equal(state);
    }
  });

  test('resolvePresenceDescriptor returns canonical descriptor for interrupted state', () => {
    const descriptor = resolvePresenceDescriptor('interrupted');

    expect(descriptor.state).to.equal('listening');
    expect(descriptor.message).to.equal('● Listening');
    expect(descriptor.defaultDetails).to.deep.equal({ retry: false, renewal: false });
  });

  test('isPresenceStateEqual returns true only when state, message, availability, and details match', () => {
    const base: PresenceUpdate = {
      state: 'processing',
      sessionId: 'session',
      since: new Date().toISOString(),
      copilotAvailable: true,
      latencyMs: 25,
      message: '⋯ Thinking',
      details: { ...detailsBase },
    };

    const same: PresenceUpdate = {
      ...base,
      details: { ...base.details },
    };

    expect(isPresenceStateEqual(base, same)).to.equal(true);

    const differentDetails: PresenceUpdate = {
      ...base,
      details: { retry: true, renewal: false },
    };
    expect(isPresenceStateEqual(base, differentDetails)).to.equal(false);

    const differentMessage: PresenceUpdate = {
      ...base,
      message: 'different',
    };
    expect(isPresenceStateEqual(base, differentMessage)).to.equal(false);

    const missing: PresenceUpdate | undefined = undefined;
    expect(isPresenceStateEqual(base, missing)).to.equal(false);
  });

  test('presence batch window constant remains within debounce threshold', () => {
    expect(PRESENCE_BATCH_WINDOW_MS).to.be.greaterThan(0);
    expect(PRESENCE_BATCH_WINDOW_MS).to.be.at.most(100);
  });
});
