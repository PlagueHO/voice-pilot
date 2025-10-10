# Changelog

All notable changes to the VoicePilot VS Code extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial VS Code extension structure
- Azure OpenAI GPT Realtime API integration for speech-to-text and text-to-speech
- GitHub Copilot Chat integration for voice-driven coding assistance
- Voice session management with conversation state tracking
- Configurable Azure OpenAI endpoint and deployment settings
- Audio input/output device configuration
- Voice command sensitivity and timeout settings
- GitHub repository integration settings
- Extension security and authentication framework
- Comprehensive test suite with unit and integration tests
- Webpack bundling for optimized extension packaging
- CI/CD pipeline with GitHub Actions
- Infrastructure as Code with Azure Bicep templates

### Changed

- Updated package.json to exclude unnecessary files from extension packaging
- Configured webpack for production builds to reduce extension size
- Optimized TypeScript compilation for ES2022 target
- Upgraded Mocha test runner to 11.7.4, removed redundant `@types/mocha`, and standardized tooling on Node.js 22.12.0 (minimum supported runtime is now 20.19.0)

### Security

- Implemented secure credential storage using VS Code SecretStorage
- Added npm audit checks in CI pipeline
- Configured Semgrep and Trivy security scanning
- Added secret detection with TruffleHog

## [0.1.0] - TBD

### Features

- Initial release of VoicePilot extension
- Voice interaction with GitHub Copilot using Azure OpenAI Realtime API
- Basic voice session management
- Configuration management for Azure services
- Essential VS Code extension commands and views

---

## Template for Future Releases

Use this template when adding new releases:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added

- New features

### Changed

- Changes in existing functionality

### Deprecated

- Soon-to-be removed features

### Removed

- Now removed features

### Fixed

- Any bug fixes

### Security

- In case of vulnerabilities
```

## Release Types

- **Major (X.0.0)**: Breaking changes, major new features
- **Minor (X.Y.0)**: New features, backward compatible
- **Patch (X.Y.Z)**: Bug fixes, backward compatible

## Links

- [Repository](https://github.com/PlagueHO/voice-pilot)
- [Issues](https://github.com/PlagueHO/voice-pilot/issues)
- [Releases](https://github.com/PlagueHO/voice-pilot/releases)
