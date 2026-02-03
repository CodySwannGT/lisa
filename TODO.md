# Black Box Invariant Enforcement — Lisa Additions

Enforcement capabilities Lisa can add to govern AI-generated artifacts against the seven invariants.

## Observable Invariant

- [ ] Force `@opentelemetry/sdk-node` (or stack-appropriate SDK) as a required dependency via `package.lisa.json`
- [ ] Force `@sentry/node` (or `@sentry/react-native` for Expo) as a required dependency via `package.lisa.json`
- [ ] Add ast-grep rule to detect and ban bare `console.log` usage, enforcing structured logging instead
- [ ] Add ast-grep rule to verify OpenTelemetry SDK initialization exists in application entry points
- [ ] Add ast-grep rule to verify Sentry SDK initialization exists in application entry points
- [ ] Add integration test template requiring a health check endpoint exists and returns structured status


## Auditable Invariant

- [ ] Add SBOM generation step (e.g., Syft or CycloneDX) to CI/CD workflow templates
- [ ] Add Sigstore cryptographic signing to release workflows

