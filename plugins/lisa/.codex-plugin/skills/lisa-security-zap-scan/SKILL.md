---
name: lisa-security-zap-scan
description: "Run an OWASP ZAP baseline…"
allowed-tools: ["Bash", "Read"]
---

# OWASP ZAP Baseline Security Scan

Run a ZAP baseline security scan against the local application.

## Workflow

1. **Check prerequisites**:
   - Verify Docker is installed and running: `docker info`
   - Check if `scripts/zap-baseline.sh` exists in the project

2. **Execute scan**:
   - If the script exists, run: `bash scripts/zap-baseline.sh`
   - If the script does not exist, inform the user that this project does not have a ZAP baseline scan configured

3. **Analyze results**:
   - After the scan completes, read `zap-report.html` (or `zap-report.md` for text)
   - Summarize findings:
     - Total number of alerts by risk level (High, Medium, Low, Informational)
     - **Every alert reaches classification** -- High, Medium, Low, and Informational alike. Risk
       level orders the summary; it never filters it. **Nothing is dropped before classification**,
       so no alert can leave the report unclassified. Medium+ alerts are listed first, in full (rule
       ID, name, recommended fix); Low/Informational alerts are still listed, bucketed, and given a
       `reason`, even when compressed to one line each.
     - Categorize findings as "infrastructure-level" (fix at CDN/proxy) vs "application-level" (fix in code)

4. **Apply the impact-or-exploitability bar** -- the same bar the `lisa-security-review` skill
   defines; follow that skill, do not restate it. A ZAP alert is not a reproducer by itself: the
   alert names a pattern, not an exercised impact path.
   - **Security (proven)** -- the alert carries a reproducer **and** a bounded impact statement. The
     reproducer counts only if its evidence kind **reaches the claim's boundary** under the
     `claim-evidence-mapping` contract (BCE-1, #1835): a ZAP request/response transcript is an
     `http-transcript` and reaches the `http-api` boundary only. An alert whose claim is about
     rendered UI (`browser`) or persisted state (`data`) needs evidence at *that* boundary -- a
     transcript never proves it.
   - **Security (unproven)** -- everything else, each with a one-line `reason` (typically
     "alert only, no reproducer / no bounded impact", or "transcript does not reach the claim's
     boundary"). Unproven alerts are **not dropped** and not demoted out of the security summary --
     they render in the unproven bucket so a reader still sees them.
   - Rename the unproven heading only if `security.review.unprovenBucket` is set to something other
     than `security-unproven`; no other classification changes.

5. **Handle failures**:
   - If the scan failed, explain what failed and suggest concrete remediation steps

## Execution

Run the scan now.
