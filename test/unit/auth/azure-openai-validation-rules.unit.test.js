"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const azure_openai_validation_rules_1 = require("../../src/../auth/validators/azure/azure-openai-validation-rules");
const validation_error_codes_1 = require("../../src/../auth/validators/validation-error-codes");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
(0, mocha_globals_1.suite)('Unit: AzureOpenAIValidationRules', () => {
    (0, mocha_globals_1.test)('returns format error when key is empty', () => {
        const result = azure_openai_validation_rules_1.AzureOpenAIValidationRules.validateFormat('');
        (0, chai_setup_1.expect)(result).to.have.length(1);
        (0, chai_setup_1.expect)(result[0].code).to.equal(validation_error_codes_1.ValidationErrorCodes.INVALID_KEY_FORMAT);
    });
    (0, mocha_globals_1.test)('enforces minimum length when key is shorter than required', () => {
        const shortKey = 'a'.repeat(azure_openai_validation_rules_1.AzureOpenAIValidationRules.MIN_LENGTH - 10);
        const result = azure_openai_validation_rules_1.AzureOpenAIValidationRules.validateFormat(shortKey);
        const codes = result.map((entry) => entry.code);
        (0, chai_setup_1.expect)(codes).to.include(validation_error_codes_1.ValidationErrorCodes.INVALID_KEY_LENGTH);
        (0, chai_setup_1.expect)(codes).to.not.include(validation_error_codes_1.ValidationErrorCodes.INVALID_KEY_CHARACTERS);
    });
    (0, mocha_globals_1.test)('flags invalid characters even when length requirement passes', () => {
        const invalidCharKey = `${'a'.repeat(azure_openai_validation_rules_1.AzureOpenAIValidationRules.MIN_LENGTH - 1)}g`;
        const result = azure_openai_validation_rules_1.AzureOpenAIValidationRules.validateFormat(invalidCharKey);
        (0, chai_setup_1.expect)(result).to.have.length(1);
        (0, chai_setup_1.expect)(result[0].code).to.equal(validation_error_codes_1.ValidationErrorCodes.INVALID_KEY_CHARACTERS);
    });
    (0, mocha_globals_1.test)('collects multiple errors when key is short and contains invalid characters', () => {
        const malformedKey = 'short-key!';
        const result = azure_openai_validation_rules_1.AzureOpenAIValidationRules.validateFormat(malformedKey);
        const codes = result.map((entry) => entry.code);
        (0, chai_setup_1.expect)(codes).to.include(validation_error_codes_1.ValidationErrorCodes.INVALID_KEY_LENGTH);
        (0, chai_setup_1.expect)(codes).to.include(validation_error_codes_1.ValidationErrorCodes.INVALID_KEY_CHARACTERS);
    });
    (0, mocha_globals_1.test)('returns no errors for a valid hexadecimal key with minimum length', () => {
        const validKey = 'a'.repeat(azure_openai_validation_rules_1.AzureOpenAIValidationRules.MIN_LENGTH);
        const result = azure_openai_validation_rules_1.AzureOpenAIValidationRules.validateFormat(validKey);
        (0, chai_setup_1.expect)(result).to.be.empty;
    });
});
//# sourceMappingURL=azure-openai-validation-rules.unit.test.js.map