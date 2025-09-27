// Shim to ensure Mocha TDD-style globals are available in test environment
declare const global: any;

// Map TDD names to BDD equivalents if missing
if (typeof (global as any).suite === "undefined") {
  const mocha = require("mocha");
  // mocha provides describe/it/beforeEach/afterEach; map tdd names to them
  (global as any).suite = (global as any).describe;
  (global as any).setup = (global as any).beforeEach;
  (global as any).teardown = (global as any).afterEach;
  (global as any).test = (global as any).it;
}

export {};
