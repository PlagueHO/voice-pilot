---
title: CI/CD Pipeline & Quality Gates Specification
version: 1.0.0
date_created: 2025-10-08
last_updated: 2025-10-08
owner: VoicePilot Engineering Productivity
tags: [process, cicd, testing, azure, governance]
---

## Introduction

This specification defines the continuous integration and continuous delivery (CI/CD) pipeline for VoicePilot, establishing quality gates, workflow orchestration, deployment automation, and rollback controls that align with the VoicePilot testing strategy and Azure runtime infrastructure.

## 1. Purpose & Scope

The purpose of this specification is to prescribe the end-to-end CI/CD process for VoicePilot, including GitHub Actions workflow design, quality gate sequencing, Azure infrastructure provisioning, artifact management, and operational observability. The scope covers all automated pipelines triggered by source control events or manual approvals for testing and production environments. The intended audience includes developers, release managers, DevOps engineers, security reviewers, and infrastructure operators. Assumptions: all contributors use the repository-provided VS Code tasks, `azd up`/`azd down` are available in CI, and Azure resources follow SP-031 controls.

> **Environment Model Update (2025-10-08):** `continuous-delivery.yml` now targets two environments: **testing** for full-stack validation (including ephemeral Azure provisioning) and **production** for marketplace publication only. Production deployments are limited to tagged releases on `main` and assume customers provision their own Azure infrastructure outside this pipeline.

## 2. Definitions

- **CI**: Continuous Integration; automated verification executed on each change.
- **CD**: Continuous Delivery; automated deployment with gated approvals to higher environments.
- **Gate Task**: A mandatory job representing `Lint Extension`, `Test Unit`, `Test Extension`, `Test All`, `Test Coverage`, `Test Performance`, or `Quality Gate Sequence` as defined in SP-039.
- **Reusable Workflow**: A GitHub Actions workflow invoked via `workflow_call`, enabling chained orchestration.
- **Environment Promotion**: Controlled advancement of artifacts from testing → production with approvals appropriate to each stage.
- **OIDC**: OpenID Connect federation from GitHub Actions runners to Azure for secretless authentication.
- **Runbook**: Documented manual procedure for exceptional handling (e.g., rollback, override approvals).
- **Artifact**: Any build output (compiled extension, coverage report, deployment manifest) stored via GitHub Actions artifacts or release attachments.
- **Telemetry Snapshot**: Aggregated metrics emitted by pipelines (task outcomes, durations, coverage) consumed by diagnostics services.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: CI pipelines SHALL execute the Gate Task sequence defined in SP-039 (Lint → Test Unit → Test Extension → Test All → Test Coverage → Test Performance) with fail-fast behavior and total runtime ≤ 15 minutes on the reference runner.
- **REQ-002**: CD pipelines SHALL publish build artifacts (VSIX, coverage reports, deployment manifests) with retention ≥ 14 days and link coverage JSON to quality dashboards.
- **REQ-003**: CD pipelines SHALL gate deployments through environment approvals: testing (automatic for CI-triggered commits) and production (approver group + change ticket reference on tagged releases).
- **REQ-004**: For testing deployments, infrastructure provisioning workflows SHALL reuse the chained pattern from SP-031 (continuous-delivery → validate-infrastructure → provision-infrastructure + delete-infrastructure) and MUST execute `azd up` for smoke validation before artifact promotion. Production deployments SHALL NOT provision Azure infrastructure via CI/CD.
- **REQ-010**: Production deployments SHALL execute only when a semantic version tag (`v*.*.*`) is pushed on `main`, SHALL publish the VSIX package to the marketplace, and SHALL skip Azure infrastructure provisioning.
- **REQ-005**: Pipelines SHALL authenticate to Azure using GitHub Actions OIDC with least-privilege role assignments scoped per SP-031, avoiding stored secrets.
- **REQ-006**: Pipelines SHALL emit telemetry snapshots containing task status, duration, coverage, deployment outcome, and Azure diagnostics linkage within five minutes of completion.
- **REQ-007**: CD pipelines SHALL implement automated rollback triggers that execute `azd down` for testing deployments or revert to the previous VSIX package for production deployments when verification fails.
- **REQ-008**: Security scans (npm audit, ESLint security rules, dependency review) SHALL run on pull request and block merges on high/critical findings unless a signed exception is attached.
- **REQ-009**: Pipelines SHALL support matrix execution for VS Code versions (stable, insiders) and Node.js 22.x across Linux runners at minimum.
- **SEC-001**: Pipelines SHALL restrict Azure operations to the supplied `principalId` context; no additional reader or contributor assignments are permitted.
- **SEC-002**: All pipeline logs MUST redact secrets and session identifiers before publication and enforce SARIF uploads for security scan failures.
- **CON-001**: Pipelines MUST rely solely on repository-managed VS Code tasks and npm scripts; ad-hoc shell commands are forbidden outside approved steps.
- **CON-002**: Production deployments MUST occur from tagged releases and reusable workflow dispatches originating on the `main` branch.
- **GUD-001**: Prefer workflow modularization via `workflow_call` to maximize reuse and reduce drift between CI and CD pipelines.
- **GUD-002**: Capture deployment parameters (environment, resource tokens, retention flags) in workflow outputs to aid observability dashboards.
- **PAT-001**: Adopt the chained reusable workflow pattern (`continuous-delivery.yml` → `validate-infrastructure.yml` → `provision-infrastructure.yml` / `delete-infrastructure.yml`) for environment provisioning.
- **PAT-002**: Apply the blue/green deployment pattern for extension marketplace releases, retaining the previous VSIX until verification completes.
- **PAT-003**: Use canary task execution (subset of Gate Tasks) on feature branches, expanding to full Gate Task sequence on pull requests.

## 4. Interfaces & Data Contracts

| Interface | Trigger | Inputs | Outputs | Notes |
| --- | --- | --- | --- | --- |
| `continuous-integration.yml` | `pull_request`, `push` to feature branches | Commit SHA, VS Code version matrix | Gate Task results, coverage artifacts, telemetry snapshot | Executes VS Code tasks via npm scripts; fail-fast semantics. |
| `continuous-delivery.yml` | `workflow_dispatch`, tagged release | Release tag, environment, change ticket ID | Promotion summary, approved artifact URIs, diagnostics workspace link | Invokes `validate-infrastructure.yml` per SP-031. |
| `continuous-delivery.yml` (testing) | `push` on `main` without semantic version tag | Commit SHA, derived environment (`testing`), resource token | Ephemeral Azure validation outputs, telemetry snapshot | Provisions infrastructure via `validate-infrastructure.yml`; tears down unless retention requested. |
| `continuous-delivery.yml` (production) | Tagged release (`v*.*.*`) on `main` | Release tag, change ticket ID | Marketplace publish confirmation, prior VSIX checksum | Skips infrastructure provisioning; publishes VSIX and records approvals. |
| `validate-infrastructure.yml` | `workflow_call` | Environment name, resource token, retention flag | Invocation status, `azd up` telemetry, workspace IDs | Fans out to provision + delete workflows. |
| `provision-infrastructure.yml` | `workflow_call` | Environment name, Azure subscription, principal claims | Provision log, emitted endpoints, role assignment IDs | Runs `azd up`; publishes KQL query templates. |
| `delete-infrastructure.yml` | `workflow_call` | Environment name, retention flag | Deletion confirmation, diagnostic logs | Runs `azd down`; supports opt-out for long-lived envs. |
| Quality Gate Report | Generated artifact (`quality-gate.json`) | Gate Task outcomes | JSON document conforming to SP-039 schema | Uploaded with retention ≥ 14 days. |
| Telemetry Snapshot | Logging pipeline step | Task metrics, coverage, deployment IDs | Structured log to Log Analytics workspace | Must arrive ≤5 minutes post-run. |

## 5. Acceptance Criteria

- **AC-001**: Given a pull request to `main`, When `continuous-integration.yml` runs, Then all Gate Tasks complete in order and fail the workflow on the first error with total runtime ≤ 15 minutes.
- **AC-002**: Given a commit to `main` without a semantic version tag, When `continuous-delivery.yml` executes, Then it calls `validate-infrastructure.yml`, provisions testing infrastructure via `azd up`, runs full validation, and records telemetry before tearing down (unless retention is requested).
- **AC-002a**: Given a semantic version tag (`v*.*.*`) pushed to `main`, When `continuous-delivery.yml` executes, Then it skips infrastructure provisioning, publishes the VSIX artifact to the marketplace after approvals, and records change ticket metadata.
- **AC-003**: Given a deployment verification failure, When health checks fail or manual rejection occurs within the post-deploy window, Then the pipeline triggers the rollback workflow and restores the previous VSIX package for production or tears down Azure resources for testing.
- **AC-004**: Given a completed pipeline run, When operators query the Log Analytics workspace, Then telemetry snapshot entries for Gate Tasks and infrastructure events are available within five minutes.
- **AC-005**: Given a security scan detecting a critical vulnerability, When the scan step emits a SARIF result, Then the pipeline fails and publishes the SARIF report for triage.

## 6. Test Automation Strategy

- **Test Levels**: Unit, Integration, Extension Host, Performance, Smoke (post-deploy).
- **Frameworks**: Mocha, Chai, Sinon, `@vscode/test-electron`, NYC (coverage), `azd` tooling for infrastructure smoke tests.
- **Test Data Management**: Use isolated fixture workspaces under `src/test/fixtures`; destroy temporary Azure resources via `delete-infrastructure.yml` unless retention is explicitly enabled.
- **CI/CD Integration**: Gate Tasks executed through npm scripts within GitHub Actions; smoke tests run after deployment using `azd up` outputs and WebRTC test harness stubs.
- **Coverage Requirements**: ≥ 90% statement coverage for activation and disposal code paths, ≥ 80% overall project coverage, with thresholds enforced via NYC configuration per SP-039.
- **Performance Testing**: Execute `npm run test:perf` in CI weekly and on demand; flag regressions exceeding 10% increase in activation latency.

## 7. Rationale & Context

VoicePilot relies on deterministic service initialization (SP-039) and Azure diagnostics visibility (SP-031). Centralizing CI/CD specifications ensures consistent enforcement of quality gates, reproducible deployments, and secure Azure interactions. The reusable workflow chain prevents drift between infrastructure validation steps, while telemetry snapshots supply observability required for rapid incident response. Artifact retention and rollback patterns mitigate deployment risk for customer environments.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: GitHub Actions – Hosts CI/CD workflows, provides OIDC federation.
- **EXT-002**: Azure Active Directory (Microsoft Entra ID) – Issues tokens for `azd` operations via OIDC.

### Third-Party Services

- **SVC-001**: Azure AI Foundry – Target platform for VoicePilot GPT Realtime deployments validated during CD.
- **SVC-002**: Azure Monitor Log Analytics – Stores telemetry snapshots and activity logs per SP-031.

### Infrastructure Dependencies

- **INF-001**: `azd` project definitions – Required for repeatable provisioning; must reference `infra/main.bicep` and associated parameter files.
- **INF-002**: Diagnostics Workspace – Must honor ≤ 30-day retention unless overridden for customer environments.
- **INF-003**: VS Code Tasks (`tasks.json`) – Provide canonical commands for Gate Tasks and packaging.

### Data Dependencies

- **DAT-001**: Coverage reports (`coverage/lcov.info`, `quality-gate.json`) – Consumed by dashboards and release gates.
- **DAT-002**: Deployment metadata (endpoint URLs, role assignment IDs) – Published as workflow outputs and stored in artifacts.

### Technology Platform Dependencies

- **PLT-001**: GitHub-hosted Ubuntu runners with Node.js 22.x and Bicep CLI ≥ 0.28.
- **PLT-002**: VS Code 1.105+ extension host for integration tests executed via `@vscode/test-electron`.

### Compliance Dependencies

- **COM-001**: Azure Security Benchmark v3 – Logging and least privilege controls satisfied through diagnostics routing and scoped role assignments.
- **COM-002**: GDPR Article 32 – Ensures secure processing by limiting data retention and enforcing rollback of faulty deployments.

## 9. Examples & Edge Cases

```yaml
name: Continuous Delivery

on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [testing, production]
      change_ticket:
        required: true

jobs:
  orchestrate:
    uses: ./.github/workflows/validate-infrastructure.yml
    with:
      environment: ${{ inputs.environment }}
      resource_token: ${{ github.run_id }}
      retain_resources: ${{ inputs.environment != 'testing' }}
    secrets: inherit

  deploy-extension:
    needs: orchestrate
    runs-on: ubuntu-latest
    environment:
      name: ${{ inputs.environment }}
      url: ${{ needs.orchestrate.outputs.endpoint_url }}
    steps:
      - run: npm ci
      - run: npm run package
      - run: npx vsce publish --packagePath voicepilot-${{ github.run_number }}.vsix --pre-release
      - uses: actions/upload-artifact@v4
        with:
          name: voicepilot-vsix
          path: voicepilot-${{ github.run_number }}.vsix
```

Edge cases include runner interruptions mid-deployment (pipeline must retry idempotent steps), Azure quota exhaustion (pipeline should surface actionable diagnostics), and partial artifact uploads (pipeline must validate checksum before promotion).

## 10. Validation Criteria

- CI and CD workflows reference this specification in their headers and implement the defined chained reusable pattern.
- Gate Task outputs populate `quality-gate.json` with pass/fail status, durations, and coverage metrics.
- Production deployments require recorded approvals and verified rollback plans before completion.
- Telemetry snapshots are observable in Log Analytics within the mandated latency window.
- Automation runbooks document manual override and rollback procedures referencing workflow outputs.

## 11. Related Specifications / Further Reading

- [sp-031-spec-azure-test-runtime-infrastructure.md](./sp-031-spec-azure-test-runtime-infrastructure.md)
- [sp-039-spec-process-testing-strategy.md](./sp-039-spec-process-testing-strategy.md)
- [sp-007-spec-architecture-audio-capture-pipeline.md](./sp-007-spec-architecture-audio-capture-pipeline.md)
- [docs/design/FEATURE-PLAN.md](../docs/design/FEATURE-PLAN.md)
- [GitHub Actions OIDC Guide](https://learn.microsoft.com/en-us/azure/active-directory/develop/workload-identity-federation)
