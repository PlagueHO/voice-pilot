import { expect } from "chai";
import { RuleIntentClassifier } from "../../../src/intent/classifiers/rule-intent-classifier";
import type { IntentContext, IntentPack } from "../../../src/intent/intent-processor";
import { afterEach, before, suite, test } from "../../../test/mocha-globals";

suite("Unit: RuleIntentClassifier", () => {
  let classifier: RuleIntentClassifier;
  let testContext: IntentContext;

  before(() => {
    classifier = new RuleIntentClassifier();

    // Register test intent pack
    const testPack: IntentPack = {
      id: "test.pack",
      name: "Test Pack",
      version: "1.0.0",
      description: "Test intent pack",
      locale: "en-US",
      intents: [
        {
          id: "command.editor.format",
          category: "command",
          subcategory: "editor",
          action: "format",
          patterns: [
            { type: "keywords", value: "format document" },
            { type: "regex", value: "^format( the)?( current)?( file| document)$" },
          ],
          requiredEntities: [],
          optionalEntities: [],
          confirmationRequired: false,
          priority: 10,
        },
      ],
      entities: [],
      examples: [],
    };

    classifier.registerIntentPack(testPack);

    testContext = {
      sessionId: "test-session",
      conversationState: {
        state: "idle",
        metadata: {},
      },
      turnContext: {
        turnId: "turn-1",
        turnRole: "user",
        since: new Date().toISOString(),
        interruptions: 0,
        metadata: {},
      },
      intentHistory: [],
    };
  });

  afterEach(() => {
    // Reset any mutable state if needed
  });

  test("should classify known command with high confidence", async () => {
    const result = await classifier.classify("format document", testContext);

    expect(result.intentId).to.equal("command.editor.format");
    expect(result.category).to.equal("command");
    expect(result.confidence).to.be.greaterThan(0.8);
  });

  test("should return unknown intent for unrecognized transcript", async () => {
    const result = await classifier.classify("unknown utterance", testContext);

    expect(result.category).to.equal("unknown");
    expect(result.confidence).to.equal(0.0);
  });

  test("should normalize transcript before matching", async () => {
    const result = await classifier.classify("FORMAT DOCUMENT", testContext);

    expect(result.intentId).to.equal("command.editor.format");
    expect(result.confidence).to.be.greaterThan(0.8);
  });

  test("should match regex patterns", async () => {
    const result = await classifier.classify("format the file", testContext);

    expect(result.intentId).to.equal("command.editor.format");
    expect(result.confidence).to.be.greaterThan(0.8);
  });

  test("should include processing metadata", async () => {
    const result = await classifier.classify("format document", testContext);

    expect(result.metadata.classifierType).to.equal("rule-based");
    expect(result.metadata.processingTimeMs).to.be.greaterThan(0);
    expect(result.metadata.normalizationApplied).to.include("lowercase");
  });
});
