---
goal: Add Chai + chai-as-promised to test harness for expressive and promise-aware assertions
version: 1.0
date_created: 2025-10-10
last_updated: 2025-10-10
owner: Agent Voice Team
status: 'Completed'
tags: [feature, testing, chai, chai-as-promised]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

This plan describes the deterministic, step-by-step addition of `chai` and `chai-as-promised` to the Agent Voice test toolchain and documentation. The goal is to provide a safer, incremental adoption path for expressive BDD-style assertions and Promise-handling utilities without breaking existing Mocha-based tests.

## 1. Requirements & Constraints

- **REQ-001**: Add `chai` as a dev dependency for test assertions.
- **REQ-002**: Add `chai-as-promised` as a dev dependency for Promise assertions.
- **REQ-003**: Add TypeScript types `@types/chai` and `@types/chai-as-promised` as dev dependencies for compile-time checks.
- **REQ-004**: Do not change existing test files; new imports must be opt-in.
- **SEC-001**: Do not enable Chai's `should` style globally to avoid prototype pollution.
- **CON-001**: The repo targets TypeScript 5 and Node.js 22; packages must be compatible with these versions.
- **GUD-001**: Prefer `expect` style for new/converted tests and add a shared test helper for `chai-as-promised` setup.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Add dependencies and add test helper file.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add `chai`, `chai-as-promised`, `@types/chai`, `@types/chai-as-promised` to devDependencies in `package.json` and run an `npm ci` or `npm install` to update lockfile. | ✅ | 2025-10-10 |
| TASK-002 | Create `test/helpers/chai-setup.ts` with the following content: | | |

|      | ```ts
|      | import chai from "chai"; | | |
|      | import chaiAsPromised from "chai-as-promised"; | | |
|      | chai.use(chaiAsPromised); | | |
|      | export const expect = chai.expect; | | |
|      | ```ts | | |
| TASK-003 | Add a brief note to `README.md` or `AGENTS.md` test guidance referencing `chai` and `chai-as-promised` with installation command examples. | ✅ | 2025-10-10 |

### Implementation Phase 2

- GOAL-002: Convert one sample unit test to use `expect` + `chai-as-promised` to validate the approach.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Identify a small, fast unit test `test/unit/<example>.unit.test.ts` and convert it to import from `test/helpers/chai-setup` and use `expect`/`eventually`. | ✅ | 2025-10-10 |
| TASK-005 | Run `npm run compile` and `npm run test:unit` to validate compilation and unit tests pass. | ✅ | 2025-10-10 |
| TASK-006 | Update `AGENTS.md` and `docs/QUICKSTART.md` to document the new dev dependency and recommended style. | ✅ | 2025-10-10 |

## 3. Alternatives

- **ALT-001**: Continue using Node's `assert` only — avoids adding dependencies but lacks syntactic sugar and `chai-as-promised`'s helpers.
- **ALT-002**: Use `expect` from other assertion libraries (e.g., `unexpected`, `vitest`) — rejected due to higher migration cost and misalignment with Mocha + NYC + VS Code test harness.

## 4. Dependencies

- **DEP-001**: Node.js >= 22.12.0
- **DEP-002**: Mocha test runner as configured (no changes required)
- **DEP-003**: TypeScript compiler and `@types/*` packages for dev-time types

## 5. Files

- **FILE-001**: `package.json` — add dev dependency entries
- **FILE-002**: `test/helpers/chai-setup.ts` — new helper to configure `chai-as-promised`
- **FILE-003**: `AGENTS.md` — update testing guidance (already updated)
- **FILE-004**: `docs/QUICKSTART.md` — add optional note for developers to use `chai` in tests

## 6. Testing

- **TEST-001**: Compile TypeScript (`npm run compile`) and ensure no type errors introduced by new types.
- **TEST-002**: Run unit tests (`npm run test:unit`) to confirm no regressions.
- **TEST-003**: Run full quality gate locally (`VS_CODE_CHANNEL=stable node scripts/run-quality-gate.mjs`) to ensure CI parity.

## 7. Risks & Assumptions

- **RISK-001**: Global `should` style is accidentally enabled, causing prototype extensions; mitigate by documenting `expect` preference and not calling `chai.should()`.
- **ASSUMPTION-001**: Adding `@types` will not cause typing collisions in the main compile due to test-only inclusions; if collisions occur, tests server can use an isolated `tsconfig.test.json` to include types only in test compilation.

## 8. Related Specifications / Further Reading

[Agent Voice Continuous Integration Pipeline](docs/CI-PIPELINE.md)
[Mocha documentation](https://mochajs.org/)
[Chai documentation](https://www.chaijs.com/)
[chai-as-promised documentation](https://www.chaijs.com/plugins/chai-as-promised/)
