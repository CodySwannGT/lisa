<!-- lisa-bdd-feature-projection-v1 coverage source=bdd%2Ffeatures%2Flisa-ui-config-save.feature -->
# BDD behavior contract — feature coverage burndown

Source: bdd/features/lisa-ui-config-save.feature

Traceability proves aligned automation exists, never that it ran or passed. A waiver is never coverage. Execution marked “not supplied” is unknown; “not run” means no supplied result matched this mapping. Retry outcomes retain the worst supplied result.

## Declarations

| Scenario | Behavior | Feature | Source line | Platforms | Lifecycle | Tags | Steps |
|---|---|---|---|---|---|---|---|
| BDD-SAVE-001 | Save and Discard use the last confirmed configuration | Save configuration in the live Lisa console | 5 | web | required | BDD-SAVE-001, gh-1528, ratified-github-1528, web | Given; When; Then |
| BDD-SAVE-002 | Different controls preserve their value types and storage destination | Save configuration in the live Lisa console | 13 | web | required | BDD-SAVE-002, gh-1528, ratified-github-1528, web | Given; When; Then |
| BDD-SAVE-003 | A pending or unconfirmed save cannot discard edits | Save configuration in the live Lisa console | 20 | web | required | BDD-SAVE-003, gh-1528, ratified-github-1528, web | Given; When; Then |
| BDD-SAVE-004 | Editing a legacy environment setting preserves production | Save configuration in the live Lisa console | 27 | web | required | BDD-SAVE-004, gh-1528, ratified-github-1528, web | Given; When; Then |
| BDD-SAVE-005 | Background status rendering preserves an unfinished edit | Save configuration in the live Lisa console | 33 | web | required | BDD-SAVE-005, gh-1528, ratified-github-1528, web | Given; When; Then |
| BDD-SAVE-006 | Tag removal preserves the exact visible pending array | Save configuration in the live Lisa console | 39 | web | required | BDD-SAVE-006, gh-1528, ratified-github-1528, web | Given; When; Then |
| BDD-SAVE-007 | An unwritable file retains the draft | Save configuration in the live Lisa console | 47 | web | required | BDD-SAVE-007, gh-1528, ratified-github-1528, web | Given; When; Then |

## Tracker references

| Scenario | Reference | URL |
|---|---|---|
| BDD-SAVE-001 | gh-1528 | https://github.com/CodySwannGT/lisa/issues/1528 |
| BDD-SAVE-002 | gh-1528 | https://github.com/CodySwannGT/lisa/issues/1528 |
| BDD-SAVE-003 | gh-1528 | https://github.com/CodySwannGT/lisa/issues/1528 |
| BDD-SAVE-004 | gh-1528 | https://github.com/CodySwannGT/lisa/issues/1528 |
| BDD-SAVE-005 | gh-1528 | https://github.com/CodySwannGT/lisa/issues/1528 |
| BDD-SAVE-006 | gh-1528 | https://github.com/CodySwannGT/lisa/issues/1528 |
| BDD-SAVE-007 | gh-1528 | https://github.com/CodySwannGT/lisa/issues/1528 |

## Mapped evidence and execution

| Scenario | Runner | Platforms | File | Evidence | Evidence resolution | Execution | Run |
|---|---|---|---|---|---|---|---|
| BDD-SAVE-001 | playwright | web | tests/e2e/ui-config-save.spec.ts | Save writes only three changed keys, rehydrates, and Discard uses the latest saved values | resolved | not supplied |  |
| BDD-SAVE-002 | playwright | web | tests/e2e/ui-config-save.spec.ts | text, select, toggle and environment changes preserve their types and local routing | resolved | not supplied |  |
| BDD-SAVE-003 | playwright | web | tests/e2e/ui-config-save.spec.ts | Save prevents overlapping edits and refuses an unconfirmed response | resolved | not supplied |  |
| BDD-SAVE-004 | playwright | web | tests/e2e/ui-config-save.spec.ts | editing a legacy environment string preserves its production value | resolved | not supplied |  |
| BDD-SAVE-005 | playwright | web | tests/e2e/ui-config-save.spec.ts | a late status render preserves the draft ${JSON.stringify(draft)} before blur | resolved | not supplied |  |
| BDD-SAVE-006 | playwright | web | tests/e2e/ui-config-save.spec.ts | removing one duplicate tag preserves the remaining visible values | resolved | not supplied |  |
| BDD-SAVE-007 | playwright | web | tests/e2e/ui-config-save.spec.ts | a real read-only file refusal preserves pending edits and never reports success | resolved | not supplied |  |

## Local obligations

| Scenario | Platform | Configured runners | Traceability | Waived | Gap |
|---|---|---|---|---|---|
| BDD-SAVE-001 | web | playwright | covered | no | no |
| BDD-SAVE-002 | web | playwright | covered | no | no |
| BDD-SAVE-003 | web | playwright | covered | no | no |
| BDD-SAVE-004 | web | playwright | covered | no | no |
| BDD-SAVE-005 | web | playwright | covered | no | no |
| BDD-SAVE-006 | web | playwright | covered | no | no |
| BDD-SAVE-007 | web | playwright | covered | no | no |

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
