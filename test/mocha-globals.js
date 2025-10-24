"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tdd = exports.bdd = exports.teardown = exports.setup = exports.suiteTeardown = exports.suiteSetup = exports.test = exports.suite = exports.afterEach = exports.beforeEach = exports.after = exports.before = exports.it = exports.describe = void 0;
const mochaGlobal = globalThis;
function expectFunction(candidate, name) {
    if (typeof candidate !== "function") {
        throw new Error(`Mocha global "${name}" is not initialised. Ensure tests run via @vscode/test-cli with the BDD UI.`);
    }
    return candidate;
}
exports.describe = expectFunction(mochaGlobal.describe, "describe");
exports.it = expectFunction(mochaGlobal.it, "it");
exports.before = expectFunction(mochaGlobal.before, "before");
exports.after = expectFunction(mochaGlobal.after, "after");
exports.beforeEach = expectFunction(mochaGlobal.beforeEach, "beforeEach");
exports.afterEach = expectFunction(mochaGlobal.afterEach, "afterEach");
exports.suite = mochaGlobal.suite ?? exports.describe;
exports.test = mochaGlobal.test ?? exports.it;
exports.suiteSetup = mochaGlobal.suiteSetup ?? exports.before;
exports.suiteTeardown = mochaGlobal.suiteTeardown ?? exports.after;
exports.setup = mochaGlobal.setup ?? exports.beforeEach;
exports.teardown = mochaGlobal.teardown ?? exports.afterEach;
exports.bdd = {
    describe: exports.describe,
    it: exports.it,
    before: exports.before,
    after: exports.after,
    beforeEach: exports.beforeEach,
    afterEach: exports.afterEach,
};
exports.tdd = {
    suite: exports.suite,
    test: exports.test,
    suiteSetup: exports.suiteSetup,
    suiteTeardown: exports.suiteTeardown,
    setup: exports.setup,
    teardown: exports.teardown,
};
//# sourceMappingURL=mocha-globals.js.map