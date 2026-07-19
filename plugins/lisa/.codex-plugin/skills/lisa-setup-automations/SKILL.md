---
name: lisa-setup-automations
description: "Set up the recurring Lisa…"
allowed-tools: ["Skill", "Bash", "Read"]
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

**Naming + scope (so teardown is precise).** Name each automation with the stable prefix
`lisa-auto-<project>-` (e.g. `lisa-auto-<project>-intake-tickets`), where `<project>` identifies this
repo, and scope each Codex automation to the durable project automation checkout described above.
This lets `/tear-down-automations` find and remove exactly this set and never touch other projects'
automations or non-Lisa ones. Use a project identifier stable across runs and distinct from other
repos (don't rely on a bare repo basename when it could collide; qualify it, e.g. with the owner).

**Idempotent.** Re-running this skill updates the existing `lisa-auto-<project>-*` automations in
place (same names) rather than creating duplicates.

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
