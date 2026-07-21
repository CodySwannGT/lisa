---
name: lisa-setup-automations
description: "Set up the recurring Lisa…"
allowed-tools: ["Skill", "Bash", "Read", "Write", "Edit"]
---

# Set up Lisa automations: $ARGUMENTS

This skill is a **specification, not a script.** It tells the current runtime which recurring Lisa
automations to create, on what cadence, and with which parameters — and the runtime creates them
with its **native** scheduling mechanism. Do **not** hand-template schedule files or write shell to
create them; invoke the runtime's automation tool with the spec below.

## Runtime scheduler (branch on the current runtime)

- **Codex** → create Codex **automations** via the native automations mechanism (prefer the
  `automation_update` tool over hand-writing `~/.codex/automations/<id>/automation.toml`; the TOML is
  only its backing store). Set the execution environment to **local** so they run on this
  workstation. Scope them to a durable project automation checkout, not a transient task worktree:
  use `${CODEX_HOME:-~/.codex}/worktrees/<project>-automation-main` when available, create or refresh
  that checkout from the project's `origin` remote if needed, and verify `git -C <cwd> rev-parse
  --is-inside-work-tree --is-bare-repository` reports `true` then `false` before saving the
  automation. Do not point recurring automations at hashed scratch worktrees or a checkout whose Git
  metadata is broken.
- **Claude** → use **`/schedule`** to create local recurring routines, one per automation below.
- **Other runtimes** → use the runtime's native recurring-task mechanism. If the runtime has none,
  state that scheduling is unavailable and stop.

## Parameters

- `auto-start-prds` (default **true**) — passed as `prd_ready` to the **exploratory-prds**
  automation. `true` → ideated PRDs are created `prd-ready` (auto-picked-up by PRD intake); `false` →
  created as drafts for human review. When `true`, `/lisa:project-ideation` still checks the configured
  PRD queue before writing: existing `prd-ready`, `prd-in-review`, `prd-blocked`, unresolved
  `prd-ticketed`, or unresolved source-reader pressure can intentionally turn the automation cycle into
  a blocked/idle outcome instead of creating another ready PRD.
- `auto-start-tickets` (default **true**) — passed as `ready` to the **exploratory-bugs**
  automation. `true` → filed bug/usability tickets are created build-ready (auto-picked-up by ticket
  intake); `false` → created in the backlog for human triage.

- `learnings-audit` (default **false**) — opt-in: when `true`, additionally create the weekly
  `lisa-auto-<project>-learnings-audit` automation running `/lisa:learnings:audit` (the gardener —
  see "Optional automation" below). Default `false` because the gardener's output is human-gated
  tracker tickets: a project opts into the recurring audit stream deliberately rather than
  receiving recommendation tickets by surprise.

The defaults are autonomous by design — the factory model wants inputs flowing through the gates
without a human between the loops and the pipeline. Pass `false` explicitly to opt a project into
human triage. The two auto-start flags affect **only** the two exploratory automations; the intake
gates' adversarial validation remains the quality control either way.

## Repository-readiness advisory

Before creating or updating registrations, locate the standing repository-readiness report through
RRR-3's canonical `resolveReadinessReportPath` contract (currently `.lisa/readiness.json` under the
resolved project root). This consumes the shared report; it never creates a second readiness
assessment. Read the report exactly once. Do not re-run `lisa doctor --readiness`, because doing so
would execute journeys and replace the standing evidence the operator is about to act on.

A report is usable for this advisory only when all of these are true:

- the file parses to a JSON object whose `schema_version` is `1` and whose `verdict` is `NOT_READY`;
- `blocker_count` is a positive integer and the `blockers` array length exactly equals
  `blocker_count`;
- each blocker has a unique `id` in the closed set B1 through B7 (duplicate blocker ids make the
  report internally inconsistent, and uniqueness caps the count at seven) and a non-empty
  operator-facing `label`; and
- `narrowed_claim` is a non-empty string.

For one usable report, emit exactly one warning naming the blocker count, each blocker's `id` and
`label`, and the narrowed claim. For example: "Repository readiness warning — 3 standing ship
blockers: B2 Release path bypasses validation; B4 Failing loop has no recovery; B7 Operability
cannot be proved. Narrowed claim: ready for supervised changes only." This is a warning only:
setup continues, and no registration or runbook step is skipped because blockers stand.

Treat a missing or unreadable file, invalid JSON, unsupported schema, or internally inconsistent
report as unavailable: emit no readiness warning and no error, then continue setup normally. Do not
invent an artifact freshness, age, or TTL rule; the persisted contract defines no such field. This
advisory is never a precondition and follows the same never-block-always-degrade posture as runbook
scaffolding below.

The readiness rule pair reaches each supported runtime through its native delivery path. Claude and
Copilot carry the shared Markdown rule tree and inject its eager tier; Cursor receives transformed
`.mdc` rules. Codex mirrors the shared parent rules into `.codex/lisa-rules` and injects the eager
tier at session start. OpenCode mirrors the same tree into `.opencode/lisa-rules`, loads the eager
tier through `opencode.json` instructions, and leaves the reference tier available on demand.
Antigravity is the explicit representation gap: its artifact has no rules tree or eager-rule
injection. It still receives this setup skill and its warning contract; the missing standalone rule
surface is an accepted limitation, not a silent drop.

## The automations to create

Each automation runs **one cycle** of a Lisa command and respects that command's confirmation policy
(never ask before running; exit cleanly when the queue is idle; report the cycle summary).
Before running the Lisa command, each automation must attempt to sync its checkout.
Fetch the default remote branch, then rebase onto `origin/main` or the resolved default branch. If
the checkout is already on the default branch, fast-forward/rebase it to the remote default. A dirty
working tree is not by itself a blocker: capture
`git status --short --branch`,
leave pre-existing changes untouched, and continue when the sync and selected Lisa command can run
without overwriting those paths. Abort only when Git reports an actual sync conflict or the selected
command would need to modify an already-dirty path; in that case leave queue state unchanged and
report the exact conflicting path(s).

| Automation | Command it runs | Cadence |
|---|---|---|
| **intake-repair** | `/lisa:repair-intake <resolved repair queue>` (GitHub self-host example: `acme/frontend intake_mode=both build_queue=acme/planning`) | every **60 minutes** |
| **intake-prd** | `/lisa:intake <PRD queue>` (e.g. `acme/frontend intake_mode=prd`) | every **60 minutes** |
| **intake-tickets** | `/lisa:intake <build queue>` (e.g. `acme/planning intake_mode=build`) | every **10 minutes** |
| **exploratory-bugs** | `/lisa-<stack>:exploratory-qa ready=<auto-start-tickets>` | **once a day** |
| **exploratory-prds** | `/lisa:project-ideation prd_ready=<auto-start-prds>` | **once a day** |
| **monitor** | `/lisa:monitor` | **once a day** |

For a Codex `rrule`: every 60 min → `FREQ=HOURLY;INTERVAL=1`; every 10 min →
`FREQ=MINUTELY;INTERVAL=10`; once a day → `FREQ=DAILY;INTERVAL=1`; once a week →
`FREQ=WEEKLY;INTERVAL=1`.

**Optional automation — the gardener.** When the operator opts in
(`learnings-audit=true`; default **false** — this one is opt-in, unlike the six
defaults above), additionally create `lisa-auto-<project>-learnings-audit`
running `/lisa:learnings:audit` once a **week**. It audits the project's
knowledge surfaces (learnings ledger, rules trees, skills, wiki) and files
human-gated promote/demote/confirm/retire tickets per the
`lisa-learnings-audit` skill. Register at most ONE learnings-audit automation
per project — the gardener's marker dedupe assumes a single scheduled runner
and guarantees convergence (a transient duplicate from a concurrent run is
closed by the next run's dedupe or the human), not mutual exclusion; manual
runs should first confirm the cron is not due or running. Tear-down removes
it with the rest of the `lisa-auto-<project>-*` set.

**Exploratory PRD pressure gate.** `auto-start-prds=true` means "create PRDs in the ready PRD
lifecycle when the PRD queue has capacity," not "always create a new ready PRD." The
`exploratory-prds` automation uses the same PRD source queue and pressure roles reported by
`/lisa:queue-status`; if pressure exists, the cycle should report the blocking role/ref and the
smallest next action, usually `/lisa:intake <PRD queue>`, without invoking research or writing a PRD.

**Queue resolution.** Resolve the intake/repair queue from merged config — `source` for the PRD
queue, `tracker` for the build queue. For GitHub, the PRD command uses canonical identity
`github.org/github.repo`; the build command resolves `github.queueRepo` and falls back to that
identity. Keep automation naming tied to the identity repo. Bake every resolved `owner/repo` into
the scheduled commands (for example `/lisa:intake acme/frontend intake_mode=prd`,
`/lisa:intake acme/planning intake_mode=build`, and
`/lisa:repair-intake acme/frontend intake_mode=both build_queue=acme/planning`) so a later
config/read-context failure cannot silently redirect the cron. A short queueRepo is normalized to
`github.org` before writing the automation.

**Registration prompt shape (so status can read the command back).** Whatever prose the prompt
carries, it must contain the **literal Lisa command on a line of its own**, exactly as scheduled and
with every `owner/repo` already baked in:

```text
/lisa:intake acme/planning intake_mode=build
```

This holds for loops that take **no arguments** too — `/lisa:monitor` and `/lisa:learnings:audit`
are written the same way, on their own line, with nothing after them. `/lisa:automation-status`
reads that line back to compare the live registration against this contract; a loop whose command
cannot be read back reports as drifted even though it is registered correctly.

**Naming + scope (so teardown is precise).** Name each automation with the stable prefix
`lisa-auto-<project>-` (e.g. `lisa-auto-<project>-intake-tickets`), where `<project>` identifies this
repo, and scope each Codex automation to the durable project automation checkout described above.
This lets `/tear-down-automations` find and remove exactly this set and never touch other projects'
automations or non-Lisa ones. Use a project identifier stable across runs and distinct from other
repos (don't rely on a bare repo basename when it could collide; qualify it, e.g. with the owner).

**Idempotent.** Re-running this skill updates the existing `lisa-auto-<project>-*` automations in
place (same names) rather than creating duplicates.

## Runbook scaffolding

Registration is what pulls a loop under the `automation-runbook-contract` rule, so registration is
what must produce its runbook. For **every automation actually registered above** — including the
conditionally-guarded `exploratory-bugs` and the opt-in `learnings-audit` — write a checked-in
runbook at:

```text
.lisa/automations/<loop-id>.runbook.md
```

`<loop-id>` is the automation's suffix, not its full name: `intake-tickets`, not
`lisa-auto-<project>-intake-tickets`. These files are **project knowledge and belong in git**, like
`.lisa/PROJECT_LEARNINGS.md` — commit them; they are not scratch output. Derive the set of runbooks
from what was registered on this run: a loop that was **skipped gets no runbook**, and a loop
registered later gets one when this skill next runs. Never write a runbook from a fixed list of
loop names.

Follow the `automation-runbook-contract` rule for the runbook's shape: its ten sections, in its
order, in its prose register. **Do not restate the template, the run outcomes, or the escalation
packet here** — cite the rule and instantiate it.

**File shape — two halves with different owners.**

1. A **machine-resolved header block**, delimited exactly by
   `<!-- lisa:machine-resolved:start -->` and `<!-- lisa:machine-resolved:end -->`, written first
   in the file. Lisa owns it: on every run it is **rewritten wholesale** from the values resolved
   above. It carries the project identity (`<owner>/<repo>` and the `<project>` token), the loop
   id, the full automation name, the exact scheduled command with every `owner/repo` already baked
   in (never a placeholder), the human cadence and its `rrule`, the resolved queue arguments, and
   the resolved flag values that shaped the command (`auto-start-prds` / `auto-start-tickets` /
   `learnings-audit`). Its **first line inside the delimiters is a visible sentence**, so the
   ownership boundary survives rendering to markdown where HTML comments disappear:

   ```text
   Lisa rewrites this section on every /lisa:setup-automations run — edits here are lost. Your prose
   belongs in the sections below.
   ```

   Immediately **below** the closing delimiter, write one more visible line — `Everything below is
   yours.` — so an operator reading the rendered page knows where their half starts.
2. The **ten contract sections** below it. Lisa owns them **only on first write**, then they belong
   to the operator. Seed them deterministically, never improvised:
   - **Intent, Sources of truth, Candidate selection, Scope/bounds, Retirement condition** come
     from the per-loop seed table below.
   - **Proof, Autonomous-vs-approval boundary, Escalation, Recovery, Next-run state** are derived
     from **that loop's own SKILL.md** — named per loop in the table's last column — so the runbook
     describes what the loop actually does rather than a generic paraphrase. Quote its behavior in
     the operator's voice; if the skill file is unreadable, write one sentence saying the section
     was not derivable and which file to read, and continue.

   Every seeded sentence is written for a non-technical operator (`factory-model` rule 5).

### Per-loop seed defaults

One line each; expand them into the operator's voice, keep the meaning.

| Loop | Intent | Sources of truth | Candidate selection | Scope/bounds | Retirement condition | Derive the other five from |
|---|---|---|---|---|---|---|
| **intake-repair** | Keeps the queues unstuck: work that stalled mid-flight gets diagnosed and moved again. | The PRD and build queues for this project, read through the tracker access layer. | Stuck or half-closed items — stalled in an in-progress role, terminal-labeled but still open, rollups whose children are all done — up to the `max_candidates` cap. | Only this project's configured queues; it repairs lifecycle state, never invents or closes real work. | **Structural to the factory — this loop does not retire.** Queues will always need unsticking, so no condition should ever stop it; say that here rather than leaving the section blank. | `lisa-repair-intake/SKILL.md` |
| **intake-prd** | Keeps PRDs moving: a PRD a human marked ready gets validated and decomposed into work items. | The configured PRD queue and its lifecycle roles, read through the source access layer. | The oldest PRD in the ready role, one per run. | Only this project's PRD queue; it never authors product intent, only validates and decomposes it. | **Structural to the factory — this loop does not retire.** PRDs keep arriving for as long as the project is alive, so no condition should ever stop it; say that here rather than leaving the section blank. | `lisa-intake/SKILL.md` |
| **intake-tickets** | Keeps the build queue moving: work items a human marked ready get built, reviewed, and shipped. | The configured tracker's build queue lanes plus each item's comments and linked PRs. | The oldest eligible leaf work item in the ready lane, one per run. | Only this repo's configured queue; containers with open children are repaired out, never built. | **Structural to the factory — this loop does not retire.** The build queue is how work ships, so no condition should ever stop it; say that here rather than leaving the section blank. | `lisa-intake/SKILL.md` |
| **monitor** | Keeps production honest: observability regressions become tracked work instead of silent decay. | The connected observability providers, each through its access layer, plus this project's `monitor.gapTiers` config. | The regressions and coverage gaps this cycle surfaced, capped per run. | Only this project's own services and dashboards; it files findings, it never changes production. | Propose teardown when ALL THREE hold: a date-filtered tracker search finds nothing this loop filed within the trailing 30-day window (a small multiple of its daily cadence), AND this run found nothing, AND the project has no connected observability surfaces left — nothing to monitor. The third is a domain conjunct that only tightens the contract's two-part test: a quiet month on a healthy project is good news, not a reason to stop watching it. | `lisa-monitor/SKILL.md` |
| **exploratory-prds** | Keeps the idea pipeline fed: the product's own gaps become PRDs when the PRD queue has room. | The PRD queue's pressure roles (the same ones `/lisa:queue-status` reports) and the project's own product surfaces. | One ideated PRD per run, and only when the pressure gate says the queue has capacity. | Never more than one PRD per run, and nothing at all while unresolved PRD pressure exists. | Propose teardown when ALL THREE hold: a date-filtered tracker search finds no PRD this loop ideated within the trailing 30-day window (a small multiple of its daily cadence), AND this run proposed nothing, AND no unresolved PRD pressure exists while the project has shipped no new surface to ideate against. The third is a domain conjunct that only tightens the contract's two-part test: a quiet month because the queue was full is the loop working, not the loop being obsolete. | `lisa-project-ideation/SKILL.md` |
| **exploratory-bugs** | Keeps quality visible: bugs and usability problems get found by using the product, before a customer does. | The running application through its exploratory-qa surface, plus this project's existing bug queue for dedupe. | The findings of one exploratory session, capped per run and deduped against already-filed items. | Only this project's own app; it files tickets, it never changes product code. | Propose teardown when ALL THREE hold: a date-filtered tracker search finds no finding this loop filed within the trailing 30-day window (a small multiple of its daily cadence), AND this run found nothing, AND the project no longer ships an exploratory-qa command surface to explore. The third is a domain conjunct that only tightens the contract's two-part test: a quiet month on a product nobody broke is quality holding, not a reason to stop looking. | `lisa-exploratory-qa/SKILL.md` (the stack's own copy) |
| **learnings-audit** | Keeps the project's knowledge true: stale, duplicated, or contradicted knowledge gets proposed for promotion, demotion, or retirement. | The learnings ledger, the rules trees, the skills, and the wiki — the project's knowledge surfaces. | The knowledge entries this audit judged stale, duplicated, or contradicted, capped per run. | It only proposes; every promote/demote/retire decision is a human-gated tracker ticket. | Propose teardown when BOTH hold: a date-filtered tracker search finds no `[lisa-gardener]` ticket created within the trailing six-week window (six runs at the weekly cadence), AND this run proposed nothing. | `lisa-learnings-audit/SKILL.md` |

**Retirement condition is mandatory and non-empty.** Every seeded runbook states one, and a loop
that is structurally permanent says exactly that instead of leaving the section blank — an operator
reading it aloud must be able to say when this loop should stop existing, or that it never should.
A valid condition is **stateless**: derived from the tracker, or from the loop's own bounded run
history at `.lisa/automations/runs/<loop-id>.jsonl` — written by the contract's own recorder, not
private per-loop state — and **never an ad-hoc counter** or a new state file. Those two sources are
the same discipline, not a loosening of the contract's "never from a counter or a state file": the
run history is written and bounded by `automation-run-record.mjs`, is readable by any run on any
machine, and is never invented per loop. What the contract forbids is a loop minting private state
to remember itself by. Prefer the tracker; reach for the run history only when the tracker cannot
answer the question. The mechanism itself — the two-part test, the single marker-deduped teardown
proposal, and the three operator responses — is defined once in the `automation-runbook-contract`
rule; these seeds only fill in each loop's specifics. A seed may add a **domain conjunct** on top of the contract's
two-part test — an extra AND that must also hold — because an additional conjunct is strictly
tighter and never divergent. It may never drop or weaken either of the contract's two conditions.
Silence alone means obsolescence only for the gardener; for a monitoring or exploratory loop a quiet
month usually means the project is healthy, which is exactly why those seeds carry a third conjunct.

A loop not in this table — one registered later — seeds all ten sections from its own SKILL.md the
same way. The table is seed prose for first write only; it is **not** a roster and never decides
which automations exist.

**Re-run rule (idempotent, never clobber).** When the file already exists: rewrite the
machine-resolved block in place and **leave every one of the ten sections exactly as found** — an
operator's edited Intent paragraph survives verbatim. If a contract section is **missing** from an
existing file, insert it **at its position in the contract's ten-section order** (never merely
appended at the end, which would leave the file permanently out of order) with its seeded default.
Never overwrite, reorder, reword, or delete prose already on disk. If the machine-resolved
delimiters are absent (a hand-written file), insert the block at the top and touch nothing else.

**Never a precondition.** A runbook that cannot be written is a **degradation, not a blocker**:
report the failure and continue registering automations. A loop with a missing runbook still runs —
on the contract's defaults, saying so in its one-line summary — per the contract's
never-block-always-degrade rule. Scaffolding failure never aborts setup and never leaves an
automation unregistered.

## Conditions / guards

- **exploratory-bugs** is created only when the project ships an `exploratory-qa` command (the
  `expo` / `rails` / `harper-fabric` stacks). If the project has no `lisa-exploratory-qa` skill/command, skip that
  automation and note it — do not invent a command that doesn't exist.
- **monitor** is created unconditionally: `/lisa:monitor` resolves the connected observability
  providers itself and reports gaps (per its `monitor.gapTiers` config) rather than failing when a
  provider is absent, so an unconnected project gets gap findings instead of a broken automation.
  Its findings become tracker tickets, feeding the pipeline at the build gate like every other
  input.
- If the runtime has no native scheduler, or the intake queues can't be resolved from config, stop
  and report what's missing rather than guessing.
- For Codex, if the durable checkout cannot be created, fetched, or verified as a non-bare Git work
  tree, stop and report the checkout problem instead of creating automations that will fail later.

## Report

List each automation created or updated (name, the command it runs, cadence, and the resolved
`auto-start-prds` / `auto-start-tickets` values), plus any automation skipped and why.

Then list each runbook written, by path (`.lisa/automations/<loop-id>.runbook.md`), saying for each
whether it was **created** (seeded fresh) or **refreshed** (machine-resolved block rewritten,
operator prose left untouched). Name every skipped loop again here and state plainly that it has no
runbook because it was not registered, and why — for example, "exploratory-bugs was skipped because
this project ships no exploratory-qa command, so no runbook was written for it."

Close with the two lines that tell the operator what to do next:

- When any runbook was newly created: "N new files were written under `.lisa/automations/` — commit
  them so the whole team sees them."
- When a runbook could not be written: name which one and what failed, then the consequence and the
  fix — "that loop runs on defaults and its summaries will lead with 'Runbook missing' — re-run
  `/lisa:setup-automations` to fix." The automation itself is still registered and still runs.

Every line states the consequence and the action, in words a non-technical operator can act on
without reading code.
