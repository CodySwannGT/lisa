---
name: lisa-security-review
description: "Security review methodology. STRIDE threat modeling, OWASP Top 10 vulnerability checks, auth/validation/secrets handling review, and mitigation recommendations."
---

# Security Review

Identify vulnerabilities, evaluate threats, and recommend mitigations for code changes.

## Analysis Process

1. **Read affected files** -- understand current security posture of the code being changed
2. **STRIDE analysis** -- evaluate Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege risks
3. **Check input validation** -- are user inputs sanitized at system boundaries?
4. **Check secrets handling** -- are credentials, tokens, or API keys exposed in code, logs, or error messages?
5. **Check auth/authz** -- are access controls properly enforced for new endpoints or features?
6. **Review dependencies** -- do new dependencies introduce known vulnerabilities?

## The impact-or-exploitability bar

Severity is **earned, not pattern-matched**. Every security-shaped finding is classified
mechanically, before it is written up:

| Field | What it holds |
|-------|---------------|
| `reproducer` | an evidence ref of a kind that reaches the claim's boundary, or `none` |
| `impact` | a bounded impact/exploitability statement (who can do what, to what data, under what preconditions), or `unproven` |
| `reason` | one line saying why the finding landed in its bucket |

**The bar:** a finding is **proven** only when it carries **both** a reproducer **and** a bounded
impact statement. **Missing either ⇒ unproven.** No other input changes the bucket.

What counts as a reaching reproducer is defined by the `claim-evidence-mapping` contract, not here:
an injection claim at the `http-api` boundary needs an `http-transcript`; a UI claim needs a
`screenshot` or `recording`. A passing unit `test-run-log` reaches `code-unit` only and never
discharges either.

## The two buckets — conservative by default

Findings render in two clearly-labeled buckets: **Security (proven)** and **Security (unproven)**.

A reproducer-less finding **stays in the security section**, labeled `unproven` with its reason. It
is **never auto-demoted** to a `maintenance` bucket and it is **not removed** from the report —
under-reporting a real vulnerability is the worse failure, so the conservative default keeps it
visible where a security reader looks.

**Single policy point.** The unproven bucket's label is the only thing an owner may change:
`security.review.unprovenBucket` in `.lisa.config.json`, default `security-unproven`. An owner who
prefers true demotion sets it to a maintenance label; the finding then renders under that bucket and
**no other classification logic changes** — the bar, the fields, and the reasons are identical.

Write both buckets in operator voice (`factory-model` rule 5): a person who does not code reads this
at the gate. "Anyone who can reach the search box can read other customers' orders — reproduced with
the request transcript below" is usable; "possible SQLi in handler" is not.

This bar governs *code-review* security findings. Dependency CVE remediation keeps its own decision
ladder in the `security-audit-handling` rule — cite it, do not restate or fork it.

Bucketing is **advisory** — it shapes the report, it does not block a merge — on the same terms as
the boundary checks, which stay reporting-only until `verification.gate.enforceBoundaries` is `true`
in `.lisa.config.json`.

## Output Format

Structure findings as:

```
## Security Analysis

### Threat Model (STRIDE)
| Threat | Applies? | Description | Mitigation |
|--------|----------|-------------|------------|
| Spoofing | Yes/No | ... | ... |
| Tampering | Yes/No | ... | ... |
| Repudiation | Yes/No | ... | ... |
| Info Disclosure | Yes/No | ... | ... |
| Denial of Service | Yes/No | ... | ... |
| Elevation of Privilege | Yes/No | ... | ... |

### Security Checklist
- [ ] Input validation at system boundaries
- [ ] No secrets in code or logs
- [ ] Auth/authz enforced on new endpoints
- [ ] No SQL/NoSQL injection vectors
- [ ] No XSS vectors in user-facing output
- [ ] Dependencies free of known CVEs

### Security (proven)
- [finding] -- where in the code, how to prevent
  - reproducer: [evidence ref, e.g. evidence/<ticket>/http-transcript-01.txt]
  - impact: [who can do what, to what data, under what preconditions]
  - reason: reproducer + bounded impact

### Security (unproven)
- [finding] -- where in the code, how to prevent
  - reproducer: none
  - impact: unproven
  - reason: no reproducer / no bounded impact -- kept in the security section, not demoted

### Recommendations
- [recommendation] -- priority (critical/warning/suggestion)
```

Rename the unproven heading only when `security.review.unprovenBucket` is set to something other
than `security-unproven`; everything else stays as written.

## Rules

- Focus on the specific changes proposed, not a full security audit of the entire codebase
- Flag only real risks -- do not invent hypothetical threats for internal tooling with no user input
- Classify every finding against the bar before writing it up; never leave a finding unbucketed
- Never silently drop or downgrade a finding out of the security section -- `unproven` is the
  conservative landing spot, and the reason line says why
- Prioritize OWASP Top 10 vulnerabilities
- If the changes are purely internal (config, refactoring, docs), report "No security concerns" and explain why
- Always check `.gitleaksignore` patterns to understand what secrets scanning is already in place
