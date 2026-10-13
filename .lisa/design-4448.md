# Design: lisa-session-manager (CodySwannGT/lisa#4448)

Status: decision-ready. Source of truth for requirements: issue #4448 (R1–R10, Gherkin ACs). This file
records how to build it, what it disturbs, and what is cut. No downstream project is named here.

## 0. Verified facts this design rests on (checked against code / live CLI, 2026-10-12)

| Claim | Verified where | Consequence |
|---|---|---|
| `queue-status-build-readers.mjs` reads **raw GitHub only**; jira/linear must arrive as pre-normalized `items` (`RAW_BUILD_READER_TRACKERS = {github}`, `resolveUnsupportedReaderError`) | `plugins/src/base/scripts/queue-status-build-readers.mjs:23,64-97,298-309` | No Jira/Linear reader exists to reuse. Ordering must take vendor-normalized items. |
| Expected-fleet API: `resolveExpectedAutomationFleet({config,gitRemoteUrl,detectedTypes,autoStartPrds,autoStartTickets,learningsAudit})` → `{owner,repo,project,automationPrefix,expected[],unsupported[]}`; groups `core|exploratory|opt-in`; `starter-sync` is pushed conditionally on config | `automation-status-expected-fleet.mjs:197-357,365-409` | A config-conditional entry is an existing pattern. Existing tests `toEqual` the `unsupported` array, so the new entry MUST be conditional on `config.sessionManager` or it breaks them. |
| Both adapters render `unsupported` entries **with** runbook path, last outcome and history (`resolveFleetRunDisplays` covers expected + unsupported) | `automation-status-claude-adapter.mjs:117-131,241-255`; `automation-status-codex-adapter.mjs:210-216,643-652` | A tmux-hosted loop can appear in status, with its runbook and last cycle outcome, with **zero adapter changes**. |
| Run recorder: `--loop-id <slug>` (`^[a-z0-9][a-z0-9._-]*$`), six outcomes, `--denominator` only required for `intake-tickets` | `automation-run-record.mjs:22,456-463,494-500`; `intake-prework-denominator.mjs:22` | `session-manager` is a valid loop id; no denominator needed. |
| Claims run through skills (`lisa-jira-claim` → `lisa-atlassian-access`; `lisa-linear-claim` → `lisa-linear-access`, token-GraphQL or MCP; `lisa-github-claim` → `gh issue edit`) | `skills/lisa-jira-claim/SKILL.md`, `lisa-linear-access` description, `lisa-github-claim/SKILL.md:15-17` | A script cannot claim Jira/Linear. Claims stay in skill prose through `lisa-tracker-claim`. |
| Repo scope is resolved from cwd (`repo` → `github.repo` → origin basename); vendor claim rejects `repo:<other>` | `rules/reference/config-resolution.md:1188`; `repo-scope-split.md:84-111`; `lisa-jira-claim` step 2 | A claim run at a multi-repo **root** rejects a `repo:api` leaf. The claim must run with cwd = the routed child repo. |
| `lisa-track` classifies `$ARGUMENTS` as exactly one of ref, file or text, with no `key=value` stripping | `skills/lisa-track/SKILL.md:43-50` | A trailing paragraph after a ref turns it into plain text, which means search-then-create and a duplicate risk. **The `managedBy=` path is required** (the issue's decision rule). |
| `executionEnv=` is parsed first in `lisa-implement`; the shim's `argument-hint` lists it | `skills/lisa-implement/SKILL.md:8-24`; `commands/implement.md:3` | `managedBy=` follows the same routing-only pattern. |
| `claude agents --json` (active): `{pid,cwd,kind,startedAt,sessionId,name,status}`, `status` e.g. `busy`. `--all` adds completed rows with a **different shape**: `{id,cwd,kind,name,sessionId,startedAt,state}`, `state ∈ {done,stopped}`, no `status`/`pid` | live, CLI 2.1.296 | The agent normalizer must accept both shapes. There is no last-output timestamp, so "no output for N min" means hashing `claude logs <name>` across cycles. |
| `claude --bg`, `-n`, `--resume`, `--settings <file-or-json>`, `--dangerously-skip-permissions`, `claude logs/stop/rm` exist; `--channels` is hidden | `claude --help`, subcommand `--help` | No invented flags. |
| `claude plugin list --json` returns `{id,scope,enabled,installPath,projectPath}`; `claude plugin disable -s user` exists | live | Used for script-root resolution and the setup/doctor plugin-scope check. |
| `CLAUDE_PLUGIN_ROOT` is not exported to Bash (#3517); the documented fallback is `node_modules/@codyswann/lisa/plugins/lisa` | `skills/lisa-monitor/SKILL.md:174-188` | A multi-repo host root is often **not** an npm package, so that fallback can be absent. A stronger ladder is needed (§2.3). |
| The Codex overlay ships `skills/` only, with no plugin-level `scripts/`. OpenCode copies skill folders verbatim | `ls plugins/lisa/.codex-plugin`; `src/opencode/skills-installer.ts:215-236` | Skill-local scripts travel everywhere. Imports of `../../../scripts/*.mjs` resolve in lisa/cursor/agy/copilot/devin and the npm package, but not in the Codex overlay or OpenCode. That is acceptable, because the manager is a documented gap there (§7). |
| `prompt-secret.mjs` reads `/dev/tty` with echo off; `canPrompt()` is false without a TTY; cross-skill import precedent `new URL('../../lisa-secrets-access/scripts/…', import.meta.url)` | `lisa-secrets-access/scripts/prompt-secret.mjs:33-60`; `lisa-setup-remote-env/scripts/environment.mjs:98-104,175-177` | An agent's Bash has no TTY, so setup must hand the operator a copy-paste command for token entry. |
| `validateConfig(cfg)` aggregates per-block validators; `lisa-doctor` runs it for shape | `validate-config.mjs:461-500`; `skills/lisa-doctor/SKILL.md:671` | Adding `validateSessionManager` there gives doctor shape coverage for free. |
| `src/sync/registry.ts` **populates defaults into every project** | `src/sync/registry.ts:1-60` | `sessionManager` must **not** be registered there: it is opt-in. |
| Blocked→Ready authority is repair-intake Class A (containment) and `humanGateVerdict`; `resolveBlockerEdges` returns `proceed` only when every edge dissolves (an empty edge set does not proceed) | `lisa-repair-intake/SKILL.md:1230-1310`; `blocker-edge-resolution.mjs:70-150`; `intake-blocker-reprobe.mjs:404-461` | Reuse these. Never reinvent "blocker closed means unblocked". |

## 1. Component map

All source lives under `plugins/src/base/` (generated variants are produced by `bun run build:plugins`, never hand-edited).

### 1.1 New: skill `lisa-session-manager`
| Path | Purpose |
|---|---|
| `skills/lisa-session-manager/SKILL.md` | Manager runbook: fixed facts, script-root ladder, cycle (reconcile, then dispatch, then report and record), message handling (worker questions, Telegram answers, DONE/FAILED), Telegram rules and commands, security notes, `## Run outcome`, `## Runtime parity`. Generalized from the prototype `MANAGER.md`: tracker-neutral, with roles from config. |
| `skills/lisa-session-manager/references/runbook-template.md` | Seed for `.lisa/automations/session-manager.runbook.md` (the contract's template fields). |
| `skills/lisa-session-manager/scripts/session-manager.mjs` | **The only entrypoint the skills call.** A subcommand CLI: `capacity`, `spawn`, `resume`, `start`, `stop`, `status`, `repo-dir`, `queue`, `ledger <get\|record-spawn\|set-question\|clear-question\|finish\|control>`, `classify`, `route`, `blocked-plan`, `record-cycle`, `init-config`, `store-token`, `validate`. Parses argv, reads `process.env` once (lint exception), injects `exec`/`fs`/`now`/`env` into the pure modules, and maps results to exit codes. |
| `scripts/capacity.mjs` | `readMachineStats({platform,exec,readFile,cpus,loadavg})`, `computeCapacity({stats,running,config,override})`. |
| `scripts/workers.mjs` | `sanitizeRefToken`, `buildWorkerName`, `parseWorkerName`, `normalizeAgents` (both JSON shapes), `countRunningWorkers`, `findLiveWorker`, `scrubWorkerEnv`, `buildWorkerSpawn`, `buildWorkerResume`, `parseSessionId`, `classifyWorker`. |
| `scripts/ledger.mjs` | `readLedger`/`writeLedger` (atomic temp+rename), `recordSpawn` (attempts++), `setPendingQuestion`, `clearPendingQuestion`, `recordProgress` (logs hash → `lastProgressAt`), `recordFinish`, `setControl` (`paused`, `maxWorkers`), `appendSessionEvent` (`sessions.jsonl`). |
| `scripts/telegram-route.mjs` | `routeInbound({text,replyToMessageId,ledger})` → `{kind:"answer",ref,body}` / `{kind:"command",...}` / `{kind:"ambiguous",candidates}`; `parseCommand`; `formatAnswer(owner, body)`. |
| `scripts/reconcile.mjs` | `planBlockedRelease({labels,body,comments,trustedHumanActorIds,humanNeededLabel,edges,pendingQuestion})`, composing `humanGateVerdict` + `resolveBlockerEdges` (imported from `../../../scripts/`). |
| `scripts/launch.mjs` | `resolveStateDir` (expands `~`, defaults to `~/.claude/channels/telegram-<slug>`), `assertTokenPresent`, `buildManagerSettings`, `buildManagerLaunch` (tmux argv + env incl. `SM_SCRIPTS_DIR`, `TELEGRAM_STATE_DIR`), `buildStopManager`, `validateBotToken`, `writeTokenFile` (dir 0700, file 0600; reuses `promptSecret`/`canPrompt` via cross-skill URL import). |
| `scripts/config.mjs` | `resolveSessionManagerConfig(merged)` (defaults + local-over-global per key), `buildDefaultBlock({projectSlug,detectedRepos})`, `detectRepos(root)` (`<root>/projects/*/.lisa.config.json`), `resolveRepoDir(config, key, projectRoot)`. Imports `validateSessionManager` from secrets-access. |

### 1.2 New: skill `lisa-setup-session-manager`
| Path | Purpose |
|---|---|
| `skills/lisa-setup-session-manager/SKILL.md` | Preconditions (tracker configured; `claude` ≥ 2.1.224, `tmux`, `bun`); write the block (`init-config`); token (`store-token`, or a copy-paste command when there is no TTY); plugin installed but not enabled at user scope (`claude plugin list --json`, remedy `claude plugin disable telegram@claude-plugins-official -s user`); `.lisa/session-manager/` ignored (`git check-ignore`, else `info/exclude`, the `lisa-implement` precedent); seed the runbook; `start`; pairing walkthrough (`/telegram:access pair <code>`, `/telegram:access policy allowlist` inside `tmux attach`); coexistence warning (§3.6); security notes. |

### 1.3 New command shims
| Path | Becomes |
|---|---|
| `commands/session-manager.md` | `/lisa:session-manager [cycle\|start\|stop\|status]` → `/lisa-session-manager`. The `/loop` prompt is `/lisa:session-manager cycle`. |
| `commands/setup/session-manager.md` | `/lisa:setup:session-manager` → `/lisa-setup-session-manager` (modelled on `commands/setup/linear.md`). |

### 1.4 New shared script (plugin-level)
| Path | Purpose |
|---|---|
| `scripts/ready-queue-order.mjs` | Vendor normalizers `normalizeGithubIssue`, `normalizeJiraIssue`, `normalizeLinearIssue` → `{ref,title,assigneeId,priorityRank,createdAt,labels,body,authorId,isContainer,repoLabels}`; `orderReadyQueue(items,{me,trustedAuthorIds,humanNeededLabel})` → `{ordered,excluded:[{ref,reason}]}`; `assertPagedToCompletion(envelope)`. It lives beside `queue-status-build-readers.mjs` because it is reusable by intake later. Its consumer is the session-manager CLI. |

### 1.5 Changed files
| Path | Change |
|---|---|
| `skills/lisa-implement/SKILL.md` | New `## Routing: managedBy` section directly after `executionEnv` (§5). |
| `commands/implement.md` | `argument-hint`: `[executionEnv=local\|codex-cloud] [managedBy=<session-name>] <…>`; one sentence on managedBy. |
| `skills/lisa-secrets-access/scripts/validate-config.mjs` | `export function validateSessionManager(block)`, wired into `validateConfig`. |
| `scripts/automation-status-expected-fleet.mjs` | When `config.sessionManager` is present, push one **hosted** entry (`id:"session-manager"`, group `opt-in`) into `unsupported` with an explicit reason. The cadence is derived from `sessionManager.interval`. Nothing else changes (§4). |
| `skills/lisa-automation-status/SKILL.md` | One paragraph: the session-manager entry is locally hosted, shown with its run history, and liveness is `session-manager.mjs status`. |
| `skills/lisa-tear-down-automations/SKILL.md` | One paragraph: when `sessionManager` is configured, fleet teardown or the `session-manager` argument runs `session-manager.mjs stop` (tmux kill), leaves workers running, and lists them. |
| `rules/reference/automation-runbook-contract.md` | A short `### Locally hosted loops` under Membership: registration is the tmux host started by `start`; it is visible in status through config. Reference file only; no eager-budget impact. |
| `rules/reference/config-resolution.md` | A `sessionManager` row in Top-level fields (~272) plus a `### Session manager (sessionManager)` subsection near `intake.assignee` (~666) with the field table, defaults, local-over-global, and "non-secret only, the token lives in `<stateDir>/.env`". The eager copy is untouched. |
| `src/cli/doctor-session-manager.ts` (new) + `src/cli/doctor.ts` | Config-gated isolation checks (§6), wired after `checkKaneProvider`. |
| `all/copy-contents/gitignore` + repo `.gitignore` | `.lisa/session-manager/` with a comment, next to `.lisa/automations/runs/`. |
| Generated | `plugins/lisa{,-cursor,-agy,-copilot,-devin}/…`, `plugins/lisa/.codex-plugin/skills/…`, `src/core/upstream-evidence-manifest.ts` (`build:upstream-evidence-manifest`), and the hash ledger if `check:lisa-owned-hash-ledger` requires it (`build:lisa-owned-hash-ledger`). |

### 1.6 Tests (new)
- `tests/unit/scripts/ready-queue-order.test.ts`
- `tests/unit/session-manager/{capacity,workers,ledger,telegram-route,reconcile,launch,config}.test.ts`
- `tests/unit/session-manager/cli.test.ts`: spawns the CLI with stub `claude`/`tmux`/`vm_stat` on a temp `PATH` and asserts argv, env, cwd and exit codes.
- `tests/unit/secrets/validate-config.test.ts` (extend)
- `tests/unit/strategies/automation-status-expected-fleet.test.ts` (extend: absent means unchanged fleet; present means one hosted entry)
- `tests/unit/strategies/implement-managed-by-contract.test.ts` (prose contract across variants)
- `tests/unit/strategies/session-manager-skill.test.ts` (both skills plus shims in every built variant, gap section present, script ladder identical in both skills, no host project names)
- `tests/unit/cli/doctor-session-manager.test.ts`
- `tests/unit/strategies/copy-contents-gitignore.test.ts` (extend)

## 2. Script language, portability, invocation, testability

### 2.1 Language: `.mjs`, not `.sh`
Decision: all helpers are Node ESM, matching Lisa's preference (logic in scripts with tests; vitest imports from `plugins/src/base/...`).
- Deterministic maths and argv construction become pure exports that vitest covers directly.
- `jq`/`awk`/`sysctl` parsing fragility goes away, and a shell never interpolates ticket or Telegram text.
- Rejected alternative: bash like the prototype. It is untestable without bats, and quoting untrusted text into a shell is an injection path.

### 2.2 Portability
- **CPU and load:** `os.cpus().length` and `os.loadavg()[0]` work on macOS and Linux, so there is no `sysctl` exec.
- **macOS memory:** `exec("vm_stat")`. Parse `page size of N bytes`, then sum `Pages free + inactive + speculative`.
- **Linux memory:** `readFile("/proc/meminfo")` → `MemAvailable` in kB.
- **Other platforms:** `os.freemem()`, with `mem_source:"os.freemem"` in the output so it is not mistaken for a precise reading.
- **Output** (snake_case, exact keys from the completion condition): `{running,cap,free_slots,avail_gb,load1,cores,overloaded,can_spawn}`, plus `mem_source`, `paused`.
- **Formula:**
  - `mem_cap = max(0, floor((avail_gb - reserveGb)/gbPerWorker) + running)`
  - `cpu_cap = floor(cores*cpuFraction)`
  - `cap = min(maxWorkers, mem_cap, cpu_cap)`
  - `overloaded = load1 > cores*maxLoadPerCore`
  - `can_spawn = !paused && !overloaded && running < cap`
  - Override precedence: ledger `control.maxWorkers` (Telegram `cap N`), then the CLI flag `--max-workers`, then config. `maxWorkers=0` gives `can_spawn:false`.

### 2.3 Invocation: the script-root ladder
Skill Bash cannot see `CLAUDE_PLUGIN_ROOT`, and a multi-repo host root may have no `node_modules`. Both skills carry one identical snippet, pinned by a test to be identical across the two skills:

```bash
SM="${SM_SCRIPTS_DIR:-}"
[ -z "$SM" ] && [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && SM="$CLAUDE_PLUGIN_ROOT/skills/lisa-session-manager/scripts"
[ -z "$SM" ] && SM="$(claude plugin list --json 2>/dev/null | node -e '…pick lisa@* installPath: projectPath==cwd first, then scope==user…')/skills/lisa-session-manager/scripts"
[ -f "$SM/session-manager.mjs" ] || SM="node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-session-manager/scripts"
[ -f "$SM/session-manager.mjs" ] || { echo "lisa-session-manager scripts not found"; exit 1; }
node "$SM/session-manager.mjs" <subcommand> …
```

- `start` exports `SM_SCRIPTS_DIR=<dirname(import.meta.url)>` into the tmux session env, so every manager cycle's Bash resolves on rung 1. The manager's Bash inherits the `claude` process env.
- The rung-3 picker is inline `node -e` so it needs no `jq` dependency. Alternatively it can be an `init`-free tiny script, but it cannot be inside `$SM` (chicken and egg).
- **Risk:** after a Lisa upgrade, Claude's plugin cache may delete the old version directory under a running manager. The runbook says: if `$SM_SCRIPTS_DIR` is missing, re-resolve from rung 2 and tell the operator to restart the manager (`stop` then `start`).

### 2.4 Testability
- **Injected seams.** Every pure module takes injected `exec`, `readFile`, `writeFile`, `now`, `env`, `platform`, `cpus`, `loadavg`. `session-manager.mjs` is the only place that touches `process.env`, real `child_process` and the clock.
- **`claude agents --json`.** The output is passed as a string (`normalizeAgents(JSON.parse(stdout))`). Fixtures cover both shapes (active `status`, completed `state`).
- **CLI tests.** They run `node session-manager.mjs …` with `PATH=<tmp stub dir>:$PATH`.
  - The stub `claude` writes its argv, `cwd` and the env keys it received to a JSON file, and prints a fake session id.
  - The stub `tmux` records argv.
  - The stub `vm_stat` prints a fixture.
  - A fake meminfo path is given via `--meminfo <file>`, a hidden test flag on `capacity`.
  - Assertions cover argv, env, cwd and exit codes 2, 3 and 4 (Validation Journey step 1).
- **Spawn uses `child_process.spawnSync("claude", argv, {cwd: repoDir, env: scrubWorkerEnv(process.env)})`.** This is equivalent to the spec's `cd <repo> && env -u … claude --bg …`, but carries no shell string. Scrubbing removes **every `TELEGRAM_*` key**: a superset of the two named, and the test asserts both are absent.

## 3. Logic vs prose

### 3.1 Deterministic, so a script with unit tests
| Concern | Function | Notes |
|---|---|---|
| Queue ordering | `orderReadyQueue` | Group 0 = assignee == me; group 1 = unassigned. Assigned-to-other is **excluded** with a reason. Within a group: `priorityRank` ascending, then `createdAt` ascending, then ref as a stable tiebreak. Also excluded: containers (leaf-only), `isHumanGated(...)` true, and, when `trustedAuthorIds` is set, authors not in it. |
| Priority ranks | normalizers | GitHub `priority:critical/high/medium/low` gives 0/1/2/3, with none = 4. Linear native `1..4` gives 0..3, and `0` (none) gives 4. Jira names `Highest/Blocker`=0, `High/Critical`=1, `Medium/Major`=2, `Low/Minor`=3, `Lowest/Trivial`=4, unknown = 5. |
| Paging | `assertPagedToCompletion` | The `queue` CLI accepts `{complete:true,pages:n,items:[…]}` for jira and linear and **exits 2 if `complete!==true`**. That makes "page to completion" (#3529/#4105) executable rather than prose. GitHub is fetched by the CLI itself with `gh api --paginate`. |
| Capacity | `computeCapacity` | §2.2 |
| Worker naming | `buildWorkerName(ref, now, existingNames)` | `wk-<token>-<MMDD-HHMM>`. The token is `[A-Za-z0-9-]`; for GitHub, `owner/repo#12` becomes `repo-12`, and a Jira or Linear key is kept as is. If the name collides with a known name, append `-2`, `-3` (guarantees "a different name" for a retry in the same minute). `parseWorkerName` uses the regex `^wk-(.+)-\d{4}-\d{4}(?:-\d+)?$`, so matching is an exact token compare, never a `startsWith` prefix. |
| Live-worker / running count | `findLiveWorker`, `countRunningWorkers` | Active rows only (no `state` of done or stopped). |
| Ledger + attempts | `ledger.mjs` | `.lisa/session-manager/ledger.json`, keyed by ref: `{repo,worker,sessionId,status,startedAt,lastProgressAt,logsHash,pendingQuestion:{text,askedAt,lastPingAt,telegramMessageId}\|null,attempts,history[]}` plus `control:{paused,maxWorkers}`. Attempts live here, **never in tracker comments** (#3871). Writes are atomic. A lost ledger resets attempts (documented). |
| Stall classification | `classifyWorker({agent,entry,logsHash,now,stall})` | Returns `finished` (DONE/FAILED recorded), `waiting` (pending question), `requestion` (waiting and `now - lastPingAt > requestionHours`), `working` (active and the logs hash changed, or within `noOutputMinutes`), `stalled` (active, hash unchanged past `noOutputMinutes`, no question), `dead` (absent from active, or `state` done/stopped, with no DONE), or `exhausted` (stalled or dead with `attempts >= maxAttempts`). |
| Telegram routing | `routeInbound` | Order: (1) a leading `[REF]`, `REF:` or `REF ` matching a ledger ref or its worker token, case-insensitive; (2) `replyToMessageId` equal to a pending question's `telegramMessageId`; (3) exactly one pending question. Otherwise `ambiguous`. Commands: `status`, `pause`, `resume`, `cap N` (0 ≤ N ≤ 32), `stop REF`. |
| Env scrubbing | `scrubWorkerEnv` | Drops `/^TELEGRAM_/`. |
| Blocked release plan | `planBlockedRelease` | `humanGateVerdict(...).held` gives `skip-human-gate`; a pending manager question gives `keep`; no edges gives `keep` (Class B/C are not ours); otherwise `resolveBlockerEdges(edges)`: `proceed` gives `release`, `escalations>0` gives `escalate`, else `keep`. |
| Manager launch | `buildManagerLaunch` | `tmux new-session -d -s <name> -c <root> -e TELEGRAM_STATE_DIR=<dir> -e SM_SCRIPTS_DIR=<dir> -- claude -n <name> --dangerously-skip-permissions --settings '<json>' --channels plugin:telegram@claude-plugins-official "/loop <interval> /lisa:session-manager cycle"`. The settings are `{"crossSessionInbound":"accept","enabledPlugins":{"telegram@claude-plugins-official":true}}`. It is passed as argv to tmux, with no shell string, and refuses when `<stateDir>/.env` is missing (exit 2). An existing tmux session prints "already running" and exits 0. |
| Run record | `record-cycle` | Calls `recordAutomationRun({loopId:"session-manager",runbook:".lisa/automations/session-manager.runbook.md",…})` (import `../../../scripts/automation-run-record.mjs`). |

### 3.2 LLM judgement, so it stays in skill prose
- **Repo routing.** The manager matches ticket labels, project, mentioned paths and technologies against `repos.entries[*].hints`.
  - If the item is ambiguous or spans several repos, it does not claim. It asks once on Telegram and records the question in the ledger.
  - A multi-repo leaf follows `repo-scope-split` (split, never claim). The split is done by the vendor writers, not the manager.
- **Telegram wording** (phone-sized, numbered options), and **forwarding** worker questions verbatim apart from trimming.
- **Reconcile decisions that need tracker reads:**
  - whether a PR is already merged before a retry (`gh pr list --search <ref>` in the repo);
  - computing `contained` per repair-intake Class A;
  - checking that a ledger item is still in the claimed role (a human may have moved it).
- **Interpreting DONE/FAILED** and composing the tracker comment.

## 4. Tracker neutrality

| Step | github | jira | linear | Script vs skill |
|---|---|---|---|---|
| "me" | `gh api user --jq .login` | identity probe via `lisa-atlassian-access` (accountId) | `viewer.id` via `lisa-linear-access` | The skill resolves it once per manager run and stores it in the ledger `control.me`. |
| List Ready leaves | `queue --tracker github`: the CLI runs `gh api --paginate "repos/<o>/<r>/issues?state=open&labels=<ready label>&per_page=100"`, drops `pull_request` rows, and marks `sub_issues_summary.total>completed` as a container | `lisa-atlassian-access` search: JQL `project=<P> AND status="<ready role>"`, paged until done | `lisa-linear-access` list issues: state = ready role, paged until `hasNextPage=false` | **GitHub is a script. Jira and Linear go through the vendor skill, which writes `.lisa/session-manager/queue-input.json` `{complete:true,pages,items}`; then `queue --tracker <t> --input <file> --me <id>` orders it.** The ready role name always comes from `scripts/resolve-lifecycle-role.mjs --role ready --vendor <v> --intent read`. |
| Repo stamp | `repo:<name>` label via `lisa-tracker-write` | same | same | Skill. Multi-repo only, and only when the leaf has no repo marker (`repo-scope-split` step 4). |
| Claim | `lisa-tracker-claim <ref>` | same | same | Skill. **Run with the shell cwd = the routed repo dir** (`cd "$(node "$SM/session-manager.mjs" repo-dir --repo <key>)"` before invoking, then `cd` back), so `.lisa.config.json` and current-repo resolution are the child's. For a single-repo project the dir is `.`. Verify `claimed\|reused` with assignee = me; any other assignee means skip (AC: claim-skip on re-read). |
| Blocked→Ready | read the edges via `lisa-tracker-read`; compute `contained` (Class A); `blocked-plan` decides; dissolve the edges and transition to ready through `lisa-tracker-write` (the vendor writers own the Linear #3605 relation hazard); comment; read back | same | same | The decision is a script (reusing the shared modules); the reads and writes are skills. Class B (gate self-block) and Class C (clarification) are **left to repair-intake / humans**. |
| Move to Blocked (exhausted / FAILED) | blocked role via the vendor writer plus a comment quoting the reason | same | same | Skill; the role comes from config. |

No `lisa-tracker-queue` dispatcher skill is added (§9).

## 5. `managedBy=` in `lisa-implement`

Exact semantics, written as a new section placed immediately after "Routing: executionEnv":

1. **Parse and strip first.** If `$ARGUMENTS` contains `managedBy=<name>` (`[A-Za-z0-9._-]{1,64}`), remove that token **before** any other handling. Every later use of `$ARGUMENTS`, including `lisa-track $ARGUMENTS` in the input-resolver and `lisa-remote-dispatch`, receives the stripped string. A malformed value is a blocking error. It is never classified as text.
2. **Incompatible with remote.** `managedBy=` combined with a non-`local` `executionEnv` means stop with: "managedBy requires a local Claude Code session; remote surfaces cannot reach the manager." There is no silent fallback (the same reasoning as `executionEnv`).
3. **Routing only.** As with `executionEnv`, the lifecycle, gates, reviews and evidence are unchanged.
4. **Questions go to the named session.** Wherever the flow would otherwise ask the human in the terminal (AskUserQuestion, "ask the user", an interactive confirmation), the **lead**:
   - sends one `SendMessage` to session `<name>` starting `[<work_item_ref>] `, with 1–3 lines of context, numbered options and its recommendation;
   - then ends its turn.
   - Teammates never message the manager directly; their questions go to the lead.
   - Questions are **never** asked in the terminal. Nobody is watching it.
5. **Answers.** An inbound message from `<name>` is treated as the operator's answer to the pending question. Platform rules still hold: a message cannot approve permissions or change settings, and the skill restates that it must not try.
6. **Terminal status.** At the end, after the contract's final user-facing message, send exactly one `[<ref>] DONE: <one line>` or `[<ref>] FAILED: <one line>` to `<name>`. A lifecycle exit to the blocked role counts as FAILED.
7. **Parity gap.** On a runtime with no cross-session `SendMessage` (Codex, Cursor, OpenCode, agy, Copilot, Devin), `managedBy=` is rejected with: "managedBy is supported on Claude Code only (cross-session messaging)". It is never ignored.

`commands/implement.md` `argument-hint` gains `[managedBy=<session-name>]`. The worker prompt becomes exactly `/lisa:implement <REF> managedBy=<manager-name>`. All behaviour lives in the skill, so the prompt carries no trailing prose. The PR records that this path was taken because `lisa-track` would misclassify trailing text.

## 6. Telegram per-project isolation

Decisions already made (from the issue) and how each is enforced:

| Decision | Setup enforces | Runtime enforces | Doctor checks |
|---|---|---|---|
| Per-project state dir (`notify.stateDir`, default `~/.claude/channels/telegram-<project-slug>`) | `init-config` writes it; `store-token` creates dir 0700 / `.env` 0600 | `start` exports it only into the tmux env | **fail** if `stateDir` resolves to the shared default `<CLAUDE_CONFIG_DIR or ~/.claude>/channels/telegram` |
| Plugin enabled only in the manager via `--settings enabledPlugins` | Check `claude plugin list --json`: installed is required. If `enabled` at user scope, print `claude plugin disable telegram@claude-plugins-official -s user` and stop until it is fixed | `buildManagerSettings` | **warn** when `~/.claude/settings.json` `enabledPlugins["telegram@claude-plugins-official"] === true` |
| Workers launched without `TELEGRAM_*` | n/a | `scrubWorkerEnv` in `spawn` and `resume` | **warn** when `TELEGRAM_BOT_TOKEN` or `TELEGRAM_STATE_DIR` is set in doctor's own environment (a proxy for "exported globally") |
| No token in the default dir | `store-token` refuses to write to the default dir | `start` refuses the default dir | **warn** when `<CLAUDE_CONFIG_DIR or ~/.claude>/channels/telegram/.env` exists |
| `crossSessionInbound: accept` | n/a | in both settings blobs | **warn** when managed settings (`/Library/Application Support/ClaudeCode/managed-settings.json` or `/etc/claude-code/managed-settings.json`) set `crossSessionInbound` to anything other than `accept`, because managed settings outrank `--settings` |
| Token file mode | `store-token` | `start` checks `.env` mode ≤ 0600 | **warn** if `<stateDir>/.env` is group- or world-readable; **warn** if `<stateDir>/.env` is missing (manager cannot start) |

- **Token reuse.** `store-token` imports `promptSecret`/`canPrompt` from `../../lisa-secrets-access/scripts/prompt-secret.mjs`.
  - With no TTY (an agent's Bash), it prints the exact command for the operator to run in their own terminal and exits 0 with "not stored".
  - The token is validated with `^\d+:[A-Za-z0-9_-]{30,}$` and never echoed or logged.
- **Doctor gating.** `src/cli/doctor-session-manager.ts` runs only when the merged config has `sessionManager` (Kane model); otherwise it is `skip`. `HOME`, `env` and `readFile` are injected for tests.

## 7. Parity

| Runtime | lisa-setup-session-manager | lisa-session-manager (manager) | `managedBy=` | Where the gap is documented |
|---|---|---|---|---|
| Claude Code | supported | supported (reference). It needs `claude` ≥ 2.1.224, `tmux`, `bun` | supported | n/a |
| Codex | supported for config + token + runbook. `start` launches a **Claude Code** manager, so it works if the `claude` CLI is installed | the skill ships, but the cycle refuses to run inside Codex (no `/loop`, channels or SendMessage) and tells the operator to `start` (which hosts it in Claude Code) | rejected with the gap message | SKILL `## Runtime parity`; comment in `session-manager.mjs`; `session-manager-skill.test.ts` asserts the section is in every variant |
| Cursor / agy / Copilot / Devin | same as Codex (scripts reachable via the plugin-level path) | same as Codex | rejected | same |
| OpenCode | config + token are supported. Script resolution relies on the npm rung, because OpenCode copies skill folders but not plugin-level `scripts/`, so `../../../scripts/` imports fail and `queue`/`record-cycle` are unavailable | gap | rejected | same, plus a note that `queue`/`record-cycle` need the npm package |

Background sessions, channels, `ListAgents`/`SendMessage` and `crossSessionInbound` are Claude Code features. The manager **process** is always Claude Code whichever agent ran setup. That is the honest form of parity here.

## 8. Automation runbook contract: the hosting conflict

- **Membership.** The manager is a locally hosted loop: its "registration" is the tmux session `start` creates, not `/schedule`. A one-paragraph `### Locally hosted loops` in the contract reference says so, and that such a loop records runs exactly like a scheduled one.
- **Status.** `resolveExpectedAutomationFleet` adds, **only when `config.sessionManager` exists**, one entry to `unsupported`:
  - `{id:"session-manager", automationId:"<prefix>session-manager", group:"opt-in", expectedCadence:"every <interval> (tmux-hosted /loop)", expectedRRule:<from interval>, runbookPath:".lisa/automations/session-manager.runbook.md"}`
  - reason: *"Hosted locally in tmux session `<name>` by /lisa:setup:session-manager, not by this runtime's scheduler, so the scheduler cannot see it. Its recorded cycles are below; check it is alive with `/lisa:session-manager status`."*
  - Both adapters already render runbook, last outcome and history for `unsupported` entries, so **no adapter or report change** is needed.
  - The label reads `UNSUPPORTED`. That is honest (the scheduler does not host it), and the reason says what to do. A dedicated `HOSTED` status is deferred (§10).
- **Teardown.** With `sessionManager` configured, fleet teardown and `/lisa:tear-down-automations session-manager` run `session-manager.mjs stop` (`tmux kill-session -t <name>`; a no-op if absent).
  - They never stop workers: those hold claimed work. Teardown lists the workers.
  - The runbook is left on disk, as for every loop.
- **Six-outcome mapping per cycle** (recorded with `record-cycle` at the end of every cycle; recording failure degrades, never aborts):
  - `nothing-needed`: no dispatch, no state change, no question relayed or pending-new. The summary states the denominator anyway: "swept N ready, 0 dispatchable; R running/C cap".
  - `change-proved`: at least one of: a worker was spawned and seen in `claude agents --json`; Blocked→Ready was written and read back; an answer was delivered (SendMessage acknowledged, or resume returned a session id); a stalled item was retried.
  - `approval-requested`: a question (worker or repo-routing) was forwarded and awaits the operator, and nothing else changed.
  - `recovery-required`: the tracker, Telegram or `claude` was unreachable; spawn failed after the claim (the item was moved back to Ready); an item was moved to Blocked after `maxAttempts`; a FAILED was received; the capacity probe failed.
  - `candidate-proposed`: **not used** by this loop (it files no build candidates). The runbook states this explicitly.
  - `policy-obsolete`: the retirement condition holds.
- **Retirement condition** (stateless, tracker-derived, per the contract):
  1. A date-filtered tracker search finds no item that entered the claimed role in the trailing 14 days.
  2. This cycle found zero Ready candidates.

  When both hold, record `policy-obsolete` and file **one** marker-deduped proposal (`[lisa-session-manager-retirement]`) via `lisa-tracker-write`, proposing `/lisa:tear-down-automations session-manager` or a longer `interval`. Keep running.
- **Runbook seed.** `references/runbook-template.md` is copied by setup to `.lisa/automations/session-manager.runbook.md`. It is checked in to the host project, not to Lisa.

## 9. Scope control

### 9.1 One PR or several
**Primary path: one PR, built in the dependency order of `tasks-4448.json`, with commit boundaries at task groups.**
- The item is a single leaf.
- The completion condition is one holistic verifier pass.
- `managedBy=` and the ordering module have exactly one consumer, this manager.
- Splitting would need sibling tickets to stay leaf-pure.
- Each commit keeps the system green: the additive modules come first, then the skills, then the registration, then generation.

**Fallback split** if review size becomes a problem (hand-written code is roughly 2.5–3.5k lines incl. tests; generated copies dominate the raw diff). File a sibling leaf for (a) and land it first:
- **(a)** `ready-queue-order.mjs` + `managedBy=` + `validateSessionManager` + config docs + gitignore. All additive; no behaviour change to any existing flow.
- **(b)** The manager scripts and skills, setup, doctor, automation registration and generation.

### 9.2 Cut or simplified from the issue spec
1. **No `lisa-tracker-queue` dispatcher skill.** That is three vendor surfaces plus a mapping-table row for one consumer. It is replaced by one ordering module plus per-vendor fetch recipes inside the manager skill. It can be promoted later if intake wants mine-first ordering.
2. **No `SM_*` env overrides.** Telegram `cap N` persists to the ledger `control.maxWorkers`, which the next `capacity` call reads. An env var cannot reach later Bash calls in a running session anyway.
3. **Blocked reconcile is limited to dependency blocks (repair-intake Class A) plus manager-owned blocks.** Gate self-blocks and clarification blocks stay with `lisa-repair-intake` and humans. This still satisfies the AC (D blocked on relations that are all resolved).
4. **In Progress reconcile is ledger-driven.** Only items the manager dispatched are examined. Items not in the ledger are "not yours" (the prototype rule), which avoids a project-wide claimed sweep.
5. **The `crossSessionInbound` doctor check is limited to managed settings,** the only scope that can override `--settings`.
6. **No `sessionManager` entry in `src/sync/registry.ts`.** Registering it would auto-populate an opt-in feature into every project.
7. **No `.sh` scripts and no separate settings JSON files.** The settings are generated inline by `launch.mjs`.
8. **Answer prefix is fixed to "Operator".** The skill always runs `route --owner Operator` instead of a configurable owner name, so relayed answers read "Operator's answer: …".

### 9.3 Out of scope (from the issue, plus)
- A shared multi-project bot.
- Multi-account load spreading.
- Cloud or remote execution.
- Configuring `sessionManager` in any downstream project.
- **Configuring it in Lisa's own `.lisa.config.json`.** Live verification uses the scratch repo.
- A `HOSTED` automation-status state.

## 10. Risks and open questions
1. **Coexistence with scheduled loops.**
   - `intake-repair` treats a claimed item with no activity for more than 2h (`intake.repair.staleAfterHours`) as stalled and **re-dispatches it in place in the cloud**, duplicating a live local worker.
   - `intake-tickets` competes for Ready items. That is harmless because the claim is the lock, but it is wasteful.
   - Mitigation: setup warns and recommends tearing down `intake-tickets` and raising `intake.repair.staleAfterHours` above `stall.noOutputMinutes × maxAttempts`, or tearing it down. There is no code coupling.
2. **`claude --bg` env inheritance.** If background sessions are spawned by a supervisor daemon first started from the manager's environment, `env -u` on the CLI may not reach the session.
   - The primary defence is that the plugin is not enabled in workers, so no poller starts.
   - The completion condition's "absent from the worker's own Bash output" check is the arbiter. Builder: verify this early (task T18 does it live).
3. **Interaction between the bg worktree and `lisa-implement` branching.** A `--bg` session moves into `.claude/worktrees/` before editing, and `lisa-implement` creates or reuses a feature branch. Verify in the live spawn that they do not fight. If they do, document it in the skill; do not add flags.
4. **Script root after a plugin upgrade** (§2.3). Old cache dirs may vanish under a running manager. Mitigated by the re-resolve note.
5. **The claim-in-child-cwd mechanism relies on the manager's Bash cwd persisting across calls** in a main Claude session. The skill must `cd` back to the root and verify it with `pwd` each cycle. The risk is that a misrouted cwd makes the next ledger write land in a child repo. Mitigation: every CLI call passes `--project-root <abs>` explicitly.
6. **Untrusted ticket text in a yolo session.** `trustedHumanActorIds` is "not a config schema" per `ready-role-filing`.
   - Open question: add an optional `sessionManager.trustedAuthorIds` (an explicit human-authored policy, which that rule permits), or rely on tracker permissions only?
   - Recommendation: the optional key, enforced in `orderReadyQueue`. The default (absent) dispatches any author, with a setup warning.
7. **Live Telegram verification is blocked.** No test bot exists (plan preflight: FAIL; BotFather is human-only). Steps 5 and 8 of the completion condition cannot run until the operator supplies a test bot token and pairs it.
8. **Live Jira/Linear queues are unavailable.** Neutrality is proven by normalizer and ordering fixture tests only (recorded `not_established` for live).
9. **`resolveAutomationProjectIdentity` throws without a GitHub identity.** A host root with no GitHub origin already cannot run automation-status. This is unchanged and noted, not fixed here.
10. **Open question: the `stop REF` Telegram command moves the item back to Ready.** It conflicts in spirit with repair-intake's "never reset stalled claimed items to ready". It is kept because it is an explicit human instruction. The comment says so.
