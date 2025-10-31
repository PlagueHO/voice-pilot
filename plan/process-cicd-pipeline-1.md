---
goal: Establish Agent Voice CI/CD workflows and quality gates per SP-040
version: 1.0
date_created: 2025-10-08
last_updated: 2025-10-08
owner: Agent Voice Engineering Productivity
status: 'Planned'
tags: [process, cicd, automation, testing, azure]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This implementation plan defines the deterministic steps required to realize the CI/CD workflow architecture described in `spec/sp-040-spec-process-cicd-pipeline.md`, ensuring alignment with repository components and the technical references catalog.

> **Environment Model Update (2025-10-08):** `continuous-delivery.yml` now supports two target environments. Commits on `main` without a semantic version tag deploy to **testing**, provisioning ephemeral Azure infrastructure for validation. Tagged releases (`v*.*.*`) deploy to **production**, publishing the VSIX package without provisioning Azure resources (customers supply their own `azd` infrastructure).

## 1. Requirements & Constraints

- **REQ-001**: Implement the chained workflow topology (`continuous-delivery.yml` → `validate-infrastructure.yml` → `provision-infrastructure.yml` / `delete-infrastructure.yml`) with `workflow_call` triggers.
- **REQ-002**: Execute Gate Tasks (`Lint Extension`, `Test Unit`, `Test Extension`, `Test All`, `Test Coverage`, `Test Performance`) sequentially with fail-fast behavior and total runtime ≤ 15 minutes per SP-039.
- **REQ-003**: Publish build artifacts (VSIX, coverage, quality-gate.json) with retention ≥ 14 days.
- **REQ-004**: Enforce Azure OIDC authentication scoped to supplied `principalId`, without static secrets, and wire telemetry into Log Analytics.
- **REQ-005**: Provide automated rollback pathways (`azd down`, VSIX rollback) triggered on deployment verification failure.
- **REQ-006**: Route untagged `main` branch commits to the testing environment (including Azure provisioning) and restrict production deployments to tagged releases that publish the VSIX without provisioning Azure infrastructure.
- **SEC-001**: Redact secrets in logs, require SARIF uploads for security scans, and restrict Azure role assignments to defined scopes.
- **CON-001**: Use only repository-defined npm scripts and VS Code tasks; no ad-hoc shell commands.
- **CON-002**: Production deployments must originate from tagged releases on `main` and require environment approvals.
- **GUD-001**: Capture deployment parameters (environment, resource tokens, retention flags) as workflow outputs for telemetry correlation.
- **PAT-001**: Apply blue/green release retention of the previous VSIX artifact until post-deploy verification completes.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Scaffold reusable GitHub Actions workflows with deterministic triggers and shared inputs.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `.github/workflows/continuous-integration.yml` with `pull_request` and feature `push` triggers executing `npm run lint`, `npm run test:unit`, `npm test`, `npm run test:all`, `npm run test:coverage`, and `npm run test:perf` in fail-fast order using `jobs.<job>.needs` chaining. |  |  |
| TASK-002 | Define `.github/workflows/continuous-delivery.yml` with dual triggers: semantic version tags on `main` for production (VSIX publish only) and non-tag commits for testing (full validation). It must surface `workflow_dispatch` inputs (`environment`, `change_ticket`, optional `retain_resources`) and call `validate-infrastructure.yml` only for testing runs. | ✅ | 2025-10-08 |
| TASK-003 | Author `.github/workflows/validate-infrastructure.yml` with `workflow_call` interface publishing outputs `endpoint_url`, `workspace_id`, `resource_token`, `azure_location`, and invoking `provision-infrastructure.yml` / `delete-infrastructure.yml` only when the caller requests testing-level validation. | ✅ | 2025-10-08 |

### Implementation Phase 2

- GOAL-002: Implement provisioning, teardown, and telemetry workflows complying with SP-031 diagnostics controls.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Implement `.github/workflows/provision-infrastructure.yml` to run `azd up` with OIDC (`azure/login@v2` using `permissions: id-token: write`) and emit outputs for AI Foundry endpoints, diagnostics workspace IDs, and role assignment resource IDs when invoked for testing. | ✅ | 2025-10-08 |
| TASK-005 | Implement `.github/workflows/delete-infrastructure.yml` with conditional teardown honoring `retain_resources` input; execute `azd down` and publish deletion telemetry to Log Analytics for testing deployments. | ✅ | 2025-10-08 |
| TASK-006 | Add centralized telemetry step using Azure CLI or `az monitor` REST to send structured Gate Task metrics and deployment metadata to the diagnostics workspace defined in SP-031 (telemetry executes for both testing validation and production publish events). |  |  |

### Implementation Phase 3

- GOAL-003: Integrate quality gates, artifact management, and rollback safeguards into CI/CD pipelines.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Extend `continuous-integration.yml` to generate `quality-gate.json` (aggregated task results) and upload artifacts (`coverage`, `quality-gate.json`) via `actions/upload-artifact@v4` with 14-day retention. |  |  |
| TASK-008 | Configure `continuous-delivery.yml` to package VSIX via `npm run package`, store previous artifact checksum, and upload the new VSIX while retaining the prior version for rollback (applies to both testing and production runs; production skips provisioning). | ✅ | 2025-10-08 |
| TASK-009 | Add post-deploy verification job executing smoke tests (`npm run test:perf`, WebRTC harness script) for testing deployments and trigger rollback jobs that call `delete-infrastructure.yml` (testing) or redeploy the previous VSIX (production) upon failure. | ✅ | 2025-10-08 |

### Implementation Phase 4

- GOAL-004: Enforce approvals, security scans, and matrix compatibility requirements.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | Configure environment protection rules in `continuous-delivery.yml` (testing automatic for commits, production approvals required on tagged releases) and enforce change ticket input validation. |  |  |
| TASK-011 | Integrate `npm audit --json`, `npx eslint --ext .ts .` with security rules, and GitHub dependency review actions; upload SARIF reports on failure. |  |  |
| TASK-012 | Add matrix strategy covering VS Code Stable/Insiders (via environment variables) and Node.js 22.x across `ubuntu-latest`, updating tasks to respect matrix variables (e.g., `VS_CODE_VERSION`, `NODE_VERSION`). |  |  |

## 3. Alternatives

- **ALT-001**: Merge provisioning and validation into a single workflow. Rejected because SP-031 mandates chained reusable workflows for isolation.
- **ALT-002**: Use personal access tokens for Azure authentication. Rejected due to security requirements enforcing OIDC token exchange.

## 4. Dependencies

- **DEP-001**: Azure CLI and Bicep CLI available on GitHub-hosted runners (`actions/setup-azure` ensures versions ≥ 2.62 / 0.28).
- **DEP-002**: `azd` project definition in repository root synchronized with `infra/main.bicep` modules.
- **DEP-003**: Log Analytics workspace module outputs provided by infrastructure templates per SP-031 for telemetry ingestion.

## 5. Files

- **FILE-001**: `.github/workflows/continuous-integration.yml` — Defines CI Gate Tasks and artifact publishing.
- **FILE-002**: `.github/workflows/continuous-delivery.yml` — Orchestrates environment promotions and rollback strategy.
- **FILE-003**: `.github/workflows/validate-infrastructure.yml` — Chains provisioning and teardown reusable workflows.
- **FILE-004**: `.github/workflows/provision-infrastructure.yml` — Executes `azd up` and outputs diagnostics metadata.
- **FILE-005**: `.github/workflows/delete-infrastructure.yml` — Handles `azd down` tear-down while honoring retention flags.
- **FILE-006**: `scripts/run-quality-gate.mjs` — Emits consolidated Gate Task results as `quality-gate.json` if extension required.

## 6. Testing

- **TEST-001**: Execute `npm run lint` and `npm run test:all` inside the CI workflow to confirm Gate Tasks succeed and coverage thresholds are enforced.
- **TEST-002**: Run `azd up` and `azd down` within `validate-infrastructure.yml` using ephemeral resource tokens to validate provisioning chain and telemetry publishing.
- **TEST-003**: Validate SARIF generation by intentionally triggering a sample ESLint security issue in a feature branch and confirming workflow failure plus SARIF upload.
- **TEST-004**: Use `act` or GitHub workflow dry-run (`gh workflow run --dry-run`) to ensure matrix strategy and approval gates function without runtime errors.

## 7. Risks & Assumptions

- **RISK-001**: GitHub Actions runtime limits may exceed 15 minutes if matrix expansion is misconfigured; mitigate by parallelizing Gate Tasks within allowed dependencies.
- **RISK-002**: Azure quota exhaustion during `azd up` could block provisioning; mitigate with automated diagnostics surfacing quota error codes and retry logic.
- **ASSUMPTION-001**: Required VS Code tasks and npm scripts already exist and succeed locally; failure indicates prerequisite remediation outside this plan.
- **ASSUMPTION-002**: Log Analytics workspace ingestion latency remains under five minutes as required by SP-031; plan includes telemetry verification tasks.

## 8. Related Specifications / Further Reading

- [spec/sp-040-spec-process-cicd-pipeline.md](../spec/sp-040-spec-process-cicd-pipeline.md)
- [spec/sp-039-spec-process-testing-strategy.md](../spec/sp-039-spec-process-testing-strategy.md)
- [spec/sp-031-spec-azure-test-runtime-infrastructure.md](../spec/sp-031-spec-azure-test-runtime-infrastructure.md)
- [docs/design/COMPONENTS.md](../docs/design/COMPONENTS.md)
- [docs/design/TECHNICAL-REFERENCE-INDEX.md](../docs/design/TECHNICAL-REFERENCE-INDEX.md)
