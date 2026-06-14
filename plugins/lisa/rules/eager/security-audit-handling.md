# Security Audit Handling (load-bearing)

If `git push` fails because the pre-push hook reports security vulnerabilities, follow the rules below. **Never use `--no-verify`**, `HUSKY=0`, `core.hooksPath`, or any other hook bypass to skip the security audit.

## Fix before ignore

1. Fix the root cause first: upgrade or override the actually-vulnerable leaf package to a patched compatible version, regenerate the lockfile, and retry the gate.
2. Only if no safe fix exists, ask the user to make the risk-acceptance decision. Add a narrow documented ignore for the specific advisory, package, and reason.
3. Never add a blanket audit bypass, lower an audit level, or self-approve a new risk-acceptance entry.

## Core rule

Override the actually-vulnerable **leaf package**, not its parent. The audit chain shows `parent › intermediate › vulnerable` — only the vulnerable leaf needs the override.

**Never override a parent package to force a lower major version.** Other packages may depend on the newer major; a forced downgrade breaks them.

Before adding any override, verify:
- You are targeting the actually-vulnerable package, not a parent in the chain.
- The override is compatible with all dependents (check via `bun why <pkg>` or `npm ls <pkg>`).
- The override does not downgrade across a major version boundary other deps require.

## Node.js (GHSA)

1. Note GHSA ID, package, advisory URL.
2. If a patched version exists: add a resolution AND override in `package.json` for the leaf package, regenerate the lockfile, commit, retry.
3. If no patch but safe (transitive, no untrusted input, dev/build only): ask the user to make the risk-acceptance decision, then add an exclusion to `audit.ignore.local.json` with `{"id", "package", "reason"}`, commit, retry.

## Rails (bundler-audit)

1. Note advisory ID, gem, URL.
2. If direct dep with patch: update Gemfile constraint, `bundle update <gem>`, commit, retry.
3. If transitive with patch: `bundle update <gem>` to bump the lockfile only, commit, retry.
4. If no patch but safe: document the exception, retry.

Full procedure with examples: [reference/security-audit-handling.md](../reference/security-audit-handling.md).
