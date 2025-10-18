---
title: WebRTC Negotiation Attack Tree
version: 1.0
date_created: 2025-10-18
last_updated: 2025-10-18
owner: VoicePilot Security Engineering
tags: [security, webrtc, attack-tree]
---

## Overview

This attack tree enumerates adversarial strategies targeting WebRTC negotiation for VoicePilot realtime sessions and maps each branch to mitigations defined in `sp-056-spec-architecture-security-threat-model.md`, `sp-006-spec-architecture-webrtc-audio.md`, and related specifications.

## Root Goal

- **R-001**: Compromise WebRTC session integrity between VoicePilot webview and Azure OpenAI GPT Realtime endpoint.

## Level 1 Branches

1. **B1**: Force insecure transport or downgrade DTLS protections.
2. **B2**: Inject malicious ICE candidates to achieve man-in-the-middle access.
3. **B3**: Replay or reuse stale SDP/ephemeral key material to hijack established sessions.

## Branch B1: DTLS Downgrade

| Node | Description | Mitigations |
|------|-------------|-------------|
| B1.1 | Mutate SDP offer/answer to remove DTLS-SRTP fingerprints. | SP-006 `SEC-004`, SP-056 `REQ-001` |
| B1.2 | Strip `requireDtls` flags during negotiation handshake. | SP-006 `REQ-005`, SP-056 `AC-004` |
| B1.3 | Replace cipher suites with weaker alternatives accepted by legacy stacks. | SP-006 `GUD-001`, SP-056 `PAT-001` |

## Branch B2: Malicious ICE Candidates

| Node | Description | Mitigations |
|------|-------------|-------------|
| B2.1 | Inject attacker-controlled TURN relay candidates. | SP-006 `CONN-001`, SP-056 `REQ-003` |
| B2.2 | Supply private-network host candidates to coerce local breakout. | SP-006 `CON-001`, SP-056 `SEC-004` |
| B2.3 | Flood with low-priority candidates to trigger connection timeout. | SP-006 `ERR-001`, SP-056 `AC-004` |

## Branch B3: SDP / Ephemeral Replay

| Node | Description | Mitigations |
|------|-------------|-------------|
| B3.1 | Replay captured SDP answers with valid but expired client_secret. | SP-004 `SEC-007`, SP-056 `REQ-003` |
| B3.2 | Clone SDP payload to parallel session with reused sessionId. | SP-005 `REQ-004`, SP-056 `SEC-003` |
| B3.3 | Exfiltrate client_secret from compromised webview context. | SP-003 `SEC-001`, SP-056 `THR-001` |

## Residual Risk Notes

- Residual risk for DTLS downgrade scenarios is **Medium** post-mitigation due to reliance on upstream Azure enforcement.
- Malicious ICE injection remains **Medium** pending completion of automated candidate whitelisting in WebRTC transport implementation.
- Replay threats reduce to **Low** when session renewal tests (`test:ephemeral-key-replay-block`) pass in CI.

## Validation

- Ensure `test:webrtc-dtls-downgrade` and `test:session-recovery-ice-poison` run in security regression pipeline.
- Manual tabletop: verify Azure SDP fingerprints when new regions or codec packs are onboarded.
