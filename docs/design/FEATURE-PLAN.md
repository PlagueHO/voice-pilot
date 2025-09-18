---
title: Feature Plan & Roadmap
version: 1.0
date_created: 2025-09-19
last_updated: 2025-09-19
owner: VoicePilot Project
tags: [process, backlog, roadmap]
---

## Feature Plan

This document lists all planned features in implementation phase order. It will be used as a living TODO list. Update the Status column as features are authored (Pending → In Progress → Review → Approved → Updated).

| Phase | ID | Title | Type | Purpose (Concise) | Spec Filename | Status |
|-------|----|-------|------|-------------------|---------------|--------|
| 1 | SP-001 | Core Extension Activation & Lifecycle | architecture | Activation events, command wiring, teardown | spec-architecture-extension-lifecycle.md | Pending |
| 1 | SP-002 | Configuration & Settings Management | design | Settings schema, validation, change handling | spec-design-configuration-management.md | Pending |
| 1 | SP-003 | Secret Storage & Credential Handling | security | Secure storage & retrieval boundaries | spec-security-secret-storage.md | Pending |
| 1 | SP-004 | Ephemeral Key Service (Azure Realtime) | architecture | Mint & rotate ephemeral session keys | spec-architecture-ephemeral-key-service.md | Pending |
| 1 | SP-005 | Session Management & Renewal | design | Session lifecycle & timers | spec-design-session-management.md | Pending |
| 1 | SP-006 | WebRTC Audio Transport Layer | architecture | Peer connection, SDP, reconnection | spec-architecture-webrtc-audio.md | Pending |
| 1 | SP-007 | Microphone Capture & Audio Pipeline | design | Capture, preprocess, stream formats | spec-design-audio-capture-pipeline.md | Pending |
| 1 | SP-009 | Speech-to-Text Integration (Realtime STT) | tool | Transcript events & error recovery | spec-tool-realtime-stt.md | Pending |
| 1 | SP-010 | Text-to-Speech Output (Azure Speech) | tool | Streaming synthesis & interruption | spec-tool-text-to-speech.md | Pending |
| 1 | SP-012 | Conversation State Machine | architecture | Formal state diagram & transitions | spec-architecture-conversation-state-machine.md | Pending |
| 1 | SP-013 | UI Sidebar Panel & Layout | design | Panel structure & interaction model | spec-design-ui-sidebar-panel.md | Pending |
| 1 | SP-014 | Status / Presence Indicators | design | Indicator semantics & update rules | spec-design-status-indicators.md | Pending |
| 1 | SP-027 | Privacy & Data Handling Policy | security | Retention & masking rules | spec-security-privacy-data-handling.md | Pending |
| 1 | SP-028 | Error Handling & Recovery Framework | architecture | Error taxonomy & retry hooks | spec-architecture-error-handling.md | Pending |
| 1 | SP-031 | Security Role & Permission Model (Azure) | infrastructure | RBAC & least privilege roles | spec-infrastructure-security-roles.md | Pending |
| 1 | SP-032 | Infrastructure Provisioning (Bicep Modules) | infrastructure | Resource & module definitions | spec-infrastructure-bicep-provisioning.md | Pending |
| 1 | SP-033 | Azure Resource Configuration Policies | infrastructure | Region, SKU, encryption constraints | spec-infrastructure-azure-resource-policies.md | Pending |
| 1 | SP-034 | Key Vault Integration & Secret Sync | design | Secret flow & retrieval patterns | spec-design-key-vault-integration.md | Pending |
| 1 | SP-035 | Audio Format & Codec Standards | design | PCM16, sample rate, buffers | spec-design-audio-codec-standards.md | Pending |
| 1 | SP-037 | Retry & Backoff Strategy | process | Standardized backoff profiles | spec-process-retry-backoff.md | Pending |
| 1 | SP-039 | Testing & QA Strategy | process | Test levels & coverage goals | spec-process-testing-strategy.md | Pending |
| 1 | SP-040 | CI/CD Pipeline & Quality Gates | process | Build, lint, package, scan gates | spec-process-cicd-pipeline.md | Pending |
| 1 | SP-050 | Data Contracts (Message Passing) | architecture | Host ↔ webview schemas & versioning | spec-architecture-message-contracts.md | Pending |
| 1 | SP-053 | Resource Cleanup & Disposal Semantics | design | Deterministic teardown rules | spec-design-resource-cleanup.md | Pending |
| 1 | SP-056 | Security Threat Model & Mitigations | security | Threat enumeration & controls | spec-security-threat-model.md | Pending |
| 2 | SP-008 | Voice Activity Detection (VAD) | algorithm | Speech detection thresholds & debounce | spec-algorithm-voice-activity-detection.md | Pending |
| 2 | SP-011 | Interruption & Turn-Taking Engine | design | Speaking ↔ listening transitions | spec-design-interruption-management.md | Pending |
| 2 | SP-015 | Audio Feedback & Sound Design | design | Sound taxonomy & triggers | spec-design-audio-feedback.md | Pending |
| 2 | SP-017 | Intent Processing & Classification | algorithm | Map transcripts to intents | spec-algorithm-intent-processing.md | Pending |
| 2 | SP-018 | Language Model Adapter (Copilot) | architecture | Model selection & prompting | spec-architecture-language-model-adapter.md | Pending |
| 2 | SP-019 | Prompt & Context Injection Strategy | design | Message assembly rules | spec-design-prompt-context-strategy.md | Pending |
| 2 | SP-020 | Project Context Extraction | design | Code & doc harvesting rules | spec-design-project-context-extraction.md | Pending |
| 2 | SP-021 | Specification Document Generation | process | Voice → structured spec workflow | spec-process-spec-document-generation.md | Pending |
| 2 | SP-022 | Requirements Extraction & Normalization | algorithm | Convert dialog to REQ/SEC/CON | spec-algorithm-requirements-extraction.md | Pending |
| 2 | SP-023 | Action Item & Task Derivation | algorithm | Identify actionable tasks | spec-algorithm-action-item-derivation.md | Pending |
| 2 | SP-024 | Code Manipulation & Editor Operations | design | Safe code edits & undo | spec-design-code-manipulation.md | Pending |
| 2 | SP-026 | Multi-Modal Transcript Management | design | Retention & redaction policy | spec-design-transcript-management.md | Pending |
| 2 | SP-029 | Logging & Telemetry (Local Only) | process | Event schema & PII scrubbing | spec-process-logging-telemetry.md | Pending |
| 2 | SP-030 | Performance & Latency Budget | process | Target latencies & ceilings | spec-process-performance-budget.md | Pending |
| 2 | SP-036 | Noise Reduction & Audio Filters | algorithm | Filtering algorithms & trade-offs | spec-algorithm-noise-reduction.md | Pending |
| 2 | SP-038 | Rate Limiting & Quota Safeguards | security | Throttle Azure & LM usage | spec-security-rate-limiting.md | Pending |
| 2 | SP-041 | Versioning & Release Management | process | Semver & changelog policy | spec-process-versioning-release.md | Pending |
| 2 | SP-042 | Configuration Validation & Diagnostics | tool | Self-check command behaviors | spec-tool-diagnostics-command.md | Pending |
| 2 | SP-043 | Settings Panel UI & Persistence | design | Visual layout & flows | spec-design-settings-panel.md | Pending |
| 2 | SP-045 | Planning Session Orchestration | architecture | Session segmentation & outputs | spec-architecture-planning-session.md | Pending |
| 2 | SP-046 | Document Template Library | tool | Parameterized spec templates | spec-tool-document-templates.md | Pending |
| 2 | SP-047 | Specification File Naming & Storage Rules | process | Naming & collision policy | spec-process-spec-file-naming.md | Pending |
| 2 | SP-052 | Privacy Redaction Rules (Transcripts) | security | Masking sensitive tokens | spec-security-redaction-rules.md | Pending |
| 2 | SP-054 | Metrics & Observability Schema | process | In-memory metrics definitions | spec-process-metrics-schema.md | Pending |
| 2 | SP-057 | Performance Profiling & Benchmark Harness | tool | Benchmark methodology & scripts | spec-tool-performance-benchmarking.md | Pending |
| 3 | SP-016 | Accessibility & Inclusive Interaction | process | ARIA & keyboard flows | spec-process-accessibility.md | Pending |
| 3 | SP-025 | GitHub Issue Creation & Linking | tool | Voice-triggered issue creation | spec-tool-github-issue-integration.md | Pending |
| 3 | SP-044 | Accessibility Audio Equivalents | design | Audio mapping for statuses | spec-design-accessibility-audio-mapping.md | Pending |
| 3 | SP-048 | User Command Grammar & Wake Word | design | Wake word & grammar rules | spec-design-command-grammar.md | Pending |
| 3 | SP-049 | Offline / Degraded Mode Behavior | design | Behavior without Azure | spec-design-degraded-mode.md | Pending |
| 3 | SP-051 | MCP / External Tool Context Inclusion | design | External context injection | spec-design-external-context-inclusion.md | Pending |
| 3 | SP-055 | User Onboarding & First-Run Flow | design | Initial setup walkthrough | spec-design-onboarding-flow.md | Pending |
| 3 | SP-059 | Feature Flag / Progressive Rollout | architecture | Toggle emerging features | spec-architecture-feature-flags.md | Pending |
| 3 | SP-060 | Compliance & Audit (Auditability Lite) | process | Minimal audit trail rules | spec-process-compliance-audit.md | Pending |
| 4 | SP-058 | Localization & Language Extensibility (Future) | design | Multi-language readiness | spec-design-localization-extensibility.md | Pending |

## Usage Instructions

1. When authoring a spec: change Status → In Progress.
2. After internal review: Status → Review, then → Approved.
3. For updates post-approval: increment version inside the spec and set Status → Updated (then revert to Approved after review).
4. Keep this index synchronized—do not remove completed rows.

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2025-09-19 | Initial backlog created | system |
