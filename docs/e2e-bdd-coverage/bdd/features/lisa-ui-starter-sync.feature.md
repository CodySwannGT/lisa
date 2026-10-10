<!-- lisa-bdd-feature-projection-v1 coverage source=bdd%2Ffeatures%2Flisa-ui-starter-sync.feature -->
# BDD behavior contract — feature coverage burndown

Source: bdd/features/lisa-ui-starter-sync.feature

Traceability proves aligned automation exists, never that it ran or passed. A waiver is never coverage. Execution marked “not supplied” is unknown; “not run” means no supplied result matched this mapping. Retry outcomes retain the worst supplied result.

## Declarations

| Scenario | Behavior | Feature | Source line | Platforms | Lifecycle | Tags | Steps |
|---|---|---|---|---|---|---|---|
| BDD-STARTER-003 | Sync reports the engine result and preserves failures | Starter sync results in the Lisa console | 5 | web | required | BDD-STARTER-003, gh-1534, ratified-github-1534, web | Given; When; Then |

## Tracker references

| Scenario | Reference | URL |
|---|---|---|
| BDD-STARTER-003 | gh-1534 | https://github.com/CodySwannGT/lisa/issues/1534 |

## Mapped evidence and execution

| Scenario | Runner | Platforms | File | Evidence | Evidence resolution | Execution | Run |
|---|---|---|---|---|---|---|---|
| BDD-STARTER-003 | playwright | web | tests/e2e/ui-starter-sync.spec.ts | reports a PR, nothing to do, and a real failure without generic success | resolved | not supplied |  |

## Local obligations

| Scenario | Platform | Configured runners | Traceability | Waived | Gap |
|---|---|---|---|---|---|
| BDD-STARTER-003 | web | playwright | covered | no | no |

## Waived obligations

| Scenario | Platforms | Runner | Owner | Reason | Ticket | Expires |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

Waiver recording dates (complete records are retained in JSON):

| Scenario | Recorded at |
|---|---|
| — | — |

## Associated retirements

| Scenario | Platforms | Approved by | Reason | Ticket | Recorded at |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

The matching JSON leaf retains complete local declarations, mappings, waiver and retirement records. Current global inventory, counts, floor evaluations and defects are published by the runtime CI summary.
