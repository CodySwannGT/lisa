# [api] Replace the `slugify` dependency with an in-house slug builder

**Labels:** `type:Task`, `priority:medium`, `repo:api`

## Context / Business Value

`slugify` is 60 lines of transliteration behind a package we upgrade twice a
year. We already patch around two of its behaviors. This work unit takes the
capability in-house so the slug rules stop being someone else's decision.

## Dependency ownership move

- **Dependency:** `slugify`
- **Move:** removed and reimplemented in-house.
- **Trust class after the move:** thin wrapper suitable for in-house ownership —
  the capability leaves the dependency set and we own the code.
- **Material?** Yes. Every public content URL is built from it, so a behavior
  change is user-visible. The confidence-rebuild kit is inherited in full.

## Acceptance criteria (confidence-rebuild kit)

```gherkin
Scenario: Real corpus -- did we test it on real inputs, not toy examples?
  Given the 12,400 published titles already in the content table
  When the in-house slug builder runs over all of them
  Then every title produces a slug and the corpus source is named in the PR

Scenario: Conformance fixtures -- does the new code do what the dependency did?
  Given slugify is still installed during this change
  When both implementations run over the real corpus
  Then the outputs match on every title, and each deliberate divergence is
    written down as a divergence rather than silently accepted

Scenario: Negative fixtures -- does it still reject what it should reject?
  Given inputs the dependency refused: empty strings, control characters, and
    strings that transliterate to nothing
  When the in-house builder receives them
  Then it fails the same way, with the same error type callers already handle

Scenario: Coverage as a gap detector -- what behavior is still untested?
  Given coverage is collected over the new slug module
  When the uncovered lines and branches are reviewed
  Then each one has a stated disposition -- tested, deliberately untested with a
    reason, or a gap closed before merge -- rather than a coverage percentage

Scenario: Provenance and license review -- where did this code come from, and are we allowed to use it?
  Given the in-house implementation was written from the Unicode transliteration
    spec without copying slugify's source
  When the change is reviewed
  Then the work item states the origin and the license obligation it creates,
    and no upstream notice or attribution requirement is carried in unrecorded

Scenario: Migration and update plan -- how do existing call sites move, and how does the new code stay current?
  Given the 31 call sites that import slugify today
  When this change ships
  Then all 31 import the in-house builder, the package is removed from the
    manifest, and the work item names who watches the Unicode transliteration
    tables for revisions and what triggers an update

Scenario: Rollback or replacement criteria -- what would make us go back, and to what?
  Given the internalization has shipped
  When slug defects exceed one per release, or an input class appears that the
    in-house builder cannot handle
  Then we reinstall slugify at the pinned version, which stays a one-commit
    revert for the two releases the old call sites remain in history
```

- **Verification:** Differential test over the real corpus while both
  implementations are installed.
- **Dependencies:** none.
- **Skills:** lisa-tdd-implementation, lisa-test-strategy.
