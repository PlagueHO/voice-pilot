---
title: Testing & QA Strategy for VoicePilot
version: 0.1.0
date_created: 2025-10-06
last_updated: 2025-10-06
owner: VoicePilot Project
tags: [process, testing, quality, vscode-extension]
---

<!-- markdownlint-disable-next-line MD025 -->
# Testing & QA Strategy for VoicePilot

## Introduction

This specification defines the end-to-end testing and quality assurance strategy for the VoicePilot VS Code extension. It prescribes the layered test architecture, automation workflow, coverage targets, and quality gates required to safeguard the extension lifecycle described in `sp-001-spec-architecture-extension-lifecycle.md`.

## 1. Purpose & Scope

The purpose of this specification is to standardize testing practices, tooling, and success criteria for VoicePilot. It covers unit, integration, end-to-end, performance, and regression testing across the extension host and supporting services. The intended audience includes extension developers, QA engineers, release managers, and CI/CD maintainers. Assumptions: contributors use the provided VS Code tasks, follow the dependency-injection architecture, and have access to the dev container toolchain (Node.js 22+, Mocha, `@vscode/test-electron`).

## 2. Definitions

- **CI**: Continuous Integration; automated pipelines triggered by commits or pull requests.
- **DI**: Dependency Injection; service orchestration pattern used by VoicePilot controllers.
- **E2E Test**: End-to-end test executed against a packaged extension in a VS Code instance.
- **Fixture Workspace**: Minimal project folder provisioned for integration and E2E tests.
- **Gate Task**: A VS Code task that must succeed before code can merge.
- **Layered Test Stack**: Ordered execution of unit → integration → E2E → performance → coverage tasks.
- **Mock Extension Context**: Stubbed `vscode.ExtensionContext` used by Node-only tests.
- **Quality Gate**: Mandatory condition (e.g., coverage threshold, lint result) enforced before release.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: The project SHALL maintain a layered test suite comprising unit, integration, and end-to-end coverage aligned with the activation lifecycle (Configuration → Authentication → Session → UI).
- **REQ-002**: Every pull request SHALL execute the Gate Task sequence: `Lint Extension`, `Test Unit`, `Test Extension`, `Test All`, and `Test Coverage`.
- **REQ-003**: The test suite SHALL achieve ≥ 90% statement coverage for activation, command registration, and disposal paths.
- **REQ-004**: Test suites SHALL run within isolated fixture workspaces that mirror supported VS Code versions.
- **SEC-001**: Test artefacts SHALL redact or obfuscate secrets, tokens, and personal data prior to persistence or log export.
- **SEC-002**: Mock services SHALL enforce the same authentication guards defined in production services to prevent bypassing security checks.
- **QAS-001**: Integration and E2E tests SHALL assert that service initialization order matches PAT-001 and emits expected telemetry.
- **QAS-002**: Regression tests SHALL capture failures related to activation budget overruns (>5 seconds) and resource leaks.
- **CON-001**: Combined Gate Task execution time MUST NOT exceed 15 minutes on the reference CI runner (4 vCPU, 8 GiB RAM).
- **CON-002**: Tests MUST avoid network calls to live Azure resources unless explicitly marked as `[requiresAzure]` and skipped by default.
- **GUD-001**: Contributors SHOULD use VS Code tasks instead of direct npm scripts to ensure consistent tooling.
- **GUD-002**: Tests SHOULD use deterministic virtual timers or controllable clocks; real timeouts > 250 ms are discouraged.
- **PAT-001**: Test execution order MUST follow Unit → Integration → Extension Host (E2E) → Performance → Coverage.
- **PAT-002**: Fixtures MUST register all disposables in `afterEach` hooks to mimic the extension teardown contract.

## 4. Interfaces & Data Contracts

| Interface | Type | Description |
|-----------|------|-------------|
| `npm run test:unit` (`Test Unit` task) | VS Code task | Executes Mocha tests against compiled Node-only specs using stubbed `vscode` APIs. |
| `npm test` (`Test Extension` task) | VS Code task | Launches `@vscode/test-electron` to validate activation, command registration, and UI wiring in a real extension host. |
| `npm run test:all` (`Test All` task) | VS Code task | Runs Unit then Integration suites sequentially; fails fast on first error. |
| `npm run test:coverage` (`Test Coverage` task) | VS Code task | Produces NYC coverage artefacts (`coverage/` directory) for reporting and gating. |
| Quality Gate Report | JSON | Aggregated task outcomes published to CI; see schema below. |
| VS Code Task Telemetry | Event stream | Emits `{ taskId, outcome, duration }` metrics consumed by observability tooling defined in SP-028. |

```json
{
  "task": "string",
  "status": "pass" | "fail",
  "durationMs": 0,
  "coverage": {
    "statements": 0,
    "branches": 0
  }
}
```

## 5. Acceptance Criteria

- **AC-001**: Given a pull request, When the Gate Task sequence runs, Then all required tasks complete successfully within the defined runtime constraint.
- **AC-002**: Given the extension is activated in integration tests, When services initialize, Then telemetry confirms the Configuration → Authentication → Session → UI order.
- **AC-003**: Given coverage reports are generated, When reviewing activation and disposal code paths, Then statement coverage is ≥ 90%.
- **AC-004**: Given an integration test simulating activation failure, When cleanup executes, Then no undisposed resources remain and logs contain the expected error taxonomy (per SP-028).
- **AC-005**: Given Azure-dependent tests, When the `requiresAzure` tag is absent or Azure credentials are not configured, Then those tests are skipped with explanatory output.

## 6. Test Automation Strategy

- **Test Levels**: Unit (Node-only, stubbed `vscode`), Integration (Extension Host via `@vscode/test-electron`), End-to-End (interactive flows including webview messaging), Performance (latency probes), Regression (activation failure and recovery scenarios).
- **Frameworks**: Mocha, Chai, Sinon, `@vscode/test-electron`, NYC for coverage, ts-node for dynamic fixtures.
- **Test Data Management**: Use immutable fixture workspaces under `src/test/fixtures`; generate transient credentials via mock services; clean temporary files upon suite completion.
- **CI/CD Integration**: GitHub Actions pipeline triggers Gate Task sequence on push and pull request events; publish coverage to `coverage/` artefacts; notify via status checks.
- **Coverage Requirements**: ≥ 90% statements for activation lifecycle modules, ≥ 85% branches for error handling, ≥ 80% overall project average.
- **Performance Testing**: `npm run test:perf` measures activation latency, audio pipeline warm-up, and telemetry emission intervals; regressions >10% require investigation.

## 7. Rationale & Context

VoicePilot depends on deterministic service orchestration; testing must verify lifecycle contracts to prevent regressions that violate SP-001. Layered testing reduces feedback loops, while performance and regression suites protect the five-second activation budget and resource hygiene. Enforcing VS Code tasks ensures consistent developer workflows inside the dev container and CI environments.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: GitHub Actions – orchestrates CI quality gates and publishes artefacts.

### Third-Party Services

- **SVC-001**: Azure OpenAI test tenants – optional for `[requiresAzure]` suites; must support token issuance via Ephemeral Key Service (SP-004).

### Infrastructure Dependencies

- **INF-001**: Dev container with Node.js 22+, Mocha, `@vscode/test-electron`, and NYC installed.
- **INF-002**: VS Code tasks (`tasks.json`) defining Gate Tasks and performance probes.

### Data Dependencies

- **DAT-001**: Fixture workspaces stored under `src/test/fixtures` containing synthetic documents and settings.

### Technology Platform Dependencies

- **PLT-001**: VS Code 1.104+ for extension host compatibility and modern API usage.
- **PLT-002**: TypeScript 5.x compiler output targeting ES2022 per repository guidelines.

### Compliance Dependencies

- **COM-001**: Privacy & data handling policy (SP-027) to ensure test logs comply with redaction rules.

## 9. Examples & Edge Cases

```ts
// Example: integration test ensuring initialization order and disposal hygiene
import { expect } from 'chai';
import { activateExtensionForTest, getTelemetryEvents } from '../helpers/extension-under-test';

suite('Extension Lifecycle', () => {
  test('initialization order', async function () {
    this.timeout(5000);
    const controller = await activateExtensionForTest();
    const events = getTelemetryEvents();

    expect(events.map(e => e.name)).to.deep.equal([
      'config.initialized',
      'auth.initialized',
      'session.initialized',
      'ui.initialized'
    ]);

    await controller.dispose();
    expect(controller.isInitialized()).to.be.false;
  });
});
```

Edge cases include activation cancellation during VS Code shutdown, Azure credential absence, and simulated network partitions for WebRTC flows; tests must assert graceful degradation and cleanup for each scenario.

## 10. Validation Criteria

- Gate Task logs confirm sequential execution with pass status and runtime < 15 minutes.
- Coverage reports show thresholds met or exceeded; failures block merges.
- Regression suite emits structured errors matching SP-028 taxonomy when faults are injected.
- Performance probe reports activation latency ≤ 5 seconds at p95.
- Azure-dependent tests are tagged and skip gracefully without credentials.

## 11. Related Specifications / Further Reading

- [sp-001-spec-architecture-extension-lifecycle.md](./sp-001-spec-architecture-extension-lifecycle.md)
- [sp-002-spec-design-configuration-management.md](./sp-002-spec-design-configuration-management.md)
- [sp-028-spec-architecture-error-handling.md](./sp-028-spec-architecture-error-handling.md)
- [docs/design/FEATURE-PLAN.md](../docs/design/FEATURE-PLAN.md)
