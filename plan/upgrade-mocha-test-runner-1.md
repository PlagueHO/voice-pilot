---
goal: Upgrade Mocha test runner to v11.7.4 with compliant toolchain
version: 1.0
date_created: 2025-10-09
last_updated: 2025-10-09
owner: VoicePilot Engineering
status: 'Planned'
tags: ['upgrade', 'testing']
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This plan upgrades the repository test harness to `mocha@11.7.4`, aligns all local and CI runtimes with Mocha 11's Node.js requirements, and validates that VoicePilot's lint, unit, integration, and coverage workflows remain green after the migration.

## 1. Requirements & Constraints

- **REQ-001**: Pin `mocha` to `^11.7.4` in `package.json` and remove legacy transitive ranges.
- **REQ-002**: Ensure all npm scripts that invoke Mocha continue to run without flag regressions.
- **SEC-001**: Enforce a repository-wide minimum Node.js runtime of `>=20.19.0` to satisfy Mocha 11 security support.
- **DOC-001**: Document the new Node.js requirement across `README.md`, `docs/QUICKSTART.md`, and CI documentation.
- **CON-001**: Preserve `npm run quality:gate` behaviour and artefact outputs after the dependency update.
- **GUD-001**: Regenerate `package-lock.json` with `npm install` to keep lockfiles deterministic.
- **PAT-001**: Follow existing quality gate validation (`npm run test:unit`, `npm run test:coverage`, VS Code tasks) before merge.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Update dependency metadata and lockfiles for Mocha 11.7.4.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Edit `package.json` to set `devDependencies.mocha` to `^11.7.4`, remove the `@types/mocha` entry, and add `"node": ">=20.19.0"` inside the existing `engines` field alongside `vscode`. |  |  |
| TASK-002 | Run `npm install` from the repository root to update `package-lock.json` and ensure Mocha 11.7.4 plus related transitive upgrades (e.g., `chokidar@4`) are captured. |  |  |
| TASK-003 | Delete any stale `node_modules` artefacts from CI caches if required by purging the GitHub Actions cache key or bumping the cache version in workflows. |  |  |

### Implementation Phase 2

- GOAL-002: Align development and documentation with the new Node.js baseline.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Commit a new `.nvmrc` containing `22.12.0` to standardise the local Node.js version that satisfies Mocha 11's requirement. |  |  |
| TASK-005 | Update `.github/workflows/continuous-integration.yml` to use `22.12.0` in the `matrix.node-version` values and adjust any caching keys accordingly. |  |  |
| TASK-006 | Update `.devcontainer/devcontainer.json` post-create tooling (or base image tag) to guarantee the remote container installs Node.js `22.12.0` or newer. |  |  |
| TASK-007 | Revise `README.md`, `docs/QUICKSTART.md`, and `docs/CI-PIPELINE.md` to call out the `>=20.19.0` Node.js prerequisite and reference the Mocha 11 upgrade. |  |  |

### Implementation Phase 3

- GOAL-003: Validate the upgraded toolchain and document release notes.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | Run `npm run compile`, `npm run test:unit`, `npm run test:coverage`, and `npm run quality:gate` locally (or via CI dry-run) to confirm all suites pass after the upgrade. Capture outputs for audit. |  |  |
| TASK-009 | Execute `npm run test` to ensure the VS Code integration harness still launches successfully under Mocha 11. |  |  |
| TASK-010 | Add a `CHANGELOG.md` entry noting the Mocha 11.7.4 upgrade, Node.js baseline update, and any observable behavioural changes (e.g., watch mode using `chokidar@4`). |  |  |

## 3. Alternatives

- **ALT-001**: Maintain `mocha@10.7.3` and apply backported fixes; rejected because it leaves the project without chokidar v4 updates and Node 24 CI coverage.
- **ALT-002**: Replace Mocha with an alternative runner (e.g., Vitest or Jest); rejected due to significantly higher migration cost and existing integration with NYC and VS Code extension tests.

## 4. Dependencies

- **DEP-001**: Node.js `22.12.0` toolchain availability across local development, devcontainers, and GitHub Actions runners.
- **DEP-002**: `nyc` and `ts-node` compatibility with Mocha 11 CLI execution for coverage and TypeScript transpilation.

## 5. Files

- **FILE-001**: `package.json` – update devDependencies and engines metadata.
- **FILE-002**: `package-lock.json` – regenerate lockfile with the upgraded dependency graph.
- **FILE-003**: `.github/workflows/continuous-integration.yml` – enforce the new Node.js matrix value.
- **FILE-004**: `.devcontainer/devcontainer.json` and `.nvmrc` – guarantee consistent container/local Node.js versions.
- **FILE-005**: `README.md`, `docs/QUICKSTART.md`, `docs/CI-PIPELINE.md`, `CHANGELOG.md` – document runtime requirements and upgrade notes.

## 6. Testing

- **TEST-001**: `npm run compile` to ensure TypeScript emits successfully with Mocha 11 typings.
- **TEST-002**: `npm run test:unit`, `npm run test:coverage`, and `npm run quality:gate` to validate unit, integration, coverage, and performance workflows.
- **TEST-003**: `npm run test` (VS Code integration) to verify extension activation under the new Mocha runtime.

## 7. Risks & Assumptions

- **RISK-001**: Mocha 11's watcher (`chokidar@4`) may handle path globs differently; mitigation is to re-run watch-mode smoke tests after upgrade.
- **RISK-002**: Removing `@types/mocha` could surface missing TypeScript ambient definitions; mitigation is to add explicit `types` declarations in test tsconfig if compilation fails.
- **ASSUMPTION-001**: GitHub-hosted runners provide Node.js `22.12.0` via `actions/setup-node@v4` without manual installation.
- **ASSUMPTION-002**: Existing NYC configuration remains compatible with the upgraded Mocha CLI without additional flags.

## 8. Related Specifications / Further Reading

- [Mocha Changelog 11.x](https://github.com/mochajs/mocha/blob/main/CHANGELOG.md)
- [VoicePilot Continuous Integration Pipeline](../docs/CI-PIPELINE.md)
