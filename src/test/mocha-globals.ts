import type { HookFunction, SuiteFunction, TestFunction } from "mocha";

type MochaGlobal = typeof globalThis & {
  describe?: SuiteFunction;
  it?: TestFunction;
  before?: HookFunction;
  after?: HookFunction;
  beforeEach?: HookFunction;
  afterEach?: HookFunction;
  suite?: SuiteFunction;
  test?: TestFunction;
  suiteSetup?: HookFunction;
  suiteTeardown?: HookFunction;
  setup?: HookFunction;
  teardown?: HookFunction;
};

const mochaGlobal = globalThis as MochaGlobal;

function expectFunction<T extends (...args: any[]) => any>(
  candidate: T | undefined,
  name: string,
): T {
  if (typeof candidate !== "function") {
    throw new Error(
      `Mocha global "${name}" is not initialised. Ensure tests run via @vscode/test-cli with the BDD UI.`,
    );
  }

  return candidate;
}

export const describe: SuiteFunction = expectFunction(
  mochaGlobal.describe,
  "describe",
);
export const it: TestFunction = expectFunction(mochaGlobal.it, "it");
export const before: HookFunction = expectFunction(
  mochaGlobal.before,
  "before",
);
export const after: HookFunction = expectFunction(mochaGlobal.after, "after");
export const beforeEach: HookFunction = expectFunction(
  mochaGlobal.beforeEach,
  "beforeEach",
);
export const afterEach: HookFunction = expectFunction(
  mochaGlobal.afterEach,
  "afterEach",
);

export const suite: SuiteFunction = mochaGlobal.suite ?? describe;
export const test: TestFunction = mochaGlobal.test ?? it;
export const suiteSetup: HookFunction = mochaGlobal.suiteSetup ?? before;
export const suiteTeardown: HookFunction = mochaGlobal.suiteTeardown ?? after;
export const setup: HookFunction = mochaGlobal.setup ?? beforeEach;
export const teardown: HookFunction = mochaGlobal.teardown ?? afterEach;

export const bdd = {
  describe,
  it,
  before,
  after,
  beforeEach,
  afterEach,
};

export const tdd = {
  suite,
  test,
  suiteSetup,
  suiteTeardown,
  setup,
  teardown,
};
