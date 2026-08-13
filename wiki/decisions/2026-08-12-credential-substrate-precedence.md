# Decision: Credential-Provider Substrate Precedence

Date: 2026-08-12

Status: Accepted

Covers decision **D6** of `plans/improvement-notes-implementation.md` (work unit J).

## Context

When a project declares a credentials provider (Bitwarden, 1Password, AWS, Doppler,
Vault), an agent needing to reach an external system has more than one way in: the
provider-backed token or CLI path, or an interactive MCP that a human authenticated in
a browser. Lisa has never had a rule for which one wins, and the `*-access` skills
answered the question differently from each other:

- **`lisa-linear-access`**: resolves the Linear MCP **first** when authenticated, and
  falls back to `LINEAR_API_KEY` + GraphQL "in headless environments."
- **`lisa-notion-access`**: also MCP-first — tier 1 is the Notion MCP when
  authenticated and identity-matched, tier 2 the internal-integration token via curl.
- **`lisa-atlassian-access`**: split. *Writes* already prefer the token path, and for a
  specific reason: the cloudId-scoped REST URL cannot be redirected by the user-global
  acli active account, so a write bound to a token is bound to the right tenant. acli
  writes are a guarded fallback with post-write tenant assertions and rollback.
  *Reads*, however, prefer acli, then MCP, then curl.
- **`lisa-secrets-access`**: owns the provider notes and the `tool:` line declaring
  which CLIs a credential drives, but says nothing about substrate ordering.

So the same conceptual operation resolves through different substrates depending on
which vendor skill runs, and two of them prefer the substrate a headless session
cannot use at all.

## Decision

**One shared, vendor-neutral precedence contract, cited by every `*-access` skill:**

1. **Configured-provider substrate first** — the token or CLI path fed by
   `lisa-secrets-access` — whenever its bootstrap credential is available *and* the
   resolved substrate identity-matches the configured tenant/workspace/site.
2. **Interactive MCP as fallback** — used when the provider path is genuinely
   unavailable (no bootstrap, no adapter for the operation, provider outage).
3. **Identity-match verification stays mandatory on every substrate**, in both
   directions. A substrate authenticated as a different account is skipped, never
   used, regardless of tier.

This reverses the Linear and Notion tier ordering and moves Atlassian *reads* onto the
same footing as Atlassian writes (acli remains available as an identity-matched
fallback). The Atlassian write rule is not deleted — it is **generalized**: its
rationale becomes the contract's rationale rather than one vendor's local note.

**Fallback on a write is bounded by whether the side effect can already have
happened.** Tier 2 is reached freely on reads, but a provider outage during a write is
not automatically a fallback trigger: the provider may have accepted the create,
update, transition, or delete and then failed to return. Retrying that through MCP
duplicates the side effect or produces divergent state. So, for any **mutating**
operation:

- **Fallback is permitted only when no side effect can have occurred** — the failure
  is provably pre-dispatch. That means: no bootstrap credential, identity mismatch,
  no adapter for the operation, request rejected before transmission, connection
  refused, DNS failure, or an authoritative 4xx that the provider defines as
  a no-op rejection.
- **Fallback is forbidden after an in-flight write of unknown outcome** — timeout,
  5xx, connection reset mid-request, or any response the client cannot classify. The
  operation must first **reconcile by reading back** on the *same* substrate tier
  where possible: re-read the item by its idempotency key or natural key and decide
  applied-or-not from observed state. Only after reconciliation proves the write did
  not land may the operation be retried, on either substrate.
- **When reconciliation is impossible** (the read path is down too), the operation
  fails closed and surfaces an operator-readable "write outcome unknown — verify
  before retrying" rather than silently retrying anywhere.

This preserves rather than loosens the Atlassian write safeguards: their
tenant-binding rule stays, and this adds the outcome-unknown rule that the
generalization would otherwise have dropped. Work unit J carries the reconciliation
mechanics per vendor; the contract states the boundary.

`lisa-secrets-access` remains the single chokepoint feeding the token path. Its `tool:`
note line already declares which CLIs a given credential is expected to drive, which is
what makes "provider-first" actionable rather than aspirational.

### Why reverse a working default

MCP-first was a defensible choice and is being overturned deliberately, not corrected
as an oversight. Three reasons outweigh it:

- **Headless parity.** Cron runs, cloud sessions, and CI have no browser. Under
  MCP-first, an interactive session and a headless session resolve through different
  substrates and can therefore fail differently — the failure mode surfaces only in
  the environment nobody is watching. Provider-first makes the primary path the same
  one everywhere, with MCP as the enhancement rather than the default.
- **Tenant safety.** Interactive auth binds to whatever account the human last used.
  This is not hypothetical: it is exactly why Atlassian writes were already forced onto
  the cloudId-scoped token path. The hazard is not specific to Atlassian or to writes.
- **Determinism.** A token path either has its bootstrap or does not, and says so. An
  MCP's readiness depends on session state a skill cannot inspect reliably.

The strongest argument for MCP-first — that an already-authenticated MCP is zero-setup
and identity-verified — is preserved by keeping MCP as a first-class fallback rather
than removing it.

## Alternatives Considered

- **Keep per-vendor ordering and document the differences.** Rejected: the divergence
  is invisible at the call site, and callers delegate through the access layer
  precisely so they do not have to reason about substrates.
- **Provider-first for writes only** (generalizing Atlassian's split literally).
  Rejected: reads leak tenant identity too, and a read through the wrong tenant
  silently returns wrong data, which is harder to detect than a misrouted write.
- **Make the ordering configurable per project.** Rejected for now as premature: no
  project has asked for it, and a knob would let a project reintroduce the headless
  divergence. Revisit only with a concrete need.

## Consequences

- Work unit J: author the shared contract, re-order `lisa-linear-access` and
  `lisa-notion-access` to cite it, move `lisa-atlassian-access` reads to token-first,
  and fold the write-tenant-safety rationale into the shared slug rather than
  restating it per vendor.
- The contract follows the `leaf-only-lifecycle` / `repo-scope-split` precedent: one
  shared slug, never divergent per-skill prose.
- Live acceptance: a Bitwarden-configured project with its bootstrap token present
  resolves Linear, Notion, and Atlassian operations without touching browser auth; and
  removing the token restores the MCP fallback.
- Projects that relied on an authenticated MCP while having a *stale or wrong* token
  configured will now fail identity-match instead of silently succeeding through the
  MCP. That is intended, and it is the same class of bug this contract exists to
  surface.
