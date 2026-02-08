Run an OWASP ZAP baseline security scan locally using Docker.

Steps:
1. Check if Docker is installed and running: `docker info`
2. Check if `scripts/zap-baseline.sh` exists in the project
3. If it exists, run: `bash scripts/zap-baseline.sh`
4. If it does not exist, inform the user that this project does not have a ZAP baseline scan configured
5. After the scan completes, read `zap-report.html` (or `zap-report.md` for text) and summarize:
   - Total number of alerts by risk level (High, Medium, Low, Informational)
   - List each Medium+ finding with its rule ID, name, and recommended fix
   - Categorize findings as "infrastructure-level" (fix at CDN/proxy) vs "application-level" (fix in code)
6. If the scan failed, explain what failed and suggest concrete remediation steps
