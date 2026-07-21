# Dependency Decisions

<!-- lisa-dependency-decisions:v1 -->

This file is the project's record of **why we keep each material dependency**.

A *material* dependency is one whose failure, disappearance, or bad update would
break something a user can see, or would cost real time to replace. Not every
package in the lockfile belongs here — only the ones that own a capability.

You do not need to be an engineer to read this file. Every entry starts with a
plain-language explanation of what the dependency does for us and what evidence
would catch a bad update. If an entry does not answer those two questions in
words a non-engineer understands, the entry is wrong — fix the words, not the
reader.

Lisa seeds this file once and never overwrites it. It is yours to maintain.

## How to use this file

1. Copy the **Entry template** below for each material dependency.
2. Add the filled-in entry to the end of the **Records** section.
3. Fill in every field. If you do not know the answer yet, write
   `_Not yet decided_` — never leave a field blank and never guess. An
   unanswered field is an honest question for the next review; a guess is a
   wrong answer that nobody will re-check.
4. Re-read an entry whenever that dependency is upgraded across a major version,
   changes maintainers, or its detection evidence fails.
5. Update `Last reviewed` every time someone actually re-reads the entry, even
   if nothing else changed.

### Entry format (stable, appendable)

Entries are deliberately uniform so they can be added by hand or appended by a
script without rewriting the rest of the file:

- Every entry is a level-3 heading (`### <name>`) followed by the nine field
  bullets, always in the order shown in the **Entry template**.
- Entries live under `## Records`, which is the last section of this file, and
  new entries are appended to the end. A `###` heading inside `## Records` is
  always an entry and never guidance — that is what makes the section safe to
  parse and append to.
- Nothing after `## Records` is guidance, so appending to the end of the file is
  always safe.
- `_Not yet decided_` is the reserved marker for an unanswered field, so
  unfilled entries are visibly honest rather than silently empty.

## What each field means

- **Dependency** — the package or service name, and the version range in use.
- **Why we keep it** — the plain-language reason, written for a non-technical
  reader. Lead with the outcome it protects, not the mechanism.
- **Owned capability** — the single capability this dependency is responsible
  for. If you cannot name one capability, the dependency is either not material
  or is doing too much.
- **Trust basis** — why we believe this dependency will still be maintained and
  safe next quarter. Evidence, not vibes: who maintains it, release cadence,
  security-response history, how widely it is used, whether it is pinned.
- **Exposure** — what it can reach and what breaks if it misbehaves. Does it run
  at build time only, or in production? Does it touch user data, secrets, the
  network, or CI credentials?
- **Replacement cost** — what it would actually take to remove or swap it:
  rough effort, what would have to be rewritten, and whether a viable
  alternative exists today.
- **Detection evidence** — the specific check that would **fail** if an update
  broke the owned capability. Name the test, suite, workflow, or monitor. If the
  honest answer is "nothing would catch it", write that down — it is the most
  valuable line in the entry. Use `_Not yet decided_` only when nobody has
  looked yet, which is a different statement from "we looked, and nothing
  covers this".
- **Owner / review cadence** — who is accountable for this entry and how often
  it gets re-read.
- **Last reviewed** — ISO date (`YYYY-MM-DD`) of the most recent review.

## Entry template

Copy this block, fill it in, and append it to the end of **Records** below. Keep
the nine bullets in this order. Any field you cannot answer yet gets
`_Not yet decided_`.

### <dependency name>

- **Dependency:** <package or service name> `<version range>`
- **Why we keep it:** <plain-language reason a non-technical reader can follow>
- **Owned capability:** <the one capability it owns>
- **Trust basis:** <maintainer, cadence, adoption, security history, pinning>
- **Exposure:** <build-time vs runtime; data, secrets, network, CI reach>
- **Replacement cost:** <effort to remove or swap, and the alternative>
- **Detection evidence:** <the named check that fails if an update breaks it>
- **Owner / review cadence:** <accountable owner> / <cadence>
- **Last reviewed:** <YYYY-MM-DD>

## Records

> **The entry below is an EXAMPLE.** It is here so you can see the shape of a
> good record. Replace it with your own material dependencies, or delete it once
> you have written real entries.

### ESLint (EXAMPLE — replace with your own dependencies)

- **Dependency:** `eslint` `^9`
- **Why we keep it:** It is the automatic reviewer that reads every change
  before a human does and refuses the ones that break our agreed coding rules.
  Without it, those rules become suggestions and the codebase drifts a little
  with every change until nobody can predict how anything is written.
- **Owned capability:** Automated enforcement of code-quality and style rules on
  every commit and every pull request.
- **Trust basis:** Maintained by the OpenJS Foundation with a published release
  cadence and a documented security-disclosure process; used by a very large
  share of the JavaScript ecosystem, so breakage is found by other people before
  it reaches us. The major version is pinned, so an upgrade is a deliberate
  decision rather than something that arrives on its own.
- **Exposure:** Build-time and CI only. It never runs in production and never
  touches customer data. It does run inside CI, so a compromised release could
  in principle read CI environment variables — which is why the version is
  pinned and upgrades are reviewed.
- **Replacement cost:** High. Every rule configuration and every custom rule
  would have to be re-expressed in another linter, and the pre-commit and CI
  wiring rebuilt. Alternatives exist (for example Biome or oxlint) but none is a
  drop-in match for the current rule set today.
- **Detection evidence:** The `lint` script and the Lint job in CI. If an
  upgrade silently stopped enforcing rules, the giveaway is the lint job going
  green on a change that is known to violate a rule — so the paired signal is
  the lint-rule tests that assert known-bad code is still rejected.
- **Owner / review cadence:** Platform / engineering owner — reviewed each major
  version upgrade, and at least once every 6 months.
- **Last reviewed:** 2026-07-21
