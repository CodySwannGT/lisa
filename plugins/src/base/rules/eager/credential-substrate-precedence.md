# Credential-Substrate Precedence (load-bearing)

**When more than one substrate can reach an external system, the configured credentials
provider's token/CLI path goes first and the interactive MCP is the fallback — and
identity-match verification is mandatory on every substrate, at every tier.**

**One shared, vendor-neutral contract cited by every `*-access` skill** (the
`leaf-only-lifecycle` / `repo-scope-split` precedent: one shared slug, never divergent
per-skill prose). An access skill states its per-vendor mechanics — which token, which
CLI, which identity anchor — and cites this rule for the ordering. It never restates,
narrows, or locally overrides that ordering.

Settled by decision record `2026-08-12-credential-substrate-precedence` (D6), and
settled in the `settled-decisions` sense: re-arguing MCP-first inside a skill is out of
scope for that skill's work.

## The ladder

1. **Tier 1 — configured-provider substrate.** The token or CLI path fed by
   `lisa-secrets-access`, chosen whenever its bootstrap credential is available **and**
   the resolved substrate identity-matches the configured tenant/workspace/site.
   `lisa-secrets-access` is the single chokepoint — never read an OS keychain a second
   time. The two legacy OS-keychain rungs that remain (`lisa-atlassian-access`,
   `lisa-notion-access`) are a dated migration ramp with a **removal date of
   2026-11-01**, not a standing exemption; no new access skill may add one.
2. **Tier 2 — interactive MCP**, used only when tier 1 is *genuinely* unavailable:
   no bootstrap, no adapter for the operation (per-operation, not per-session), or a
   provider outage. "The MCP happens to be authenticated" and "tier 1 is slower" are
   **not** qualifying reasons.
3. **Tier 3 — loud, actionable failure** naming the exact credential to set and the exact
   remediation. Never silently no-op, never blind-retry a failed or absent substrate,
   never fall through to one that failed identity-match.

## Identity-match is mandatory on every substrate

Verified **in both directions** before any operation: the substrate must claim the
configured tenant, and the configured tenant must be one the substrate can reach. A
substrate authenticated as a different account is **skipped, never used — including at
tier 1**. A credential is not an identity claim; the identity claim is what the provider
says when asked. Skipping the check because "the user obviously meant this workspace" is
forbidden.

## Mutating operations: fallback is guarded, never routine

Falling back to an ambient-bound substrate for a **write** requires: switch profile and
assert identity immediately before the write → write → re-read the affected objects →
assert the tenant **from the response** (self URL host, cloudId in the path, response
metadata), not from the pre-flight check → on mismatch, stop, report a cross-tenant
hazard, and best-effort roll back. A successful pre-flight switch is not sufficient:
another process can mutate global state between the check and the write.

Full contract (per-vendor identity anchors and probes, the provider-first rationale, MCP's
first-class fallback role, consequences, and the checklist for adding or editing an access
skill): [reference/credential-substrate-precedence.md](../reference/credential-substrate-precedence.md).
