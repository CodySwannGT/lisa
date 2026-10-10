<!-- lisa-bdd-feature-projection-v1 coverage source=bdd%2Ffeatures%2Flisa-ui-demo-data.feature -->
# BDD behavior contract — feature coverage burndown

Source: bdd/features/lisa-ui-demo-data.feature

Traceability proves aligned automation exists, never that it ran or passed. A waiver is never coverage. Execution marked “not supplied” is unknown; “not run” means no supplied result matched this mapping. Retry outcomes retain the worst supplied result.

## Declarations

| Scenario | Behavior | Feature | Source line | Platforms | Lifecycle | Tags | Steps |
|---|---|---|---|---|---|---|---|
| BDD-UI-001 | Live console sections render sourced values or an explicit empty state | Lisa console demo-data boundary | 5 | web | required | BDD-UI-001, gh-1547, ratified-github-1547, web | Given; When; Then |
| BDD-UI-002 | Live rendering never exposes an unclassified catalog value | Lisa console demo-data boundary | 12 | web | required | BDD-UI-002, gh-1547, ratified-github-1547, web | Given; When; Then |
| BDD-UI-003 | Empty live sources never fall back to demo values | Lisa console demo-data boundary | 18 | web | required | BDD-UI-003, gh-1547, ratified-github-1547, web | Given; When; Then |
| BDD-UI-004 | Direct file opening preserves the demo catalog | Lisa console demo-data boundary | 25 | web | required | BDD-UI-004, gh-1547, ratified-github-1547, web | Given; When; Then |
| BDD-UI-005 | The catalog guard rejects an unclassified rendered value | Lisa console demo-data boundary | 31 | web | required | BDD-UI-005, gh-1547, ratified-github-1547, web | Given; When; Then |
| BDD-UI-006 | A demo-like identifier from a live source remains valid | Lisa console demo-data boundary | 37 | web | required | BDD-UI-006, gh-1547, ratified-github-1547, web | Given; When; Then |
| BDD-UI-007 | Malformed live control shapes and partial composites stay truthful | Lisa console demo-data boundary | 44 | web | required | BDD-UI-007, gh-1547, ratified-github-1547, web | Given; When; Then |
| BDD-UI-008 | An unknown renderer cannot expose an unclassified control | Lisa console demo-data boundary | 52 | web | required | BDD-UI-008, gh-1547, ratified-github-1547, web | Given; When; Then |
| BDD-UI-009 | Preserved live tables reject newly added sourceless rows | Lisa console demo-data boundary | 59 | web | required | BDD-UI-009, gh-1547, ratified-github-1547, web | Given; When; Then |
| BDD-UI-010 | Callouts carry provenance before entering the live DOM | Lisa console demo-data boundary | 66 | web | required | BDD-UI-010, gh-1547, ratified-github-1547, web | Given; When; Then |

## Tracker references

| Scenario | Reference | URL |
|---|---|---|
| BDD-UI-001 | gh-1547 | https://github.com/CodySwannGT/lisa/issues/1547 |
| BDD-UI-002 | gh-1547 | https://github.com/CodySwannGT/lisa/issues/1547 |
| BDD-UI-003 | gh-1547 | https://github.com/CodySwannGT/lisa/issues/1547 |
| BDD-UI-004 | gh-1547 | https://github.com/CodySwannGT/lisa/issues/1547 |
| BDD-UI-005 | gh-1547 | https://github.com/CodySwannGT/lisa/issues/1547 |
| BDD-UI-006 | gh-1547 | https://github.com/CodySwannGT/lisa/issues/1547 |
| BDD-UI-007 | gh-1547 | https://github.com/CodySwannGT/lisa/issues/1547 |
| BDD-UI-008 | gh-1547 | https://github.com/CodySwannGT/lisa/issues/1547 |
| BDD-UI-009 | gh-1547 | https://github.com/CodySwannGT/lisa/issues/1547 |
| BDD-UI-010 | gh-1547 | https://github.com/CodySwannGT/lisa/issues/1547 |

## Mapped evidence and execution

| Scenario | Runner | Platforms | File | Evidence | Evidence resolution | Execution | Run |
|---|---|---|---|---|---|---|---|
| BDD-UI-001 | playwright | web | tests/e2e/ui-demo-data-gate.spec.ts | every-section-live-or-empty | resolved | not supplied |  |
| BDD-UI-002 | playwright | web | tests/e2e/ui-demo-data-gate.spec.ts | no-sourceless-row-renders-live (including before hydration) | resolved | not supplied |  |
| BDD-UI-003 | playwright | web | tests/e2e/ui-demo-data-gate.spec.ts | empty-source-no-demo-fallback | resolved | not supplied |  |
| BDD-UI-004 | playwright | web | tests/e2e/ui-demo-data-gate.spec.ts | direct-file-open-still-renders-demo | resolved | not supplied |  |
| BDD-UI-005 | playwright | web | tests/e2e/ui-demo-data-gate.spec.ts | guard-fails-on-sourceless-row | resolved | not supplied |  |
| BDD-UI-006 | playwright | web | tests/e2e/ui-demo-data-gate.spec.ts | acme live negative control | resolved | not supplied |  |
| BDD-UI-007 | playwright | web | tests/e2e/ui-demo-data-gate.spec.ts | malformed live control shapes and partial composites render unknown | resolved | not supplied |  |
| BDD-UI-008 | playwright | web | tests/e2e/ui-demo-data-gate.spec.ts | unknown renderer fails closed before exposing its control | resolved | not supplied |  |
| BDD-UI-009 | playwright | web | tests/e2e/ui-demo-data-gate.spec.ts | preserved Quality jobs rejects an added sourceless row | resolved | not supplied |  |
| BDD-UI-010 | playwright | web | tests/e2e/ui-demo-data-gate.spec.ts | callout provenance has a browser bite and sourced control | resolved | not supplied |  |

## Local obligations

| Scenario | Platform | Configured runners | Traceability | Waived | Gap |
|---|---|---|---|---|---|
| BDD-UI-001 | web | playwright | covered | no | no |
| BDD-UI-002 | web | playwright | covered | no | no |
| BDD-UI-003 | web | playwright | covered | no | no |
| BDD-UI-004 | web | playwright | covered | no | no |
| BDD-UI-005 | web | playwright | covered | no | no |
| BDD-UI-006 | web | playwright | covered | no | no |
| BDD-UI-007 | web | playwright | covered | no | no |
| BDD-UI-008 | web | playwright | covered | no | no |
| BDD-UI-009 | web | playwright | covered | no | no |
| BDD-UI-010 | web | playwright | covered | no | no |

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
