# OWASP ZAP Baseline Scanning

OWASP ZAP (Zed Attack Proxy) performs DAST (Dynamic Application Security Testing) by scanning a running application for common security vulnerabilities from the OWASP Top 10.

## When to Use

- After making changes to HTTP headers, authentication, or security middleware
- Before deploying to staging or production
- When reviewing security scan results from CI
- When triaging ZAP findings from pull request checks

## Running Locally

```bash
# Requires Docker to be installed and running
bash scripts/zap-baseline.sh
```

The scan builds the Expo web export, serves it locally, and runs ZAP against it. Reports are saved to `zap-report.html`, `zap-report.json`, and `zap-report.md`.

## Interpreting Results

ZAP findings are categorized by risk level:

| Risk | Action |
|------|--------|
| **High** | Fix immediately — indicates exploitable vulnerability |
| **Medium** | Fix before deployment — security best practice violation |
| **Low** | Fix when convenient — minor security improvement |
| **Informational** | Review — may be false positive or acceptable risk |

## Common Findings and Fixes

### Infrastructure-Level (fix at CDN/hosting, not in code)

- **CSP Header Not Set**: Configure Content-Security-Policy at CDN or hosting platform. Expo web exports need `script-src 'self' 'unsafe-inline'` for hydration.
- **HSTS Not Set**: Configure Strict-Transport-Security at CDN/load balancer.
- **X-Frame-Options**: Use `frame-ancestors` in CSP at CDN level.

### Application-Level (fix in code)

- **Cookie flags missing**: Ensure all cookies set `HttpOnly`, `Secure`, and `SameSite` attributes.
- **Debug error messages**: Ensure error boundaries don't leak stack traces in production.
- **Server version disclosure**: Remove or mask the `Server` response header.

## Configuration

ZAP scan rules are configured in `.zap/baseline.conf`. Each line controls how ZAP treats a specific rule:

- `IGNORE`: Skip the rule entirely
- `WARN`: Report finding but don't fail the build
- `FAIL`: Fail the build if this finding is detected

## CI Integration

ZAP runs automatically in CI via the `zap-baseline.yml` workflow. Results are uploaded as artifacts and the build fails on medium+ severity findings.
