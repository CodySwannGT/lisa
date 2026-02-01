# Black Box Invariant Enforcement — Lisa Additions

Enforcement capabilities Lisa can add to govern AI-generated artifacts against the seven invariants.

## Observable Invariant

- [ ] Force `@opentelemetry/sdk-node` (or stack-appropriate SDK) as a required dependency via `package.lisa.json`
- [ ] Force `@sentry/node` (or `@sentry/react-native` for Expo) as a required dependency via `package.lisa.json`
- [ ] Add ast-grep rule to detect and ban bare `console.log` usage, enforcing structured logging instead
- [ ] Add ast-grep rule to verify OpenTelemetry SDK initialization exists in application entry points
- [ ] Add ast-grep rule to verify Sentry SDK initialization exists in application entry points
- [ ] Add integration test template requiring a health check endpoint exists and returns structured status

## Secure Invariant

- [ ] Add ZAP (OWASP) DAST scanning to CI/CD workflow templates
- [ ] Add FOSSA license compliance scanning to CI/CD workflow templates
- [ ] Add Snyk dependency scanning to CI/CD workflow templates (if not already present)
- [ ] Add GitGuardian secrets scanning to CI/CD workflow templates (if not already present)

## Auditable Invariant

- [ ] Add SBOM generation step (e.g., Syft or CycloneDX) to CI/CD workflow templates
- [ ] Add Sigstore cryptographic signing to release workflows

## Scalable Invariant

- [ ] Add k6 load test templates that validate system-level scalability (not just performance SLOs)
- [ ] Add k6 stress/spike/soak test scenarios to NestJS stack templates (if not already present)

## Performant Invariant

- [ ] Add Lighthouse CI threshold enforcement to Expo stack CI workflows (if not already present)
- [ ] Add k6 smoke test with SLO assertions to NestJS stack CI workflows (if not already present)
