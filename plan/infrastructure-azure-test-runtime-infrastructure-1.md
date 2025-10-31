---
goal: Azure Test & Runtime Infrastructure Implementation
version: 1.0
date_created: 2025-10-04
last_updated: 2025-10-04
owner: Agent Voice Security Architecture
status: 'Complete'
tags: [infrastructure, azure, diagnostics, ci]
---

# Introduction

![Status: Complete](https://img.shields.io/badge/status-Complete-green)

This plan implements the Azure Test & Runtime Infrastructure defined in `spec/sp-031-spec-azure-test-runtime-infrastructure.md`, ensuring the Agent Voice project provisions Azure AI Foundry with GPT Realtime deployments, required diagnostics, and conditional role assignments for supplied principals.

## 1. Requirements & Constraints

- **REQ-001**: Deploy Azure AI Foundry (AIServices) with GPT Realtime model deployments using repository Bicep modules.
- **REQ-002**: Assign `Contributor` and `Cognitive Services OpenAI Contributor` roles to the AI Foundry resource when `principalId` is provided.
- **REQ-003**: Provision a Log Analytics workspace via `avm/res/operational-insights/workspace` with retention ≤ 30 days.
- **REQ-004**: Configure subscription-level `Administrative` and `Policy` activity log diagnostics to route into the workspace.
- **PAT-002**: Mirror the GenAI Database Explorer reusable workflow chain so that `continuous-delivery.yml` calls `validate-infrastructure.yml`, which orchestrates `provision-infrastructure.yml` (`azd up`) and `delete-infrastructure.yml` (`azd down`) using the RAW references documented in the specification.
- **SEC-001**: Expose `disableLocalAuth` as a parameter on the AI Foundry deployment while enforcing system-assigned managed identity.
- **SEC-002**: Restrict diagnostics workspace access to the supplied pipeline principal without adding extra readers.
- **CON-001**: Do not declare custom roles, PIM policies, or automation identities inside repository infrastructure templates.
- **CON-002**: Support teardown of diagnostics resources by default with optional retention controls for customer environments.
- **GUD-001**: Parameterize AI Foundry and workspace names to avoid collisions across parallel CI runs.
- **PAT-001**: Keep diagnostics and AI Foundry declarations in `infra/main.bicep`, reusing existing modules and direct AVM imports instead of introducing wrapper modules.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Parameterize AI Foundry deployment and enforce scoped role assignments.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add `aiFoundryDisableLocalAuth` parameter to `infra/main.bicep`, propagate to `infra/cognitive-services/accounts/main.bicep`, and default to `false` to maintain CI compatibility while allowing hardening in long-lived environments. | ✅ | 2025-10-03 |
| TASK-002 | Update `infra/main.bicep` to apply `Contributor` and `Cognitive Services OpenAI Contributor` roles only when `principalId` is supplied, guarding against empty GUID values; `infra/core/security/role_aifoundry.bicep` already no-ops on empty arrays so no module change required. | ✅ | 2025-10-03 |
| TASK-003 | Align `infra/azure-ai-foundry-models.json` deployments with AI Foundry parameters, ensuring GPT Realtime SKUs are present and resource naming supports collision resistance per `GUD-001`. | ✅ | 2025-10-03 |

### Implementation Phase 2

- GOAL-002: Provision diagnostics workspace and activity log routing.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Update `infra/main.bicep` to declare diagnostics workspace parameters and instantiate `br/public:avm/res/operational-insights/workspace:0.4.1` directly with retention ≤ 30 days and optional retention override. | ✅ | 2025-10-03 |
| TASK-005 | Configure the AI Foundry deployment to pass a `diagnosticSettings` parameter (mirroring the specification example) that routes `Administrative` and `Policy` logs to the workspace. | ✅ | 2025-10-03 |
| TASK-006 | Constrain workspace access to the supplied `principalId` by validating role assignments and avoiding additional reader principals, satisfying `SEC-002`. | ✅ | 2025-10-03 |

### Implementation Phase 3

- GOAL-003: Automate validation and CI enforcement, matching the GenAI Database Explorer workflow pattern referenced by the specification.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Add a reusable script or documented CLI procedure for GPT Realtime smoke testing, referencing the deployed endpoint to verify deployments post-`azd up`. | ✅ | 2025-10-03 |
| TASK-008 | Create `.github/workflows/lint-and-publish-bicep.yml` to lint Bicep templates and publish artifacts as a reusable workflow. | ✅ | 2025-10-03 |
| TASK-009 | Update `.github/workflows/continuous-integration.yml` to invoke the reusable Bicep lint workflow for pull requests, aligning with the specification’s CI/CD integration requirements. | ✅ | 2025-10-03 |
| TASK-010 | Author `.github/workflows/provision-infrastructure.yml` (reusable) that invokes `azd up` for smoke provisioning, following [`provision-infrastructure.yml`](https://raw.githubusercontent.com/PlagueHO/genai-database-explorer/main/.github/workflows/provision-infrastructure.yml). | ✅ | 2025-10-03 |
| TASK-011 | Author `.github/workflows/delete-infrastructure.yml` (reusable) that executes `azd down` for teardown, following [`delete-infrastructure.yml`](https://raw.githubusercontent.com/PlagueHO/genai-database-explorer/main/.github/workflows/delete-infrastructure.yml). | ✅ | 2025-10-03 |
| TASK-012 | Author `.github/workflows/validate-infrastructure.yml` (reusable) that fans out to the provision and delete workflows, mirroring [`validate-infrastructure.yml`](https://raw.githubusercontent.com/PlagueHO/genai-database-explorer/main/.github/workflows/validate-infrastructure.yml). | ✅ | 2025-10-03 |
| TASK-013 | Author `.github/workflows/continuous-delivery.yml` that invokes the validation workflow to implement the full chaining pattern from [`continuous-delivery.yml`](https://raw.githubusercontent.com/PlagueHO/genai-database-explorer/main/.github/workflows/continuous-delivery.yml). | ✅ | 2025-10-03 |

## 3. Alternatives

- **ALT-001**: Provision GPT Realtime deployments via imperative CLI commands—rejected due to lack of idempotency and drift control.
- **ALT-002**: Reuse a shared diagnostics workspace across environments—rejected to prevent data leakage between CI runs and customer deployments.

## 4. Dependencies

- **DEP-001**: Microsoft Entra ID tenant and principals supplied by `azd up` for role assignment.
- **DEP-002**: Azure subscriptions with quota for Azure AI Foundry GPT Realtime SKUs.
- **DEP-003**: GitHub Actions runners with Azure CLI ≥ 2.62 and Bicep CLI ≥ 0.28 installed.

## 5. Files

- **FILE-001**: `infra/main.bicep` – orchestrates AI Foundry, role assignments, and diagnostics modules.
- **FILE-002**: `infra/cognitive-services/accounts/main.bicep` – AI Foundry module receiving parameter updates.
- **FILE-003**: `infra/azure-ai-foundry-models.json` – GPT Realtime deployment definitions.
- **FILE-004**: `infra/core/security/role_aifoundry.bicep` – applies conditional role assignments for principals.
- **FILE-005**: `.github/workflows/lint-and-publish-bicep.yml` – reusable CI workflow for Bicep linting and artifact publication.

## 6. Testing

- **TEST-001**: Run `az deployment sub what-if` against `infra/main.bicep` to confirm AI Foundry, diagnostics resources, and conditional role assignments align with supplied parameters.
- **TEST-002**: Run the documented GPT Realtime smoke test script/commands against the emitted endpoint to verify connectivity post-deployment.
- **TEST-003**: Run `az monitor log-analytics query` against the workspace to confirm activity log entries appear within five minutes of deployment events.
- **TEST-004**: Execute `.github/workflows/continuous-integration.yml` in a pull request to validate it invokes the reusable Bicep lint workflow and surfaces lint results.
- **TEST-005**: Trigger `.github/workflows/continuous-delivery.yml` (in a non-production environment) to confirm it chains through validation, provisioning, and deletion workflows exactly as the GenAI Database Explorer pattern dictates.

## 7. Risks & Assumptions

- **RISK-001**: Regional GPT Realtime quota shortages could block deployments; mitigate by tracking quota availability per environment and selecting fallback regions when necessary.
- **ASSUMPTION-001**: `azd up` reliably supplies `principalId` and related parameters for conditional role assignments.

## 8. Related Specifications / Further Reading

- [spec/sp-031-spec-azure-test-runtime-infrastructure.md](../spec/sp-031-spec-azure-test-runtime-infrastructure.md)
- [Azure OpenAI Realtime API Reference](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-reference)
