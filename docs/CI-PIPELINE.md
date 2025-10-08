# Enhanced CI/CD Pipeline Documentation

## Overview

The VoicePilot project now includes a comprehensive CI/CD pipeline with enhanced testing, security scanning, and quality assurance capabilities.

## Pipeline Jobs

### 1. Static Analysis

- **Purpose**: Code quality and compilation validation
- **Runs**: ESLint, TypeScript compilation, code cleanliness checks
- **Blocks Pipeline**: Yes (critical job)

### 2. Quality Gate Sequence

- **Purpose**: Enforces the layered lint → unit → integration → performance flow defined in `sp-039-spec-process-testing-strategy.md`
- **Runs**: VS Code task `Quality Gate Sequence` via `scripts/run-quality-gate.mjs`, covering `Lint Extension`, `Test Unit`, `Test Extension`, `Test All`, `Test Coverage`, and `Test Performance`
- **Runtime Guard**: Aborts if cumulative runtime exceeds **15 minutes** (CON-001)
- **Outputs**:
  - `telemetry/gate-report.json` — sanitized task telemetry matching the spec schema
  - `coverage/coverage-summary.json` — NYC report enforcing ≥90% statements / ≥85% branches
  - `.vscode-test/` — raw extension host logs for debugging
- **Blocks Pipeline**: Yes (critical quality gate)

### 3. Extension Validation

- **Purpose**: VS Code extension packaging and manifest validation
- **Runs**: Extension packaging, manifest checks, size validation
- **Blocks Pipeline**: Yes (critical job)

### 4. Security Scan

- **Purpose**: Comprehensive security analysis
- **Tools**:
  - npm audit (dependency vulnerabilities)
  - Semgrep (code security patterns)
  - TruffleHog (secret detection)
  - Trivy (dependency scanning)
- **Blocks Pipeline**: No (informational)

### 5. VS Code Compatibility Test

- **Purpose**: Multi-version compatibility testing
- **Versions Tested**: 1.104.0, 1.105.0, stable
- **Features**: Matrix testing with isolated environments
- **Blocks Pipeline**: No (compatibility validation)

### 6. Code Quality

- **Purpose**: Advanced code quality metrics
- **Runs**: TypeScript config validation, build metadata generation
- **Blocks Pipeline**: No (quality metrics)

### 7. Performance Benchmarks

- **Purpose**: Performance regression detection
- **Features**: Startup time measurement, benchmark artifacts
- **Blocks Pipeline**: No (performance tracking)

### 8. CI Summary

- **Purpose**: Overall pipeline status reporting
- **Features**: Job status matrix, critical failure detection
- **Runs**: Always (after all jobs complete)

## New NPM Scripts

```bash
# Enhanced testing
npm run test:headless     # Run tests with xvfb (Linux)
npm run test:coverage     # Run tests with coverage reporting
npm run test:perf         # Run performance benchmarks
npm run quality:gate      # Execute lint/test/perf gate sequence with telemetry

# Security
npm run security:audit    # Run npm audit
npm run security:check    # Comprehensive security check

# Packaging
npm run package:check     # Validate extension packaging
```

## Artifacts Generated

### Test & Telemetry Artefacts

- **quality-gate-telemetry**: `telemetry/gate-report.json`, NYC coverage summary, and `.vscode-test/` logs
- **compatibility-test-results-{version}**: Version-specific test results
- **performance-results-{run}**: Performance benchmark data

### Build Outputs

- **compiled-extension**: TypeScript compiled output
- **build-outputs-{run}**: Complete build artifacts with metadata
- **voicepilot-extension-{run}**: Packaged VSIX file

### Security Reports

- **Semgrep SARIF**: Code security analysis results
- **Trivy SARIF**: Dependency vulnerability reports

## Configuration Files

### Test Configuration

- `.vscode-test.js`: VS Code test runner configuration
- `.nycrc.json`: Code coverage configuration

### Quality Configuration

- `eslint.config.js`: Modern ESLint v9 configuration
- `tsconfig.json`: TypeScript compilation settings

## Pipeline Behavior

### Pull Requests

- All jobs run in parallel where possible
- Critical jobs (static-analysis, quality gate, extension-validation) must pass
- Quality gate telemetry is uploaded for inspection when the gate succeeds or fails
- Azure-dependent suites tagged `[requiresAzure]` skip automatically when credentials are unavailable, with reasons recorded in telemetry
- Security and compatibility jobs provide information but don't block

### Main Branch

- Full pipeline execution
- All artifacts are stored
- Performance benchmarks are tracked
- Build metadata is generated

## Local Development

### Running Enhanced Tests Locally

```bash
# Install additional dependencies
npm install

# Run tests with coverage
npm run test:coverage

# Run security checks
npm run security:check

# Test packaging
npm run package:check
```

### Debugging CI Issues

1. Check job logs in GitHub Actions
2. Download test result artifacts
3. Review security scan outputs
4. Check VS Code compatibility matrices

## Benefits

1. **Reliability**: Proper headless testing eliminates false failures
2. **Security**: Comprehensive scanning catches vulnerabilities early
3. **Compatibility**: Multi-version testing ensures broad VS Code support
4. **Performance**: Automated benchmarking prevents regressions
5. **Quality**: Enhanced validation catches issues before release
6. **Visibility**: Detailed reporting and artifacts for debugging

## Future Enhancements

- Code coverage trending and reporting
- Performance regression alerts
- Automated dependency updates
- Integration with VS Code Marketplace publishing
