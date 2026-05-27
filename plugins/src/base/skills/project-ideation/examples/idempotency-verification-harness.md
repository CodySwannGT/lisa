# Project Ideation Idempotency Verification Harness

Use this documented harness when validating that `project-ideation prd_ready=true` reuses an
existing GitHub PRD by stable marker instead of creating duplicates.

## Deterministic fixture

Create an isolated fixture project with only one evidence-backed persona and one build-ready idea.
The fixture should make the selected marker predictable:

- Repo identity: `CodySwannGT/lisa`
- Persona key: `queue-automation-operators`
- Idea name: `Exploratory PRD run ledger`
- Existing-fit anchor: `plugins/src/base/skills/project-ideation/SKILL.md`
- Expected marker: `[lisa-project-ideation] idea=codyswanngt-lisa-exploratory-prd-run-ledger-queue-automation-operators-plugins-lisa-skills-project-ideation-skill-md`

The fixture may be a tiny directory with:

- `README.md` naming queue automation operators and their goals.
- `.lisa.config.json` pointing `source` and `tracker` to GitHub.
- `PROJECT_IDEATION_FIXTURE.md` listing the single persona, the single idea, and the expected
  marker above.

Invoke project ideation against that fixture with `prd_ready=true max_prds=1`. The fixture is valid
only if the idea report selects the single expected idea and the PRD summary reports the expected
marker.

## Scripted verification

Run the shipped harness after choosing the deterministic command for your runtime:

```bash
node plugins/lisa/scripts/project-ideation-idempotency-harness.mjs \
  --repo CodySwannGT/lisa \
  --marker "[lisa-project-ideation] idea=codyswanngt-lisa-exploratory-prd-run-ledger-queue-automation-operators-plugins-lisa-skills-project-ideation-skill-md" \
  --command "codex exec '/lisa:project-ideation ./fixtures/project-ideation-idempotency prd_ready=true max_prds=1'" \
  --memory-file "$CODEX_HOME/automations/<automation_id>/memory.md"
```

The harness performs the acceptance check in three phases:

1. Run the deterministic ideation command once, then query open GitHub issues for the marker and
   require exactly one match.
2. Run the same command again, then require the open marker count to remain one.
3. Move the automation memory file aside, run the command again, require the marker count to remain
   one, and require the memory file to be recreated. The original memory file is restored at the end.

## Expected evidence

Capture the harness JSON output as:

- `[EVIDENCE: marker-count-one]` from the first and second marker-count checks.
- `[EVIDENCE: memory-recreated-after-rerun]` from the missing-memory variant.

The run passes only when all reported counts are `1`, the issue URL is the same across phases, and
`memoryRecreated` is `true` when `--memory-file` is supplied.
