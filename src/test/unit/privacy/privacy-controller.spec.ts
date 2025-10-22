import { isPurgeCommand, PurgeReason } from '../../../types/privacy';
import { expect } from '../../helpers/chai-setup';
import { suite, test } from '../../mocha-globals';

describeExtendedPurgeReasons();

type ExtendedReason = Extract<
  PurgeReason,
  | 'retention-expired'
  | 'privacy-policy-change'
  | 'workspace-reset'
  | 'corruption-detected'
>;

function describeExtendedPurgeReasons() {
  suite('Unit: PrivacyController purge reasons', () => {
    const baseCommand = {
      type: 'privacy.purge' as const,
      target: 'transcripts' as const,
      issuedAt: new Date().toISOString(),
    };

    test('accepts extended purge reason literals', () => {
      const reasons: ExtendedReason[] = [
        'retention-expired',
        'privacy-policy-change',
        'workspace-reset',
        'corruption-detected',
      ];

      for (const reason of reasons) {
        expect(
          isPurgeCommand({ ...baseCommand, reason }),
          `Expected purge reason "${reason}" to be accepted`,
        ).to.equal(true);
      }
    });

    test('rejects unknown purge reason literals', () => {
      expect(
        isPurgeCommand({ ...baseCommand, reason: 'unsupported-reason' as PurgeReason }),
      ).to.equal(false);
    });
  });
}
