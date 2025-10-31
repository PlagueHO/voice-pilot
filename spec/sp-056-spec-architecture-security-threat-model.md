---
title: Security Threat Model & Mitigations
version: 1.0
date_created: 2025-10-18
last_updated: 2025-10-18
owner: Agent Voice Project
tags: [security, threat-model, architecture, privacy, mitigation]
---

## Introduction

This specification defines the formal security threat model for the Agent Voice VS Code extension. It catalogs attack surfaces, enumerates prioritized threats, and prescribes mitigations that integrate with credential handling (SP-003), ephemeral key minting (SP-004), session lifecycle (SP-005), WebRTC transport (SP-006), privacy governance (SP-027), and data contracts (SP-050). The document enables consistent risk assessment, remediation tracking, and regression prevention for future changes.

## 1. Purpose & Scope

This specification establishes mandatory threat modeling activities, artifacts, and review cadences required to maintain Agent Voice's security posture.

- Covers VS Code extension host, webview sandbox, WebRTC transport, Azure OpenAI integrations, configuration surfaces, and message contracts.
- Applies to core engineering, security reviewers, and release managers responsible for approving changes with security impact.
- Excludes organizational policy or enterprise identity governance; those rely on external compliance frameworks.

### Assumptions

- All dependencies referenced (SP-003, SP-004, SP-005, SP-006, SP-027, SP-050) are implemented per their specifications.
- Azure OpenAI GPT Realtime deployments enforce TLS 1.2+ and ephemeral key issuance.
- VS Code secret storage, webview isolation, and message posting semantics behave per documented guarantees.
- Development teams use Git history and pull requests for traceability.

## 2. Definitions

- **Attack Surface**: Exposed entry points (extension host commands, webview messaging, WebRTC endpoints) an adversary may target.
- **Threat Scenario**: Structured description mapping attacker, motivation, vector, impact, and preconditions.
- **Mitigation Control**: Technical or procedural safeguard reducing the likelihood or impact of a threat.
- **Residual Risk**: Risk remaining after mitigations, scored against severity and likelihood thresholds.
- **STRIDE**: Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege classification model.
- **DREAD Score**: Risk scoring rubric (Damage, Reproducibility, Exploitability, Affected Users, Discoverability) normalized to 0-100 for prioritization.
- **Threat Register**: Authoritative log enumerating threat scenarios, mitigations, owners, and status.
- **Security Baseline**: Canonical set of mitigations that all releases must satisfy before shipment.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: Threat modeling SHALL enumerate attack surfaces for extension host, webview, WebRTC transport, Azure endpoints, and data contracts, explicitly referencing SP-003, SP-004, SP-005, SP-006, SP-027, and SP-050.
- **REQ-002**: A machine-readable threat register SHALL be maintained in `spec/threat-register.json` with semantic versioning and Git-backed history.
- **REQ-003**: Each threat entry SHALL include STRIDE category, DREAD score, affected assets, mitigation mapping, residual risk, and review cadence.
- **REQ-004**: Threat model reviews SHALL occur before each minor release and whenever changes modify authentication, session, transport, or privacy boundaries.
- **REQ-005**: Mitigation status SHALL block release if residual risk exceeds the defined acceptance threshold (DREAD ≥ 60 or Severity ≥ High).
- **SEC-001**: All mitigations referencing SP-003 SHALL verify secrets remain inside VS Code SecretStorage, prohibiting disclosure through logging or webview messaging.
- **SEC-002**: Controls tied to SP-004 SHALL enforce expiration-aware handling of ephemeral keys, including memory zeroization and cross-origin protections.
- **SEC-003**: Session-oriented mitigations SHALL validate state transitions and timer protections described in SP-005 to prevent session hijacking or replay.
- **SEC-004**: WebRTC mitigations SHALL ensure DTLS enforcement, ICE candidate validation, and SDP integrity aligned with SP-006.
- **SEC-005**: Privacy mitigations SHALL inherit retention and redaction rules from SP-027 to prevent transcript leakage when evaluating information disclosure threats.
- **SEC-006**: Messaging mitigations SHALL enforce schema validation, origin checks, and anti-replay guards defined in SP-050 before acting on envelopes.
- **THR-001**: Threat categories SHALL cover credential theft, replay attacks, cross-context injection, downgrade attempts, and privacy violations.
- **THR-002**: Models SHALL include abuse cases targeting supply chain (malicious dependency), insider misuse, and client tampering scenarios.
- **CON-001**: Threat modeling artifacts MUST remain text-based (Markdown, JSON) with line length ≤ 200 characters to ease diff review.
- **CON-002**: Automated generation of threat register outputs SHALL execute within 5 seconds to avoid blocking CI workflows.
- **GUD-001**: Adopt STRIDE-by-component workshops for new feature epics, recording decisions and deferrals in the threat register.
- **GUD-002**: Use attack trees or sequence diagrams for complex flows (WebRTC negotiation, credential minting) and store artifacts under `spec/threat-models/`.
- **GUD-003**: Annotate mitigations with integration test coverage IDs to ensure regression protection.
- **PAT-001**: Employ Security Champion sign-off for mitigations touching SP-003 or SP-004 to guarantee credential controls remain intact.
- **PAT-002**: Integrate threat register checks into the Quality Gate Sequence to reject builds lacking required mitigations or reviews.

## 4. Interfaces & Data Contracts

| Field | Type | Description |
| --- | --- | --- |
| `threatId` | string | Canonical identifier (e.g., `VP-THR-004`) unique across the project. |
| `title` | string | Summarized threat scenario name. |
| `stride` | "S"\|"T"\|"R"\|"I"\|"D"\|"E" | STRIDE classification aligned with analyzed vector. |
| `asset` | string | Referenced asset/component (`CredentialManager`, `WebRTCTransport`, `TranscriptAggregator`). |
| `description` | string | Detailed scenario including attacker capability assumptions. |
| `dreadScore` | number | Normalized 0-100 risk score. |
| `mitigations` | MitigationRef[] | List of controls referencing specs, tests, or code modules. |
| `residualRisk` | "Low"\|"Medium"\|"High" | Risk after mitigation. |
| `status` | "Open"\|"Mitigated"\|"Accepted" | Current treatment state. |
| `owner` | string | Security or feature owner accountable for follow-up. |
| `reviewCadence` | string | Cron-style or calendar cadence (e.g., `pre-release`, `quarterly`). |

```json
{
  "threatId": "VP-THR-009",
  "title": "Replay of expired ephemeral key",
  "stride": "T",
  "asset": "EphemeralKeyService",
  "description": "Attacker captures client_secret and reuses after expiration window to gain access.",
  "dreadScore": 72,
  "mitigations": [
    { "spec": "SP-004", "control": "SEC-007", "verification": "test:auth-ephemeral-replay" },
    { "spec": "SP-005", "control": "REQ-002", "verification": "test:session-renewal-block-replay" }
  ],
  "residualRisk": "Low",
  "status": "Mitigated",
  "owner": "SecurityTeam",
  "reviewCadence": "pre-release"
}
```

## 5. Acceptance Criteria

- **AC-001**: Given a new release candidate, When the threat register export runs, Then all threats with DREAD ≥ 60 have linked mitigations referencing implemented controls and passing tests.
- **AC-002**: Given a change to message contracts, When threat modeling review completes, Then new or impacted STRIDE scenarios are documented with updated mitigations before merge.
- **AC-003**: Given a simulated credential theft scenario, When tabletop exercise executes, Then documentation shows secret storage protections prevent unauthorized reuse per SP-003 controls.
- **AC-004**: Given a WebRTC transport update, When security regression tests run, Then SDP tampering, ICE poisoning, and DTLS downgrade attempts are detected and blocked.
- **AC-005**: Given a privacy policy modification, When threat review occurs, Then information disclosure scenarios referencing SP-027 reflect revised retention or redaction rules.

## 6. Test Automation Strategy

- **Test Levels**: Security unit tests for validation utilities, integration tests simulating replay, tampering, and injection, and end-to-end adversarial scenarios using mocked attackers.
- **Frameworks**: Mocha with Chai-as-promised for Node-side security tests, Playwright for webview injection tests, custom WebRTC harness for SDP/ICE fuzzing.
- **Test Data Management**: Synthetic credentials, tampered SDP payloads, and redacted transcripts stored under `spec/threat-fixtures/` with rotation every release.
- **CI/CD Integration**: Quality Gate Sequence SHALL invoke `npm run test:security` to execute mitigation regression suites and `npm run lint` rules enforcing threat register presence.
- **Coverage Requirements**: ≥ 90% branch coverage on threat validation utilities; 100% path coverage for input validation surrounding SP-050 envelope handling.
- **Performance Testing**: Measure mitigation hooks to ensure added security logic increases latency by ≤ 50 ms for session start, ≤ 20 ms for message validation.

## 7. Rationale & Context

The threat model formalizes protection of sensitive assets (credentials, audio, transcripts) while enabling rapid iteration.

1. **Defense in Depth**: Aligns with SP-003 and SP-004 to ensure layered protection around credentials and ephemeral keys.
2. **Real-time Integrity**: Reinforces SP-005 and SP-006 to prevent replay and tampering across session and transport layers.
3. **Privacy Assurance**: Integrates SP-027 requirements to block transcript leakage when analyzing disclosure threats.
4. **Message Trustworthiness**: Builds on SP-050 to ensure schema validation and anti-replay measures reduce injection risk.
5. **Continuous Governance**: Threat register and review cadence provide auditable evidence for security sign-off pre-release.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Azure OpenAI GPT Realtime endpoint – Requires validation of authentication, rate limiting, and replay protections.
- **EXT-002**: VS Code Marketplace distribution – Supply chain integrity checks for extension package signing.

### Third-Party Services

- **SVC-001**: GitHub Actions – Executes automated security tests and validates mitigations upon pull request.

### Infrastructure Dependencies

- **INF-001**: WebRTC STUN/TURN services – Must enforce TLS and certificate validation to prevent man-in-the-middle attacks.
- **INF-002**: SecretStorage backend (OS keychain) – Provides foundational credential protection validated in threat scenarios.

### Data Dependencies

- **DAT-001**: Threat register JSON artifact – Consumed by security dashboards and CI validation steps.
- **DAT-002**: Message schemas from SP-050 – Required to validate tampering and injection scenarios.

### Technology Platform Dependencies

- **PLT-001**: Node.js 22 security features – Used for crypto APIs (randomUUID, subtle crypto) in mitigation utilities.
- **PLT-002**: VS Code webview sandboxing – Relies on postMessage origin checks and CSP enforcement.

### Compliance Dependencies

- **COM-001**: Privacy policy (SP-027) – Governs handling of sensitive data when modeling disclosure threats.
- **COM-002**: Retry & backoff strategy (SP-037) – Ensures denial-of-service mitigations respect rate limiting and recovery patterns.

## 9. Examples & Edge Cases

```typescript
import { validateThreatRecord } from "../security/threat-register";

const threatRecord = {
  threatId: "VP-THR-012",
  title: "Cross-context message injection",
  stride: "T",
  asset: "MessageRouter",
  description: "Malicious webview script sends forged ui.command.invoke payload.",
  dreadScore: 68,
  mitigations: [
    { spec: "SP-050", control: "SEC-001", verification: "test:envelope-origin-check" },
    { spec: "SP-027", control: "LOG-001", verification: "test:privacy-logging" }
  ],
  residualRisk: "Low",
  status: "Mitigated",
  owner: "SecurityTeam",
  reviewCadence: "pre-release"
};

await validateThreatRecord(threatRecord);
```

Edge cases to validate:

- Threat entries marked `Accepted` must reference executive approval metadata before release.
- Replay scenarios executed during long-lived sessions ensure expired keys cannot authorize new sessions.
- Supply chain threat analysis handles compromised npm dependency with remediation workflow (pin, audit, notify).
- Privacy downgrade tests verify retention shortening does not break existing purge guarantees.

## 10. Validation Criteria

- Threat register JSON validates against schema with zero errors in CI.
- Security regression suites covering credential theft, replay, and injection scenarios pass for each release candidate.
- Manual tabletop exercises occur at least quarterly with documented outcomes and mitigation updates.
- Release checklist confirms no open High residual risk threats prior to publishing extension updates.

## 11. Related Specifications / Further Reading

- [sp-003-spec-security-secret-storage.md](sp-003-spec-security-secret-storage.md)
- [sp-004-spec-architecture-ephemeral-key-service.md](sp-004-spec-architecture-ephemeral-key-service.md)
- [sp-005-spec-design-session-management.md](sp-005-spec-design-session-management.md)
- [sp-006-spec-architecture-webrtc-audio.md](sp-006-spec-architecture-webrtc-audio.md)
- [sp-027-spec-security-privacy-data-handling.md](sp-027-spec-security-privacy-data-handling.md)
- [sp-050-spec-architecture-message-contracts.md](sp-050-spec-architecture-message-contracts.md)
- [Microsoft SDL Threat Modeling](https://learn.microsoft.com/en-us/security/engineering/threat-modeling-tool)
