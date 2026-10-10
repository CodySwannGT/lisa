<!-- lisa-bdd-feature-projection-v1 coverage source=bdd%2Ffeatures%2Flisa-ui-starter-settings.feature -->
# BDD behavior contract — feature coverage burndown

Source: bdd/features/lisa-ui-starter-settings.feature

Traceability proves aligned automation exists, never that it ran or passed. A waiver is never coverage. Execution marked “not supplied” is unknown; “not run” means no supplied result matched this mapping. Retry outcomes retain the worst supplied result.

## Declarations

| Scenario | Behavior | Feature | Source line | Platforms | Lifecycle | Tags | Steps |
|---|---|---|---|---|---|---|---|
| BDD-STARTER-001 | Multiple starter origins render independently | Project starter provenance in the Lisa console | 5 | web | required | BDD-STARTER-001, gh-1520, ratified-github-1520, web | Given; When; Then |
| BDD-STARTER-002 | Missing provenance has an explicit empty state | Project starter provenance in the Lisa console | 14 | web | required | BDD-STARTER-002, gh-1520, ratified-github-1520, web | Given; When; Then |

## Tracker references

| Scenario | Reference | URL |
|---|---|---|
| BDD-STARTER-001 | gh-1520 | https://github.com/CodySwannGT/lisa/issues/1520 |
| BDD-STARTER-002 | gh-1520 | https://github.com/CodySwannGT/lisa/issues/1520 |

## Mapped evidence and execution

| Scenario | Runner | Platforms | File | Evidence | Evidence resolution | Execution | Run |
|---|---|---|---|---|---|---|---|
| BDD-STARTER-001 | playwright | web | tests/e2e/ui-starter-config.spec.ts | renders all recorded starter entries from the served project configuration | resolved | not supplied |  |
| BDD-STARTER-002 | playwright | web | tests/e2e/ui-starter-config.spec.ts | shows an empty starter state without inventing template origins | resolved | not supplied |  |

## Local obligations

| Scenario | Platform | Configured runners | Traceability | Waived | Gap |
|---|---|---|---|---|---|
| BDD-STARTER-001 | web | playwright | covered | no | no |
| BDD-STARTER-002 | web | playwright | covered | no | no |

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
