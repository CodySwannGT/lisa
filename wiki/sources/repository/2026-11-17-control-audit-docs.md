# Control Audit Documentation Source

- Ingested: 2026-11-17 (`CodySwannGT/lisa#5003`); updated 2026-11-18 (`CodySwannGT/lisa#4978`).
- Note written: 2026-11-19, after the fact. Both ingestions were recorded in `wiki/log.md` without a source note, which the contract's "Required Provenance" section requires. This note records what those ingestions read; it adds no new reading of its own.
- Source type: repository (the Lisa monorepo's own code and design notes). No external system, tracker export or transcript was ingested.

## Scope Read

- `src/controls/`: the modules behind the four commands (audit report and its answers, configure road, carriers, before-enforce, canaries, attest check and record, the criterion catalogue loader) and `src/controls/commands/`, one module per `lisa controls` subcommand.
- `src/cli/controls-cmd.ts`: the `lisa controls` command group, whose subcommands' `--help` text was read for the command list on the synthesized page.
- The four skills under `plugins/src/base/skills/`: `lisa-audit`, `lisa-configure`, `lisa-enforce`, `lisa-attest`.
- `docs/design/paired-proof.md` and `docs/design/before-enforce.md`.
- `spec/tasc-criteria.json`, the criterion catalogue, and `docs/agentic-readiness-questionnaire.md`, which is generated from it.

## Commits

The commits that changed the synthesized page `wiki/documentation/workflows/control-audit.md`, oldest first:

| Commit       | Date       | Work item              | What it did to the page                                                                                 |
| ------------ | ---------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `15a99e0d1d` | 2026-11-17 | `CodySwannGT/lisa#5003` | Created the page, the catalogue section of the specification page, and the README section.              |
| `0349be78c7` | 2026-11-18 | `CodySwannGT/lisa#4978` | The 2026-11-18 ingestion: what the report check refuses and how an answer counts.                       |
| `7d338293a2` | 2026-11-18 | `CodySwannGT/lisa#4993` | Code fix; reworded the pull-request canary paragraph and its limit.                                     |
| `65371a5e2f` | 2026-11-18 | `CodySwannGT/lisa#4995` | Code fix; added the commit-first instruction and that `attest --workspace` writes nothing.              |
| `22ca45335a` | 2026-11-18 | `CodySwannGT/lisa#4995` | Code fix; widened `nothing-to-enforce` and the "only rulesets are read" limit.                          |
| `0a5985baa7` | 2026-11-18 | `CodySwannGT/lisa#4978` | Follow-up under the same work item: says what code checks about a person's answer.                      |
| `a44da3340d` | 2026-11-18 | `CodySwannGT/lisa#4994` | Code fix; reworded `nothing-to-enforce`, the rulesets limit and the reconcile limit.                    |
| `edc90f81ca` | 2026-11-18 | `CodySwannGT/lisa#4995` | Code fix; replaced the commit-first instruction with "you can commit in any order".                     |

Only `15a99e0d1d` and `0349be78c7` wrote `wiki/log.md` entries; the other commits kept the page in step with code they changed.

## Pages Synthesized

- `wiki/documentation/workflows/control-audit.md`: the operator-facing page for audit, configure, enforce and attest.
- `wiki/concepts/tasc-specification.md`: the section on the criterion catalogue.
- `README.md`: the section "Checking the controls of any repository".

## Assertions

`tests/unit/controls/control-audit-docs.test.ts` holds the page, the README section and the specification page to the code: the Level 1 requirement count each states is the catalogue's own count, the page names only `lisa controls` subcommands and options the CLI registers, and the wiki index, log and documentation index lead to the page.
