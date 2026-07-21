# Dependency Ownership — Operator Guide

This page is for the person standing at the gate, not for the engineer inside
the factory. You do not need to read code to use it. It answers one question:

> **A change wants to add, replace, or remove a dependency. Should I accept it?**

It lives in `wiki/playbooks/` rather than `wiki/documentation/` on purpose: it is
a decision procedure you walk, not a reference you look things up in. The
underlying rules stay in `plugins/src/base/rules/` — this page tells you where
they are and what they mean in plain language.

## What a "dependency" is, and why we write any of this down

A dependency is a piece of software someone else wrote that our product relies
on. Using them is normal and good — nobody should rebuild a payment processor.
The risk is not that we use them; the risk is that we stop being able to say
**why** we use each one, **what breaks** if one goes bad, and **what would even
tell us**. When nobody can answer those, the project is carrying risk that no
one ever agreed to.

Lisa's dependency-ownership layer is five surfaces that, together, keep those
answers written down and current.

## The five surfaces

| # | Surface | Where it lives | The question it answers |
|---|---------|----------------|-------------------------|
| 1 | Decision records | `.lisa/DEPENDENCY_DECISIONS.md` in the project | Why do we keep this dependency, and what would catch a bad update? |
| 2 | Trust classes | `plugins/src/base/rules/reference/dependency-trust-classes.md` | How much scrutiny does this kind of dependency deserve? |
| 3 | Duplicate-pin policy | `scripts/check-duplicate-versions.mjs` | Is the version pinned in one place, or copied into places a bump will miss? |
| 4 | Lisa's own records | `.lisa/DEPENDENCY_DECISIONS.md` in the Lisa repo, gaps tracked as **#1918** | Does the pattern survive contact with a real dependency set? |
| 5 | Confidence-rebuild kit | `plugins/src/base/rules/reference/dependency-internalization-kit.md` | If we take a capability in-house, how do we prove we rebuilt it correctly? |

### 1. Decision records — `.lisa/DEPENDENCY_DECISIONS.md`

Every project Lisa governs receives this file once, blank, and then owns it.
Lisa never overwrites it. It holds one entry per **material** dependency — one
whose failure would break something a user can see, or cost real time to
replace. Not every package in the project belongs here.

Each entry is nine fields, always in this order:

- Why we keep it — the plain-language reason, outcome first.
- What it is (dependency) — the package name and the version in use.
- What it does for us (owned capability) — the one capability it owns.
- Why we believe it's safe (trust basis) — evidence, not vibes. Opens by naming
  the dependency's trust class (surface 2).
- What breaks if this is compromised (exposure) — build-time only, or
  production? Does it reach user data, secrets, money?
- What it would take to replace (replacement cost) — rough effort, and whether
  an alternative exists.
- What would catch a bad update (detection evidence) — the named check that
  fails if the capability breaks.
- Who owns this and how often we recheck (owner / review cadence) — a person
  and a cadence.
- Last reviewed — the date someone actually re-read it.

**`_Not yet decided_` is the reserved marker for a field nobody has answered
yet.** It is deliberately preferred over a confident guess: an honest blank is a
question the next reviewer can pick up, a guess is a wrong answer nobody
re-checks. A record full of that marker is a to-do list, not an emergency.

Three things in a record ARE an emergency, because someone already looked and
the answer was bad:

- **Nothing would catch a bad update.** We are trusting it blind.
- **`Last reviewed` predates the dependency's last major upgrade.** The record
  describes software we are no longer running.
- **Nobody is behind it** — no maintainer, no owner, no release history.

### 2. The six trust classes

Scrutiny is set by blast radius, not by how famous a package is. Every material
dependency is put in exactly one class, and the class tells you what evidence to
demand and whether a human has to sign off.

| Trust class | What it means | Human sign-off? |
|-------------|---------------|-----------------|
| mature ecosystem primitive | Widely used, slow-moving, boring on purpose | Not required |
| fast-moving standard implementation | Implements a standard, but ships often | Required at major upgrades |
| build/development tool | Never leaves CI or a developer's machine | Not required |
| runtime-critical service client | Runs in production, reaches money, user data, or secrets | **Always required** — before adding, and before every major upgrade |
| thin wrapper suitable for in-house ownership | Small enough that we could own the code ourselves | Required to keep it rather than internalize |
| temporary/experimental dependency | Deliberately time-boxed, with an expiry date | **Required to extend past the expiry date** or to promote it |

Two rules worth memorizing:

- **Maturity does not lower a class.** A famous, well-run package that touches
  payments is still a runtime-critical service client.
- **"Nothing would catch it" is never an acceptable answer for a
  runtime-critical service client.** For that class it is a rejection, not a
  disclosure.

If a dependency's exposure changes — a build tool starts running in production —
it gets **reclassified**, openly. It never gets quietly re-trusted.

### 3. The manifest-authoritative duplicate-pin policy

A version should be pinned in exactly one place: the project's dependency
manifest (`package.json` / `package.lisa.json`). Every copy of that literal
somewhere else — a CI workflow, a setup script, a template — is a second place
someone has to remember to edit. Routine bumps miss those, and then two parts of
the system quietly disagree about what version we run.

The check is run with:

```bash
bun run check:duplicate-versions
```

It reports a file, a line, and what to do instead — usually "read the value from
the manifest". A genuinely intentional duplicate (mid-migration, say) is
recorded honestly with an inline marker that must carry **both a reason and a
ticket**, so the exception is tracked rather than silently muted.

**Two things you must know before you trust its output:**

- It is **advisory** today: it reports and exits successfully, so a green build
  does not mean the report was empty. Read the report. Making it block a build
  is a separate, deliberate change that goes through the threshold ratchet.
- It deliberately under-reports rather than over-reports, because a false alarm
  erodes a check faster than a missed one. It ignores lockfiles, prose,
  comments, loose ranges like `22.x`, packages the manifest does not pin, and
  the `.lisa/` ledgers. So a clean run is not proof that no pin was duplicated —
  it is proof that none of the provably-actionable shapes were.

### 4. Lisa's own seeded records, and the #1918 gap ticket

Lisa fills in this same file for itself, against its own real dependency set —
seventeen entries, split by blast radius. It is worth reading as a worked
example of what "good" looks like.

It is also an honest example. Every entry was written from repository evidence
only: what the manifests, workflows, hooks, and tests actually prove. Repository
evidence cannot show who maintains a package, how fast they answer a security
report, or who inside Lisa is accountable for it. Those fields say
`_Not yet decided_`, and **every one of them is tracked as issue #1918.** If you
close a gap, update that ticket; if you find a new one, add it there.

That is the posture to expect from a good record everywhere: gaps are visible
and tracked, not painted over.

### 5. The confidence-rebuild kit (when a dependency moves in-house)

Sometimes the right answer is to stop depending on something and write it
ourselves. That does not remove risk — it *moves* it. The question changes from
"is upstream trustworthy?" to "did we actually rebuild what upstream did?"

So a work item that takes a capability in-house inherits seven pieces of
evidence. Each one is a plain question, and you can check all seven without
reading code:

1. **Real corpus** — did we test it on real inputs, not toy examples?
2. **Conformance fixtures** — does the new code do what the dependency did?
3. **Negative fixtures** — does it still reject what it should reject?
4. **Coverage as a gap detector** — what behavior is still untested?
5. **Provenance and license review** — where did this code come from, and are we
   allowed to use it?
6. **Migration and update plan** — how do existing call sites move, and how does
   the new code stay current?
7. **Rollback or replacement criteria** — what would make us go back, and to
   what?

All seven are required. A partial kit is the finding.

The kit is also easy to over-apply, and over-applying it is a real failure, not
harmless caution. It applies when **ownership moves** — the capability leaves the
dependency set and we own the code. It does **not** apply to an ordinary version
bump within the same trust class, because nothing was rebuilt. The one exception:
a "bump" that is really a fork, or a bump declined in favor of owning the code,
is an internalization wearing a bump's clothing and carries the full kit.

The only way to skip the kit on a removal is an explicit statement that the
dependency is **non-material**, with the reason. Silence is not a justification.

## Deciding whether a dependency change is acceptable

Work out which of the three shapes you are looking at, then walk that list.

### It is a dependency ADDITION

Something new is being added to the project.

Accept it when all of these are true:

- The work item names **one** of the six trust classes, and the class matches the
  blast radius rather than the package's reputation.
- The evidence that class demands is present and specific: a named accountable
  person, a stated update cadence, a named check that would catch a bad update,
  and a real replacement-cost estimate.
- If the class is **runtime-critical service client** or **temporary/experimental
  dependency**, a human has signed off — before the work starts.
- The change commits to adding an entry to `.lisa/DEPENDENCY_DECISIONS.md`, and
  that entry answers all nine fields.
- The version is pinned in the manifest only. Run
  `bun run check:duplicate-versions` and read the report.

Send it back when: no class is named; the class is argued from popularity rather
than exposure; the detection-evidence answer is "nothing would catch it" on a
runtime-critical service client; replacement cost is left as `_Not yet decided_`
on something that touches money or user data; or the version literal is copied
into a workflow or script as well as the manifest.

Worked example:
`tests/fixtures/dependency-trust-classes/dependency-addition-ticket.md` (adding
a payment client) with the record it produces at
`tests/fixtures/dependency-ownership/addition/.lisa/DEPENDENCY_DECISIONS.md`.

### It is a dependency INTERNALIZATION

A dependency is being removed and the capability rebuilt in-house.

Everything from the addition list still applies to the *new* owner of the
capability — it lands in the **thin wrapper suitable for in-house ownership**
class — plus:

- All seven confidence-rebuild questions have real answers on the work item.
- The rollback criterion names both a trigger ("what would make us go back") and
  a target ("to what version"), and the target version is written into the
  decision record so the revert stays real after the pull request is forgotten.
- The record entry for the old dependency is **retired in place**, not deleted.
  The reason we once trusted it and the conditions for going back are exactly
  what a later reader needs.
- The removal leaves no orphan pin: no workflow or script still names the
  departed package's version.

Send it back when: fewer than seven questions are answered and the dependency
was not explicitly declared non-material; conformance was checked against
hand-written examples instead of a real corpus; or there is no stated way back.

Worked example:
`tests/fixtures/dependency-internalization-kit/dependency-internalization-ticket.md`
with the retired record at
`tests/fixtures/dependency-ownership/internalization/.lisa/DEPENDENCY_DECISIONS.md`.

### It is an ordinary version bump

The same dependency, a newer version, same trust class, ownership unchanged.

- Do **not** demand the confidence-rebuild kit. Nothing was rebuilt; requiring
  it here is over-application and it teaches everyone to route around the rule.
- Do demand whatever the existing trust class already asks at an upgrade — for a
  fast-moving standard implementation or a runtime-critical service client, that
  includes human sign-off at a major version.
- Do check that the bump touched the manifest and the lockfile, and not a
  scattering of copied literals.
- Do re-read the record entry and update **Last reviewed**.

Send it back when it is not really a bump: a fork, a patch carried locally, or a
bump declined in favor of owning the code. Those are internalizations, and they
carry the full kit.

Worked example:
`tests/fixtures/dependency-internalization-kit/version-bump-ticket.md`.

## What is NOT enforced (and why you still have to look)

This is the honest limit of the layer, and it is the same across every coding
agent Lisa supports — Claude Code, Codex, Cursor, OpenCode, Antigravity, and
Copilot:

- Nothing blocks a commit that changes a dependency without touching the record.
- Nothing fails a build when a package is installed with no trust class named.
- Nothing fails a build when a dependency is deleted with no confidence-rebuild
  kit.
- Nothing notices when `Last reviewed` goes stale.
- The duplicate-pin check is advisory, so it cannot fail a build at all today.

These are rules and review, not gates. That is precisely why an operator reads
this page: the gate is you.

### One documented representation gap

Antigravity ships no separate rules directory of its own; it receives the same
rule content through the shared mirror, and its planning skill carries the same
dependency steps as every other agent. Cursor receives each rule pair flattened
into two native `.mdc` files. Both are representation differences, written down
here and asserted by
`tests/unit/strategies/dependency-ownership-integration.test.ts`. A documented
gap is not a parity violation; a silent one is.

## Where to go next

- The rules themselves: `plugins/src/base/rules/reference/dependency-decision-records.md`,
  `plugins/src/base/rules/reference/dependency-trust-classes.md`, and
  `plugins/src/base/rules/reference/dependency-internalization-kit.md`.
- The blank record every project receives:
  `all/create-only/.lisa/DEPENDENCY_DECISIONS.md`.
- Lisa's own filled-in record: `.lisa/DEPENDENCY_DECISIONS.md`, with open gaps
  tracked in **#1918**.
- The planning wire that demands a class and the kit: steps 4.5 and 4.6 of
  `plugins/src/base/skills/lisa-task-decomposition/SKILL.md`.
