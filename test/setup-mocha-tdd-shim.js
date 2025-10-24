"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Map TDD names to BDD equivalents if missing
if (typeof global.suite === "undefined") {
    const mocha = require("mocha");
    // mocha provides describe/it/beforeEach/afterEach; map tdd names to them
    global.suite = global.describe;
    global.setup = global.beforeEach;
    global.teardown = global.afterEach;
    global.test = global.it;
}
//# sourceMappingURL=setup-mocha-tdd-shim.js.map