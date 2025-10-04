---
title: Azure Test & Runtime Infrastructure Specification
version: 1.0
date_created: 2025-10-04
last_updated: 2025-10-04
owner: VoicePilot Security Architecture
tags: [infrastructure, azure, diagnostics, ci]
---

## Introduction

This specification defines the Azure infrastructure required to operate the VoicePilot platform in automated testing pipelines and optional customer-hosted deployments. It covers provisioning the Azure AI Foundry account with GPT Realtime deployments, as well as the diagnostics workspace needed to observe CI executions, while recognizing that RBAC, PIM, and automation identities are supplied automatically by the `azd up` workflow executed in GitHub Actions and that the repository applies required role assignments when supplied with a principal.

## 1. Purpose & Scope

The specification establishes mandatory controls for provisioning the Azure AI Foundry environment, GPT Realtime model deployments, and telemetry infrastructure used by VoicePilot CI and optional customer environments. It applies to engineering, operations, and security teams maintaining the automated GitHub Actions pipeline and documenting requirements for production-ready deployments. Assumptions: Microsoft Entra ID is the identity provider; `azd up` executes end-to-end provisioning including principal creation and passes the deployment principal to infrastructure templates; deployments may be short-lived during CI or retained for real usage depending on the operator.

## 2. Definitions

- **AAD**: Microsoft Entra ID tenant providing identity and access management.
- **RBAC**: Role-Based Access Control within Azure subscriptions and resource groups.
- **PAW**: Privileged Access Workstation hardened for administrative tasks.
- **PIM**: Privileged Identity Management for just-in-time elevation of Azure roles.
- **SPOC**: Service Principal Object Credential used by automation workloads.
- **Managed Identity**: Azure identity managed by the platform to access other resources without secrets.
- **Scope**: Azure RBAC boundary (management group, subscription, resource group, resource).
- **KQL**: Kusto Query Language used for Azure Monitor and Sentinel log analytics queries.
- **CSE**: Cognitive Services Endpoint hosting Azure OpenAI GPT Realtime models.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: Deploy an Azure AI Foundry (AIServices) account with GPT Realtime model deployments using the repository’s Bicep modules and configuration files.
- **REQ-002**: When `principalId` is provided, assign the principal `Contributor` and `Cognitive Services OpenAI Contributor` roles scoped to the AI Foundry resource to enable model management.
- **REQ-003**: Provision a Log Analytics workspace by importing the AVM `avm/res/operational-insights/workspace` module directly within `infra/main.bicep`, enforcing retention ≤ 30 days for CI diagnostics.
- **REQ-004**: Configure subscription-level activity log diagnostics (categories `Administrative` and `Policy`) to route into the workspace for troubleshooting deployments.
- **PAT-002**: Adopt the chained reusable workflow pattern from `PlagueHO/genai-database-explorer` where [`continuous-delivery.yml`](https://raw.githubusercontent.com/PlagueHO/genai-database-explorer/main/.github/workflows/continuous-delivery.yml) calls [`validate-infrastructure.yml`](https://raw.githubusercontent.com/PlagueHO/genai-database-explorer/main/.github/workflows/validate-infrastructure.yml), which in turn executes [`provision-infrastructure.yml`](https://raw.githubusercontent.com/PlagueHO/genai-database-explorer/main/.github/workflows/provision-infrastructure.yml) (for `azd up` smoke provisioning) and [`delete-infrastructure.yml`](https://raw.githubusercontent.com/PlagueHO/genai-database-explorer/main/.github/workflows/delete-infrastructure.yml) (for `azd down` teardown).
- **SEC-001**: Enforce system-assigned managed identity on the AI Foundry account and expose `disableLocalAuth` as a parameter (defaulting to enabled access for compatibility tests).
- **SEC-002**: Ensure workspace access is limited to the pipeline principal supplied via `principalId`; no additional readers are defined in repository infrastructure.
- **CON-001**: No PIM policies, custom roles, or automation identities may be declared in this repository; they are provided externally by `azd` templates.
- **CON-002**: Diagnostic resources created here must support teardown post-CI while permitting optional retention for customer environments via parameters.
- **GUD-001**: Parameterize AI Foundry and workspace naming to support parallel CI runs without collision.
- **PAT-001**: Centralize infrastructure in `infra/main.bicep`, reusing existing repository modules and direct AVM imports instead of creating wrapper modules.

## 4. Interfaces & Data Contracts

| Interface | Description | Contract |
| --- | --- | --- |
| Azure RBAC Role Assignment Bicep Module | Deploys role assignments for principals at defined scopes. | Parameters: `principalId`, `roleDefinitionId`, `scope`, `description`. Outputs assignment resource ID. |
| GitHub Actions OIDC Federated Credential | Grants GitHub workflow identity access to Azure AD app. | Claims: `sub` (repo + environment), `aud` = `api://AzureADTokenExchange`. |
| Azure Activity Log Diagnostic Settings | Streams RBAC and policy logs to Log Analytics. | Fields: `category` = `Administrative`, `logs.destination` = workspace resource ID, `retentionInDays` ≥ 365. |

## 5. Acceptance Criteria

- **AC-001**: Given a deployment, when `azd up` supplies parameters, then an AI Foundry account and GPT Realtime deployments are provisioned and reachable at the emitted endpoint, and the supplied principal receives the required contributor roles.
- **AC-002**: Given a CI failure, when operators query the Log Analytics workspace, then activity logs for the deployment scope are present within five minutes of occurrence.
- **AC-003**: Given workspace creation, when the deployment completes, then the workspace retention is set to the configured short-lived value (≤ 30 days).
- **AC-004**: Given pipeline tear-down, when cleanup runs, then AI Foundry and diagnostics resources are deleted unless parameters explicitly opt into retention for long-lived environments.
- **AC-005**: Given a continuous delivery run, when `continuous-delivery.yml` executes, then it calls `validate-infrastructure.yml`, which provisions infrastructure via `provision-infrastructure.yml` using `azd up` and subsequently cleans up with `delete-infrastructure.yml` using `azd down`.

## 6. Test Automation Strategy

- **Test Levels**: Infrastructure validation using `az deployment what-if`, diagnostics verification through scripted KQL queries, and `azd up`-driven smoke tests that exercise GPT Realtime endpoints before `azd down` teardown.
- **Frameworks**: `az` CLI with `bicep`, GitHub Actions workflow assertions, Log Analytics REST API, sample WebSocket/WebRTC test harness for GPT Realtime.
- **Test Data Management**: CI runs provision isolated subscriptions with unique resource names; tear-down removes resources after validation.
- **CI/CD Integration**: Pull requests use the existing `continuous-integration.yml` workflow, invoking the reusable [`lint-and-publish-bicep.yml`](https://raw.githubusercontent.com/PlagueHO/genai-database-explorer/main/.github/workflows/lint-and-publish-bicep.yml) job to lint and validate templates; the `continuous-delivery.yml` workflow MUST mirror the GenAI Database Explorer pattern referenced in [`continuous-delivery.yml`](https://raw.githubusercontent.com/PlagueHO/genai-database-explorer/main/.github/workflows/continuous-delivery.yml) by calling [`validate-infrastructure.yml`](https://raw.githubusercontent.com/PlagueHO/genai-database-explorer/main/.github/workflows/validate-infrastructure.yml), which fans out to [`provision-infrastructure.yml`](https://raw.githubusercontent.com/PlagueHO/genai-database-explorer/main/.github/workflows/provision-infrastructure.yml) (running `azd up` for smoke tests) and [`delete-infrastructure.yml`](https://raw.githubusercontent.com/PlagueHO/genai-database-explorer/main/.github/workflows/delete-infrastructure.yml) (issuing `azd down` for cleanup). Maintainers can still run `az deployment what-if` locally for additional assurance before merging.
- **Coverage Requirements**: AI Foundry deployment, GPT Realtime availability, and diagnostics routing must be covered by automated integration checks.
- **Performance Testing**: Monitor model endpoint readiness and activity log ingestion latency; targets are < 2 minutes for deployment readiness and < 5 minutes for log availability.

## 7. Rationale & Context

VoicePilot relies on Azure AI Foundry GPT Realtime services for both automated validation and runtime experiences. Provisioning the AI Foundry account alongside diagnostics visibility ensures consistent environments across CI and potential customer deployments. By leveraging `azd up` for identity management while applying targeted contributor roles when a principal is supplied, the repository enforces least privilege and observability requirements through a dedicated Log Analytics workspace.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Microsoft Entra ID tenant – Provides user, group, and application identities for RBAC assignments.
- **EXT-002**: Azure Monitor Log Analytics workspace – Centralizes RBAC audit logs and alerting.

### Third-Party Services

- **SVC-001**: GitHub Actions – Executes deployment workflows using OIDC federation.

### Infrastructure Dependencies

- **INF-001**: Azure AI Foundry Cognitive Services account – Deployed via repository Bicep module.
- **INF-002**: GPT Realtime deployments – Configured using `azure-ai-foundry-models.json`.
- **INF-003**: Log Analytics workspace – Declared in `infra/main.bicep` via direct AVM module import for diagnostics storage.
- **INF-004**: Activity log diagnostic settings – Configured to stream subscription events into the workspace.

### Data Dependencies

- **DAT-001**: Activity log data streamed to Log Analytics – Enables auditing of role changes and access attempts.

### Technology Platform Dependencies

- **PLT-001**: Azure CLI ≥ 2.62 with Bicep CLI ≥ v0.28 – Required for IaC deployments and validation.

### Compliance Dependencies

- **COM-001**: Azure Security Benchmark v3 – Control PR.A-3 (log collection) satisfied through diagnostics workspace.
- **COM-002**: GDPR Article 32 – Logging enables forensic analysis while short retention minimizes data exposure.

## 9. Examples & Edge Cases

Example Bicep snippets using Azure Verified Modules for AI Foundry and diagnostics workspace provisioning:

```bicep
// AI Foundry account with GPT Realtime deployments
module aiFoundryService './cognitive-services/accounts/main.bicep' = {
  name: 'ai-foundry-service-deployment-${resourceToken}'
  scope: resourceGroup(resourceGroupName)
  params: {
    name: aiFoundryName
    kind: 'AIServices'
    location: location
    customSubDomainName: aiFoundryCustomSubDomainName
    disableLocalAuth: false
    allowProjectManagement: true
    managedIdentities: {
      systemAssigned: true
    }
    publicNetworkAccess: 'Enabled'
    sku: 'S0'
    deployments: azureAiFoundryModelDeployments
    tags: tags
    diagnosticSettings: [
      {
        name: 'activityLogs'
        diagnosticSettings: {
          logs: [
            {
              category: 'Administrative'
              enabled: true
            }
            {
              category: 'Policy'
              enabled: true
            }
          ]
          workspaceId: diagnosticsWorkspace.outputs.resourceId
        }
      }
    ]
  }
}

// Log Analytics workspace for diagnostics using AVM module
module diagnosticsWorkspace 'br/public:avm/res/operational-insights/workspace:0.4.1' = {
  name: 'diagnostics-workspace-${resourceToken}'
  scope: resourceGroup(resourceGroupName)
  params: {
    name: 'law-${environmentName}-${uniqueString(environmentName)}'
    location: location
    retentionInDays: 14
    sku: 'PerGB2018'
    tags: tags
  }
}
```

Example GitHub Actions workflow for linting and validating Bicep templates:

```yaml
name: Lint and Publish Bicep

on:
  workflow_call:

jobs:
  build-armtemplates:
    name: Lint and Publish Bicep
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Lint Bicep
        run: |
          bicep lint ./infra/main.bicep

      - name: Spellcheck Bicep files
        uses: streetsidesoftware/cspell-action@v6
        with:
          files: "**/*.bicep"
          config: ".cspell.json"

      - name: Publish Bicep as Workflow Artifact
        uses: actions/upload-artifact@v4
        with:
          name: infrastructure_bicep
          path: |
            ./infra/*.bicep
            ./infra/*.json
            ./infra/**/*
```

## 10. Validation Criteria

- Deployments emit AI Foundry, GPT Realtime, and diagnostics resources with contributor role assignments applied only when `principalId` is provided.
- GPT Realtime endpoints report healthy status post-deployment and accept smoke-test requests.
- Activity logs appear in the Log Analytics workspace within five minutes of subscription events.
- Workspace retention policies remain within the specified short-lived threshold unless overridden for persistent environments.
- Tear-down automation cleans up resources when running in ephemeral CI mode.

## 11. Related Specifications / Further Reading

- [sp-028-spec-architecture-error-handling-recovery.md](sp-028-spec-architecture-error-handling-recovery.md)
- [sp-027-spec-security-privacy-data-handling.md](sp-027-spec-security-privacy-data-handling.md)
- [Azure Identity for JavaScript](https://learn.microsoft.com/en-us/javascript/api/overview/azure/identity-readme)
- [Azure OpenAI Realtime API Reference](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-reference)
