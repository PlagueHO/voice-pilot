# Pull Request Summary

<!--
High-level overview of the change: what problem does this solve?
Include 1–3 bullet points of impact if possible.
-->

## Type of Change

<!-- Select all that apply -->
- [ ] Feature
- [ ] Bug Fix
- [ ] Refactor / Tech Debt
- [ ] Documentation
- [ ] Test / CI
- [ ] Infrastructure (Bicep / Azure)
- [ ] Performance
- [ ] Other (specify below)

## Areas Affected

<!-- Tick all relevant architecture components touched by this PR -->
- [ ] Extension Activation / Lifecycle (`src/extension.ts`)
- [ ] Audio Capture / STT (`src/audio/`)
- [ ] Text-to-Speech (`src/audio/ttsService.ts`)
- [ ] Copilot Integration (`src/copilot/`)
- [ ] Codebase Context / Search (`src/codebase/`)
- [ ] GitHub Integration (`src/github/`)
- [ ] Session / State Management (`src/session/`)
- [ ] Configuration / Settings (`src/config/`)
- [ ] Services / Core Infrastructure (`src/services/`, `src/core/`)
- [ ] UI Components (`src/ui/`)
- [ ] Infrastructure as Code (`infra/` Bicep)
- [ ] Documentation (`README.md`, `docs/`, design specs)
- [ ] Security / Secrets Handling
- [ ] Logging / Observability
- [ ] Other (specify below)

## Detailed Description

<!--
Explain the implementation details, notable decisions, and any alternative approaches considered.
Reference relevant files or design docs (e.g., docs/design/* or plan/*) where helpful.
-->

## Testing

<!-- Describe how you tested this change. Include: -->
<!-- - Unit tests added/updated (list files) -->
<!-- - Manual test scenarios (voice flow, Copilot chat, issue creation) -->
<!-- - Any audio device / platform variations tested -->
<!-- - If infrastructure: bicep build/validate results -->

- [ ] Unit tests passing (`npm test`)
- [ ] Lint clean (`npm run lint`)
- [ ] Extension loads in Dev Host (F5)
- [ ] Voice input path validated
- [ ] TTS output verified
- [ ] Copilot chat interaction works
- [ ] GitHub issue creation flow tested (if applicable)
- [ ] Infrastructure compiled (`Build Bicep` task) (if applicable)

## Backwards Compatibility / Risk

<!-- List any breaking changes, migrations, new settings, or user-facing behavior shifts. -->

## Security / Privacy Considerations

<!-- Any handling of API keys, secrets storage, audio data retention, network calls? -->

## Documentation Updates

<!--
Tick/describe where docs were updated or if N/A.
-->
- [ ] README
- [ ] AGENTS.md / architecture docs
- [ ] Design docs in `docs/design/`
- [ ] User-facing instructions
- [ ] Not required

## Related Issues / Tracking

<!-- e.g. Closes #123, Relates to #456 -->

## Additional Notes

<!-- Anything else reviewers should know (perf metrics, follow-up tasks, out-of-scope items). -->
