# [api] Bump `slugify` from 1.6.5 to 1.6.6

**Labels:** `type:Task`, `priority:low`, `repo:api`

## Context / Business Value

Routine upkeep. 1.6.6 is a patch release fixing transliteration of two Turkish
characters we do not currently emit. Nothing about how we use the package
changes.

## Dependency ownership move

- **Dependency:** `slugify`
- **Move:** none. Version bump only.
- **Trust class:** thin wrapper suitable for in-house ownership — unchanged
  before and after this bump.
- **Ownership stays with upstream**, so the confidence-rebuild kit does **not**
  apply. The bar here is this trust class's own detection evidence and cadence,
  which already exist: our unit tests over the wrapped behavior, re-read at every
  upgrade.

Applying the internalization kit to this ticket would be over-application — no
capability was rebuilt, so a corpus, conformance fixtures, and rollback criteria
would prove nothing and cost days.

## Acceptance criteria

```gherkin
Scenario: The existing slug tests still pass on the new version
  Given slugify is upgraded to 1.6.6
  When the existing unit tests over the wrapped slug behavior run
  Then they pass unchanged, with no new fixtures added

Scenario: The decision record reflects the review
  Given the version changed
  When the change is reviewed
  Then .lisa/DEPENDENCY_DECISIONS.md has its Last reviewed date updated and its
    trust class left unchanged
```

- **Verification:** Existing unit test suite.
- **Dependencies:** none.
- **Skills:** lisa-tdd-implementation.
