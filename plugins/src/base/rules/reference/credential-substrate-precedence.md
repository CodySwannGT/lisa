# Credential-Substrate Precedence

> Demoted from the always-on eager tier by CodySwannGT/lisa#3992. The
> section below is the former eager head, preserved verbatim; the full
> contract follows it. Reachable on demand via `rules/eager/00-rule-index.md`.

## Credential-Substrate Precedence (load-bearing)

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

---

**When more than one substrate can reach an external system, the configured credentials
provider's token/CLI path goes first and the interactive MCP is the fallback — and
identity-match verification is mandatory on every substrate, at every tier.**

This is **one shared, vendor-neutral contract cited by every `*-access` skill** (the
`leaf-only-lifecycle` / `repo-scope-split` precedent: one shared slug, never divergent
per-skill prose). An access skill states its per-vendor mechanics — which token, which
CLI, which identity anchor — and cites this rule for the ordering. It never restates,
narrows, or locally overrides the ordering.

Settled by the decision record `2026-08-12-credential-substrate-precedence` (D6). It is
a **settled decision** in the `settled-decisions` sense: re-arguing MCP-first inside a
skill is out of scope for that skill's work.

## The ladder

### Tier 1 — configured-provider substrate

The token or CLI path fed by `lisa-secrets-access`. Chosen **whenever its bootstrap
credential is available AND the resolved substrate identity-matches the configured
tenant/workspace/site.**

`lisa-secrets-access` is the single chokepoint that makes this tier actionable rather
than aspirational: it owns the one-store rule and the surface ladder, and its `tool:`
note line already declares which CLI a given credential is expected to drive. An access
skill resolves its credential through that chokepoint — never by reading an OS keychain
a second time.

Both halves of the gate are load-bearing. A present credential that identity-matches
nothing is **not** tier 1; it is a failed tier, and the ladder moves on.

### Tier 2 — interactive MCP

Used when the tier 1 path is **genuinely unavailable**. The three genuine cases:

- **No bootstrap** — the provider credential is absent or the project has not adopted a
  credentials provider at all.
- **No adapter for the operation** — the token/CLI substrate has no documented adapter
  for the requested operation, and the MCP does (per-operation, not per-session: a skill
  may resolve tier 1 for one operation and tier 2 for the next).
- **Provider outage** — the provider path is present but failing for reasons the caller
  cannot fix in-session.

"The MCP happens to be authenticated" is not one of them. Neither is "tier 1 is slower."

### Tier 3 — loud, actionable failure

When no substrate is both available and identity-matched, fail with a message naming the
exact credential to set and the exact remediation path. Never silently no-op, never
blind-retry a failed or absent substrate, and never fall through to a substrate that
failed identity-match.

## Identity-match is mandatory on every substrate

Verification runs **in both directions** before any operation: the substrate must claim
the configured tenant, and the configured tenant must be one the substrate can actually
reach. A substrate authenticated as a **different** account is **skipped, never used**,
regardless of tier — including tier 1. A credential is not an identity claim; the
identity claim is what the provider says when asked.

| Vendor | Identity anchor | Probe |
|---|---|---|
| Atlassian | `atlassian.cloudId` / `atlassian.site` | `/rest/api/3/myself` email, acli `auth status` site, MCP accessible-resources contains the cloudId |
| Notion | `notion.workspaceId` (+ `prdDatabaseId` reachability) | `GET /v1/users/me` → `bot.workspace_name`/`workspace_id` |
| Linear | `linear.workspace` / `linear.teamKey` | `viewer`/`organization` on GraphQL; team list through the MCP |
| Sentry / PostHog / Jam / Sonar | configured org + project | the substrate's own whoami/org listing |

Skipping the check because "the user obviously meant this workspace" is forbidden. Silent
cross-tenant operations are precisely the hazard this contract exists to prevent.

## Why provider-first (and why it overturns a working default)

MCP-first was defensible and is being overturned deliberately, not corrected as an
oversight. Three reasons outweigh it.

**Headless parity.** Cron runs, cloud sessions, CI, and subagent sessions have no
browser. Under MCP-first an interactive session and a headless session resolve through
*different* substrates and can therefore fail differently — and the failure surfaces only
in the environment nobody is watching. Provider-first makes the primary path the same one
everywhere, with MCP as the enhancement rather than the default.

**Tenant safety — the generalized Atlassian write rule.** Substrates differ in *where
their target comes from*:

- **Per-invocation-bound.** The target is part of the call. A cloudId-scoped REST URL
  (`https://api.atlassian.com/ex/jira/<CLOUDID>/…`) or a workspace-scoped API token
  carries its tenant in the request itself, so nothing outside the call can redirect it.
- **Ambient-bound.** The target comes from machine-global or session-global state a skill
  does not own: acli's single active account, an MCP's browser OAuth session bound to
  whatever account the human last used. Any other process — or the human — can change it
  between the check and the call. That is a **TOCTOU** window, and a successful
  pre-flight `auth status` does not close it.

Prefer the per-invocation-bound substrate. This is exactly why Atlassian JIRA *writes*
were already forced onto the cloudId-scoped curl adapter; the hazard is not specific to
Atlassian and not specific to writes. A misrouted write is loud and often reversible; a
**read through the wrong tenant silently returns wrong data**, which then propagates into
tickets, PRDs, and verification claims — harder to detect and harder to unwind. Reads get
the same ordering as writes.

**Determinism.** A token path either has its bootstrap or does not, and says so. An MCP's
readiness depends on session state a skill cannot inspect reliably — the same server
registers under different prefixes depending on install path, and its data tools register
only after OAuth completes.

## MCP stays a first-class fallback

This is a **re-ordering, not a removal.** The strongest argument for MCP-first — that an
already-authenticated MCP is zero-setup and identity-verified — is preserved by keeping
MCP as a genuine, fully supported tier rather than deleting it:

- Every access skill keeps its MCP adapters in the dispatch table.
- An operation with no tier 1 adapter routes to MCP **as the normal path**, not as an
  error.
- A project with no credentials provider is fully functional on MCP alone.
- MCP failure messages stay actionable (how to enable and authenticate the plugin).

Removing an MCP adapter is a separate decision requiring its own justification. Do not
treat this contract as license to delete one.

## Guarded fallback for ambient-bound substrates

When the ladder does fall back to an ambient-bound substrate for a **mutating**
operation, the fallback is guarded — never the normal path:

1. Switch to the configured profile and assert the active identity matches config
   immediately before the write.
2. Execute the write.
3. Re-read the affected object(s) immediately afterward.
4. Perform a **post-write tenant assertion** on the response — the tenant is proven from
   the response (self URL host, cloudId in the path, or response metadata), not assumed
   from the pre-flight check.
5. On mismatch: stop, report a cross-tenant hazard, and best-effort **roll back** the
   write when a safe reversal exists (delete the created object, remove the created
   comment/link, revert a reversible field edit). Never continue as if it succeeded.

A successful pre-flight switch is not sufficient for tenant safety — another process can
mutate global state between the check and the write.

## Legacy OS-keychain fallback — removal date 2026-11-01

Two access skills (`lisa-atlassian-access`, `lisa-notion-access`) still read an
OS keychain as a last rung below the chokepoint, because the guided
`/lisa:setup:atlassian` and `/lisa:setup:notion` flows wrote credentials there
before `lisa-secrets-access` existed. That rung is a **migration ramp with a
removal date, not a standing exemption**: it is a second reader of the same
credential, which is exactly how one credential ends up living in two places and
drifting, and a keychain entry is machine-local ambient state that no headless
surface can reach — so a project resting on it has no working tier 1 in cron, CI,
or a cloud session.

**Both rungs are deleted on 2026-11-01.** Before then, projects still on the
keychain path move the credential into their configured provider — re-running
`/lisa:setup:<vendor>` stores it through the chokepoint. After removal, a
keychain-only project fails loudly with the exact variable named (tier 3), which
is the intended outcome: it can never silently resolve through a substrate
authenticated elsewhere. No new access skill may add a keychain rung; a credential
the chokepoint cannot answer for is a setup gap to fix, not a store to add.

## Consequences to expect

- **A stale or wrong token now fails identity-match instead of silently succeeding
  through an authenticated MCP.** That is intended: it is the exact class of bug this
  contract exists to surface. Fix the credential (`/lisa:setup:<vendor>`); do not
  re-order the ladder to route around it.
- Headless and interactive sessions take the same primary path, so a credential problem
  reproduces on a laptop instead of only at 3am in cron.
- The ordering is **not configurable per project**. A knob would let a project
  reintroduce the headless divergence this contract removes. Revisit only with a concrete
  need and a new decision record.

## Adding or editing an access skill

1. Cite this rule by name; do not restate the ordering.
2. Document the tier 1 credential and the `lisa-secrets-access` resolution path.
3. Document the identity anchor and its probe, and state that mismatch means skip.
4. Keep MCP adapters and name the operations for which MCP is the only substrate.
5. Make the terminal failure name the exact credential and remediation command.

An access skill whose MCP is provider-credential-authenticated has no interactive
tier to demote — that MCP *is* the tier 1 substrate (`lisa-sonarcloud-access`: the
official SonarQube MCP authenticates headlessly from `SONARQUBE_CLI_TOKEN`).
Reserve a browser-OAuth demotion for vendors whose MCP is keychain-bound and
therefore dead headless.

That is a claim about tier ORDER and never about exclusivity. "Tier 1 needs no
demotion" does not license "there is no other substrate": where the vendor exposes
a token-authenticated Web API, it remains a sanctioned read-only fallback for a
surface on which the MCP is not wired, and a missing MCP there is a demotion rather
than a terminal tool-access failure.
