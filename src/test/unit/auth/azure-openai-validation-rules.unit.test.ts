import { AzureOpenAIValidationRules } from '../../../auth/validators/azure/azure-openai-validation-rules';
import { ValidationErrorCodes } from '../../../auth/validators/validation-error-codes';
import { expect } from '../../helpers/chai-setup';
import { suite, test } from '../../mocha-globals';

suite('Unit: AzureOpenAIValidationRules', () => {
  test('returns format error when key is empty', () => {
    const result = AzureOpenAIValidationRules.validateFormat('');

    expect(result).to.have.length(1);
    expect(result[0].code).to.equal(ValidationErrorCodes.INVALID_KEY_FORMAT);
  });

  test('enforces minimum length when key is shorter than required', () => {
    const shortKey = 'a'.repeat(AzureOpenAIValidationRules.MIN_LENGTH - 10);

    const result = AzureOpenAIValidationRules.validateFormat(shortKey);

    const codes = result.map((entry) => entry.code);
    expect(codes).to.include(ValidationErrorCodes.INVALID_KEY_LENGTH);
    expect(codes).to.not.include(ValidationErrorCodes.INVALID_KEY_CHARACTERS);
  });

  test('flags invalid characters even when length requirement passes', () => {
    const invalidCharKey = `${'a'.repeat(AzureOpenAIValidationRules.MIN_LENGTH - 1)}g`;

    const result = AzureOpenAIValidationRules.validateFormat(invalidCharKey);

    expect(result).to.have.length(1);
    expect(result[0].code).to.equal(ValidationErrorCodes.INVALID_KEY_CHARACTERS);
  });

  test('collects multiple errors when key is short and contains invalid characters', () => {
    const malformedKey = 'short-key!';

    const result = AzureOpenAIValidationRules.validateFormat(malformedKey);

    const codes = result.map((entry) => entry.code);
    expect(codes).to.include(ValidationErrorCodes.INVALID_KEY_LENGTH);
    expect(codes).to.include(ValidationErrorCodes.INVALID_KEY_CHARACTERS);
  });

  test('returns no errors for a valid hexadecimal key with minimum length', () => {
    const validKey = 'a'.repeat(AzureOpenAIValidationRules.MIN_LENGTH);

    const result = AzureOpenAIValidationRules.validateFormat(validKey);

    expect(result).to.be.empty;
  });
});
