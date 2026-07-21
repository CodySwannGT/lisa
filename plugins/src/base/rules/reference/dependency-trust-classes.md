# Dependency Trust Classes

Without named classes, every third-party package sits in one implicit bucket:
"we installed it, so presumably it's fine." That bucket makes a payment SDK and
a code formatter look identical at review time, and it forces every dependency
conversation to re-argue trust from first principles.

Trust classes fix that. Each class states, in plain language, **why we can trust
that kind of dependency**, and names **the one event that would trigger human
review**. A dependency's class is the answer to the
"Why we believe it's safe (trust basis)" field in
`.lisa/DEPENDENCY_DECISIONS.md` — the record says what
this dependency is and what would catch a bad update; the class says what bar it
had to clear to be here at all.

Exactly one class per dependency. If two seem to fit, take the lower-trust one —
the requirements are strictly stronger, and being over-careful about a formatter
costs a review cycle while being under-careful about an auth client costs users.

## The five review inputs

Every class fixes the same five inputs. What changes between classes is how
demanding each one is:

- **Capability owner** — who is accountable when this breaks. A role for
  high-trust classes; a named person for low-trust ones, because "the platform
  team" cannot be paged at 2am.
- **Update cadence** — how often the entry is re-read and the version re-judged.
- **Detection evidence** — the named check that fails if an update breaks the
  owned capability. Stronger classes demand evidence *we* own, not upstream's
  test suite.
- **Replacement-cost threshold** — the point past which the cost itself is the
  finding. High replacement cost is acceptable in a high-trust class and is an
  escalation in a low-trust one.
- **Product/human ratification** — whether a human has to say yes before the
  dependency is added, upgraded, or kept. This is the gate, and it is deliberate
  that the lower-trust and higher-exposure classes carry it.

## The six classes

### 1. Mature ecosystem primitive

**Why we can trust it:** so many other projects depend on it that a bad release
is usually found, reported, and fixed by someone else before it reaches us. It
has an identifiable maintaining organization, a published release cadence, and a
documented process for handling security reports. Trust here comes from the size
of the crowd standing in front of us, not from us having read the code.

Examples in kind: a language's canonical test runner, a foundation-maintained
linter, a mainstream UI framework.

- **Capability owner:** a role or team is sufficient.
- **Update cadence:** re-read at each major upgrade, and at least every 12
  months.
- **Detection evidence:** an existing CI check must fail if the owned capability
  breaks. Naming an upstream test suite is acceptable here and only here.
- **Replacement-cost threshold:** high replacement cost is accepted. That is the
  bargain — we take deep coupling in exchange for the crowd's scrutiny.
- **Ratification:** not required to add or to take a minor/patch upgrade.

**Human review is triggered when:** maintainership changes hands or the project
is archived, or a security advisory goes unfixed past the project's own
published response window. Either event removes the crowd, which was the whole
basis for the trust — reclassify rather than re-trust.

### 2. Fast-moving standard implementation

**Why we can trust it:** it is the standard implementation of a protocol, spec,
or platform we have deliberately decided not to own — a cloud SDK, an API
client, a framework tracking a moving platform. We trust the *standard*; we do
not trust the release we happen to be on, because the project moves faster than
our review cycle does. Trust here is conditional on us keeping up.

- **Capability owner:** a named team that owns staying current.
- **Update cadence:** re-read at every minor upgrade, and no less than
  quarterly. A dependency in this class going quiet for a year is itself a
  finding.
- **Detection evidence:** an automated test **we** own that exercises the owned
  capability. Upstream's suite does not count — it tests their contract, not our
  use of it.
- **Replacement-cost threshold:** replacement cost must stay moderate. Keep the
  coupling behind our own boundary so a forced migration is a rewrite of the
  boundary, not of the application.
- **Ratification:** required for any major upgrade that changes user-visible
  behavior.

**Human review is triggered when:** two consecutive major versions ship that we
did not adopt inside the cadence window. At that point we are pinned to
unsupported software and the decision — catch up, replace, or accept the
exposure — belongs to a human.

### 3. Build/development tool

**Why we can trust it:** it never runs in production and never touches customer
data. If it ships a bad update, developers notice within one build, and the
worst case is lost engineering time rather than a user-visible failure. The
blast radius is what earns the trust, not the maintainer.

- **Capability owner:** a role or team is sufficient.
- **Update cadence:** re-read at each major upgrade, and at least every 12
  months.
- **Detection evidence:** the build, lint, or test job the tool powers. It fails
  loudly and immediately, which is the point.
- **Replacement-cost threshold:** high cost is accepted — swapping a build tool
  is disruptive but never urgent.
- **Ratification:** not required.

**Human review is triggered when:** the tool gains reach it did not have —
running in production, reading secrets, or reading CI credentials. The moment
that happens the blast-radius argument is void: reclassify it as a
runtime-critical service client and apply that class's requirements immediately.

### 4. Runtime-critical service client

**Why we can trust it:** honestly, we mostly don't. This class covers anything
that reaches users, their data, or money in production — payment SDKs, auth
libraries, database drivers, service clients on the request path. Even a mature,
well-run project lands in this class if a bad update reaches production, because
maturity does not shrink blast radius. Trust here is bought with our own
evidence and a human's signature, not the vendor's reputation.

- **Capability owner:** a named accountable person, not a team.
- **Update cadence:** re-judged at every version change. Versions are pinned
  exactly, so upgrades are always deliberate.
- **Detection evidence:** an integration or end-to-end test that exercises the
  real capability, **plus** a production monitor that would notice failure in
  the wild. "Nothing would catch it" is not an acceptable answer in this class —
  it is a blocker.
- **Replacement-cost threshold:** replacement cost must be written down, never
  `_Not yet decided_`. If nobody can estimate it, we do not know how trapped we
  are, and that unknown is the finding.
- **Ratification:** **product/human ratification is required** before adding the
  dependency and before any major upgrade.

**Human review is triggered when:** any version changes, any security advisory
is published, or the vendor has a service incident. Every one of those is a
human decision in this class — that is what makes it the strictest.

### 5. Thin wrapper suitable for in-house ownership

**Why we can trust it:** it is small enough that we could read all of it in an
afternoon and own it outright. Safety is not really the question; whether it is
earning its keep is. A dependency we could write in a day still costs us a
supply-chain entry, a transitive tree, and an upgrade obligation forever.

- **Capability owner:** the team that would inherit the code if we in-housed it.
  If no team will claim it, do not add it.
- **Update cadence:** re-read at every upgrade — there should be few.
- **Detection evidence:** our own unit tests covering the wrapped behavior. They
  are cheap here precisely because the surface is small, and they are what makes
  in-housing a one-day job later instead of a rewrite.
- **Replacement-cost threshold:** roughly one day. Under it, the default is to
  in-house the code rather than take the dependency.
- **Ratification:** **required to keep it** when replacement cost is under the
  threshold. Note the inversion: the human signs off on the *exception* — taking
  a dependency we could trivially own — not on the removal.

**Human review is triggered when:** the package goes unmaintained, or its
transitive dependency tree grows larger than the code it wraps. Either way we
are now carrying more supply chain than capability, and in-housing should be
reconsidered on purpose.

### 6. Temporary/experimental dependency

**Why we can trust it:** we don't, and we say so. This class exists so a spike,
a prototype, or a stopgap can move fast without silently becoming permanent. It
is admitted on a clock: a written expiry date and a named exit — replace,
in-house, promote to another class, or remove.

- **Capability owner:** the person who introduced it, by name. Ownership does
  not transfer to a team while the dependency is in this class.
- **Update cadence:** reviewed at the stated expiry date, which is at most one
  quarter out. No expiry date means it does not belong in this class.
- **Detection evidence:** "nothing would catch it" is tolerated **only** while
  exposure stays out of production. The moment it reaches production, the
  runtime-critical requirements apply.
- **Replacement-cost threshold:** must be low by construction. Anything
  expensive to remove is not temporary — it is a permanent dependency wearing a
  temporary label, and it should be classified honestly on day one.
- **Ratification:** **required to extend past the expiry date** or to promote it
  into any other class. An expiry that slides without a human saying yes is how
  a prototype becomes production.

**Human review is triggered when:** the expiry date passes, or the dependency
starts running in production or touching user data — whichever happens first.

## Ratification, summarized

Ratification is not a formality; it is the point where a human owns the residual
risk. Required for:

- **Runtime-critical service client** — to add, and for every major upgrade.
- **Temporary/experimental dependency** — to extend past expiry or to promote.
- **Thin wrapper suitable for in-house ownership** — to keep it rather than
  in-house it.
- **Fast-moving standard implementation** — for a major upgrade that changes
  user-visible behavior.

Not required for mature ecosystem primitives or build/development tools on
routine adds and upgrades. Those two classes are where the crowd and the blast
radius do the work a human would otherwise have to do.

## Naming a class at planning time

A work item that proposes adding a new material dependency must, before it is
buildable, name the dependency's trust class and state that it will update the
`.lisa/DEPENDENCY_DECISIONS.md` entry in the same change. This is enforced at
decomposition time by the `lisa-task-decomposition` skill, which rejects a work
unit proposing a material dependency with no named class.

The class is what makes the rest of the ticket reviewable: it tells the reviewer
which evidence to demand and whether a human has to ratify before the work
starts, rather than discovering both at the end.

Naming a class is not a formality either. If nobody can pick one, that is the
finding — an unclassifiable dependency is usually one nobody has thought about,
and it should be resolved before the work item is accepted rather than after the
package is installed.

## Reclassification

Trust classes describe the dependency as it is used today, not as it was
introduced. When exposure changes — a build tool starts running in production, a
prototype ships to users, a thin wrapper grows a large transitive tree — move it
to the correct class and apply the new requirements immediately. Update the
`Last reviewed` date on the record entry when you do.

Reclassifying downward (to a lower-trust class) is never a demotion of the
dependency. It is an admission that its blast radius grew, which is a fact about
us, not about the maintainers.

## Agent parity

Trust classes are a governed markdown rule and a decomposition-time expectation,
not a runtime behavior, so Claude Code, Codex, Cursor, OpenCode, Antigravity,
and Copilot all reach them identically through the shared rules mirror and the
same `lisa-task-decomposition` skill.

The documented gap, uniform across all six runtimes: no agent runtime enforces
that a dependency carries a correct class. Nothing fails a build when a package
is installed with no class named, and nothing detects that a build tool quietly
started running in production. Classification is carried by this rule, the
decomposition skill, and review — not by a hook or a lint gate.
