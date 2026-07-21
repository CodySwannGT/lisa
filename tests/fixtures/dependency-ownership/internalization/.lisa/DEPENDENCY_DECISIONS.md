# Dependency Decisions

<!-- lisa-dependency-decisions:v1 -->

Fixture: the host project's decision record AFTER the internalization work item
in `tests/fixtures/dependency-internalization-kit/dependency-internalization-ticket.md`
has shipped. The entry is not deleted when a capability moves in-house — it is
retired in place, because the reason we once trusted the dependency and the
conditions under which we would go back are exactly what a later reader needs.

Nothing after `## Records` is guidance, so appending stays safe.

## Records

### slugify (retired — capability moved in-house 2026-07-21)

- **Why we keep it:** We no longer do. Every public content URL is still built
  from slug rules, but those rules are now ours: the capability moved in-house
  so the shape of our URLs stops being someone else's release decision.
- **What it is (dependency):** `slugify` `1.6.6` — removed from the manifest in
  this change. The version is written down here because it is the rollback
  target, not because anything installs it.
- **What it does for us (owned capability):** Turning a title into a URL slug.
  Now owned by the in-house slug builder, not by a package.
- **Why we believe it's safe (trust basis):** Trust class after the move:
  **thin wrapper suitable for in-house ownership**. The capability was 60 lines
  of transliteration that we already patched around twice, so replacement cost
  was low and the code is now readable by the team that depends on it. The
  confidence-rebuild kit was inherited in full and all seven evidence types are
  answered on the work item; the trust question moved from "is upstream
  trustworthy?" to "did we actually rebuild what upstream did?", and the
  differential conformance run over the real corpus is the answer. Human review
  is triggered if a slug defect reaches production.
- **What breaks if this is compromised (exposure):** Production runtime and
  user-visible. A wrong slug changes a public URL, which breaks inbound links
  and search results even though nothing crashes.
- **What it would take to replace (replacement cost):** Low, and deliberately
  kept low. Reinstalling `slugify` at `1.6.6` is a one-commit revert for as long
  as the old call sites remain in history.
- **What would catch a bad update (detection evidence):** The differential
  conformance run in `scripts/verify-slugs.sh`, which slugs all 12,400 published
  titles from the content table and compares against the recorded expectations,
  plus the negative fixtures for inputs the dependency used to reject.
- **Who owns this and how often we recheck (owner / review cadence):** The
  content-platform engineer who owns the slug module — re-read whenever the
  Unicode transliteration tables are revised, and at minimum every 6 months.
- **Last reviewed:** 2026-07-21
