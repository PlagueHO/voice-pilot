import { Logger } from '../../core/logger';
import { ConfigurationAccessors, ValidationError, ValidationResult, ValidationWarning } from '../../types/configuration';
import { allRules, RuleContext } from './validation-rules';

export class ConfigurationValidator {
  constructor(private readonly logger: Logger, private readonly access: ConfigurationAccessors) {}

  async validateAll(): Promise<ValidationResult> {
    const ctx: RuleContext = {
      azureOpenAI: this.access.getAzureOpenAI(),
      azureRealtime: this.access.getAzureRealtime(),
      audio: this.access.getAudio(),
      audioFeedback: this.access.getAudioFeedback(),
      commands: this.access.getCommands(),
      github: this.access.getGitHub(),
      conversation: this.access.getConversation(),
      privacy: this.access.getPrivacyPolicy()
    };
    const errors: ValidationError[] = []; const warnings: ValidationWarning[] = [];
    for (const rule of allRules) {
      try {
        const res = await rule(ctx);
        errors.push(...res.errors);
        warnings.push(...res.warnings);
      } catch (err: any) {
        this.logger.error('Validation rule failed', { rule: rule.name, error: err?.message || err });
        errors.push({ path: '*', message: 'Internal validation error', code: 'INTERNAL_VALIDATION_ERROR', severity: 'error' });
      }
    }
    return { isValid: errors.length === 0, errors, warnings };
  }
}
