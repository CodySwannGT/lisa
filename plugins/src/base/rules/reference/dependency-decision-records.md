# Dependency Decisions

Lisa already governs dependency *mechanics* — pinning, audit gates, override
resolution, duplicate detection. What those mechanics cannot tell anyone is
**why** a dependency is in the project at all, what capability it owns, how much
blast radius it has, or what would fail if a bad update shipped. Dependency
decision records close that gap: they turn dependency posture into decisions an
operator can read, instead of package-manager trivia only an engineer can
interpret.

## Where the record lives

The governed record is the markdown file `.lisa/DEPENDENCY_DECISIONS.md` in the
host project.

It is distributed through Lisa's `all/create-only` template surface, so:

- Every project that runs `lisa apply` receives the scaffold, regardless of
  stack — the record is stack-independent because dependency posture is.
- The strategy is **create-only**: Lisa seeds the file once and never overwrites
  it. Host projects own their content outright, and Lisa upstream never carries
  a copy of any host project's private dependency inventory.
- It lives in the cold `.lisa/` directory rather than an auto-loaded rules tree,
  so a long record is never injected raw into every session. Agents read the
  entry they need, when they need it.

Markdown is deliberate. The record's primary audience is the product gate, where
a non-technical operator has to make a keep/replace/escalate judgment. A machine
format would serve tooling and fail that reader.

## What an entry must name

Each material-dependency entry names nine things, in this order. Every label
leads with the operator's question and keeps the technical term in parentheses,
because the record's primary reader is looking for an answer, not a term:

- **Why we keep it** — plain-language reason, written for a non-technical
  reader, leading with the outcome it protects. This is deliberately the FIRST
  bullet: an entry that opens with a version range opens with exactly the
  package-manager trivia this record exists to replace.
- **What it is (dependency)** — package or service, plus the version range in
  use.
- **What it does for us (owned capability)** — the single capability the
  dependency is responsible for. A dependency with no nameable capability is
  either not material, or is doing too much and should be split in the record.
- **Why we believe it's safe (trust basis)** — the evidence that it will still
  be maintained and safe next quarter: maintainer, release cadence,
  security-response history, breadth of adoption, whether the version is pinned.
- **What breaks if this is compromised (exposure)** — what it can reach and what
  breaks when it misbehaves: build-time versus runtime, and whether it touches
  user data, secrets, the network, or CI credentials.
- **What it would take to replace (replacement cost)** — the honest effort to
  remove or swap it, what would need rewriting, and whether a viable alternative
  exists today.
- **What would catch a bad update (detection evidence)** — the named check that
  would **fail** if an update broke the owned capability: a test, suite,
  workflow, or monitor. "Nothing would catch it" is a legitimate and high-value
  answer.
- **Who owns this and how often we recheck (owner / review cadence)** — who is
  accountable, and how often the entry gets re-read.
- **Last reviewed** — ISO `YYYY-MM-DD` date of the most recent actual review.

## When to escalate

The record exists to produce decisions, so three states are escalations rather
than to-dos. Raise them to an owner instead of leaving them recorded:

- Detection evidence says "nothing would catch it" — the capability is trusted
  blind.
- `Last reviewed` predates the dependency's last major upgrade — the record
  describes software no longer running.
- The trust basis names no maintainer, owner, or release history.

An entry full of `_Not yet decided_` is not an escalation; it is unstarted work.
These three are escalations precisely because someone already looked and the
answer was bad.

## What counts as material

Material means: if this dependency vanished, broke, or shipped a hostile update,
a user would notice, or replacing it would cost real time. Test frameworks,
linters, HTTP clients, ORMs, auth libraries, UI toolkits, and build tooling are
usually material. Transitive packages and single-function utilities usually are
not — record the direct dependency that owns the capability, not everything
underneath it.

Do not attempt to record the whole lockfile. An exhaustive record decays into
noise and stops being read, which is worse than a short record that is true.

## Maintenance

Update the relevant entry in the same change that adds a material dependency,
upgrades one across a major version, or removes one. Refresh `Last reviewed`
whenever someone actually re-reads an entry, even when nothing else changes — a
stale date is the signal that the record has drifted from reality.

When detection evidence fails for a dependency, treat the entry as the first
place to look and the first place to correct: either the evidence was wrong
about what it protects, or the exposure was understated.

## Entry format

Entries are uniform and appendable by design, because a later seeding pass adds
them mechanically rather than by rewriting the document:

- An entry is a level-3 heading (`### <name>`) followed by the nine field
  bullets in the fixed order above.
- Entries live under `## Records`, the final section of the file, and new
  entries are appended to its end. A `###` heading inside `## Records` is always
  an entry, never guidance — that scoping is what makes the section safe to
  parse and append to.
- `_Not yet decided_` is the reserved marker for a field nobody has answered
  yet. Never leave a field blank and never guess: a blank field is
  indistinguishable from an overlooked one, and a guess is a wrong answer that
  nobody re-checks.

Note that `_Not yet decided_` and "nothing would catch it" are different
statements. The first means nobody has looked. The second is a finding — a real
capability with no detection evidence behind it.

## Scaffold, not inventory

The seeded file is a scaffold: field structure, guidance, and one clearly marked
worked example so an operator can see the intended shape. The example is meant
to be replaced or deleted once real entries exist. Lisa does not pre-populate a
host project's dependency inventory — only the project knows which of its
dependencies are material.

## Agent parity

The record is a governed markdown artifact, not a runtime behavior, so every
supported coding agent — Claude Code, Codex, Cursor, OpenCode, Antigravity, and
Copilot — reaches it identically through the shared rules mirror and the same
`.lisa/DEPENDENCY_DECISIONS.md` path in the host project. There is no per-agent
enforcement surface to diverge.

The documented gap, uniform across all six runtimes: no agent runtime enforces
that entries stay accurate or current. Nothing blocks a commit whose dependency
change skips the record, and nothing fails when `Last reviewed` goes stale.
Freshness is carried by this rule and by review, not by a hook or a lint gate.
