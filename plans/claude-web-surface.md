# Claude Code web as a first-class secrets/execution surface

## Context

`plans/portable-secrets-remote-execution.md` shipped a two-axis model — **provider**
(where secrets live) × **surface** (how they reach running code) — and implemented
exactly one remote surface: `codex-cloud`. Its own scope note says the shape is
"deliberately surface-agnostic so Claude Code web, Cursor remote, and others slot in
without redesign."

They have not slotted in. Today a Lisa skill running inside a Claude Code cloud
session falls through `detectSurface` to `local`, which carries
`mayWriteValues: false` — so materialization refuses, the resolver attempts a live
provider read, and there is no keychain to read from. **The credential manager is
unreachable on that surface.** Claude gets `lisa-analyze-claude-remote` and
`lisa-generate-claude-remote-build-script` (May–Jun 2026): an audit and a one-shot
script generator, with no secrets contract, no verify read-back, and no dispatch.

Parity across every supported coding agent is a project rule in `AGENTS.md`, and
Claude is the reference implementation — so it being the *least* supported remote
surface is backwards.

The intended outcome: `executionEnv=claude-web` works end to end — provisioned,
verified, dispatched, scheduled — through the same `lisa-secrets-access` chokepoint,
with the surface's genuine differences expressed as explicit branches rather than
silently papered over.

## What is actually different about this surface

Four findings from the docs drive every design decision below. They are not
cosmetic; three of them break an assumption the Codex implementation is built on.

| | Codex Cloud | Claude Code web |
|---|---|---|
| Environment bound to a repo | **Yes** | **No** — environment is `{network, env vars, setup script}` only; repo arrives per session |
| Environment owned by | The repo | The **account** (personal or org-shared); no API, no settings URL |
| Setup script on resume | Re-runs | **Skipped** whenever a filesystem cache exists (~7d, or on script/allowlist edit) |
| Secrets store | Provider-backed | **None** — env vars are plaintext and "visible to anyone who uses the environment" |

Consequences, in order of severity:

1. **Setup ≠ maintenance here.** The Codex entrypoint's core claim — "running it on
   resume is what picks up a rotated value" — is false on Claude. A rotated
   credential would go stale until cache expiry.
2. **Provisioning is emit-tier only.** B.4 tier 1 (API) and tier 2 (browser) are both
   unavailable: the environment dialog has no API and, per the docs, *"no settings
   page or direct URL for the selector."* `/remote-env` only *selects* an
   environment; it cannot create or edit one. B.5 still holds — the read-back is
   tier-independent and runs inside a session.
3. **Only the bootstrap variable may enter the env-var box**, and an org-shared
   environment broadcasts it to every member. Lisa already has exactly the right
   shape here (`secrets.bootstrap.sources` / `.key`, from PRs #2157/#2159).
4. **`GITHUB_TOKEN` reads as the literal string `proxy-injected`** when the GitHub
   proxy handles auth. This is a live landmine: `checkRequired`
   (`doctor-secrets.mjs:57`) resolves a required name against `process.env[name]` and
   reports `ok` for any non-empty value. `proxy-injected` passes the check and is
   unusable by any script that reads it.

One finding cuts the other way and is worth banking: **plugins declared in the
repo's `.claude/settings.json` are installed at session start from the declared
marketplace**, and `github.com` is on the Trusted allowlist. Lisa reaches a Claude
cloud session through its normal marketplace path — the `node_modules` fallback that
PR #2161 added for Codex is a belt-and-braces path here, not the only one.

5. **The repo-per-environment difference has a second edge.** Because the environment
   carries no repository, a session or routine may attach *several*, and project
   settings are documented to load "only from your starting directory". If that holds
   here, `enabledPlugins` — and therefore all of Lisa — loads from one attached repo
   and not the rest, silently. Unsettled; see [U5](#u5--open-which-repository-owns-a-multi-repo-session).

## Decisions

- **Dispatch** — ~~shell out to `claude --cloud`~~. **Superseded by the U1 probe on
  2026-08-03: `claude --cloud` refuses non-interactive invocation and therefore
  cannot be a dispatch mechanism.** The routine `/fire` endpoint is the only
  programmatic path, and now carries both dispatch and scheduling. See U1 below.
- **Materialize phase moves to a SessionStart hook** gated on
  `CLAUDE_CODE_REMOTE=true`, committed to the repo's `.claude/settings.json`. The
  setup script keeps toolchain + project hook. Secrets are then fresh on *every*
  session including resumed ones — stronger than the Codex arrangement — and the
  hook is repo-owned, which claws back the ownership lost to an account-scoped
  environment.
- **Do not touch the Codex path.** Its re-run-on-resume behaviour is correct for
  that surface. The split is surface-conditional, like `mayWriteValues` before it.
- **`gh` goes in the toolchain `install` list** for this surface. It is not
  pre-installed, and Lisa leans on it throughout.

## Open unknowns — settle by live probe before building

The parent plan's Session 3 overturned a documented assumption by dispatching three
read-only probes. Same discipline applies. All four are cheap, and U1/U4 change code
shape rather than just prose.

| # | Question | Why it blocks |
|---|---|---|
| ~~U1~~ | ~~What does `claude --cloud` print on success…~~ **ANSWERED 2026-08-03 — `claude --cloud` cannot be used for dispatch at all.** | See below. |
| U2 | Does a SessionStart hook run before the first agent turn in a cloud session, and does a value written to `$CLAUDE_ENV_FILE` reach later Bash calls? | The whole materialize relocation rests on this. |
| U3 | Confirm `CLAUDE_CODE_REMOTE=true`, `GH_TOKEN=proxy-injected`, and that the setup script is genuinely skipped on a cache hit. | Surface detection and the `proxy-injected` verdict. |
| ~~U4~~ | ~~Can an environment be selected per `--cloud` invocation…~~ **ANSWERED 2026-08-03: no flag, but a settings key.** | See below. |
| U5 | In a session with several repositories attached, which one is the working directory, and do the others' skills, hooks and `enabledPlugins` load at all? | Whether Lisa reaches a multi-repo routine **at all**. See below. |

Probe from a throwaway repo with a read-only prompt (`report the value of $CLAUDE_CODE_REMOTE and exit`). Record answers in this file's Sessions table.

### U1 — answered, and it invalidates the original dispatch design

A non-interactive `claude --cloud` invocation from CLI 2.1.220 exits `1` in under a
second with:

```
Error: --cloud requires an interactive terminal.
Non-interactive invocations (piped stdout, --init-only, --sdk-url) run locally and
would silently ignore --cloud. Drop --cloud, or run from a TTY.
```

`lisa-remote-dispatch` calls `execFileSync(..., { stdio: ["ignore", "pipe", "pipe"] })`
— piped stdout, which is exactly the case this rejects. There is no non-interactive
escape hatch: `--print` *is* the non-interactive mode and is named in the refusal.

**This is a deliberate guard, not an obstacle to route around.** It exists so that a
scripted `--cloud` cannot silently execute locally while the operator believes the
work went to the cloud — the same failure class the parent plan's C.1 rule addresses
("a skill that does not support `executionEnv` must reject it explicitly, never
ignore it"). Wrapping the call in a PTY to defeat it would reintroduce precisely the
silent-local-execution risk the guard prevents.

`claude --cloud` therefore stays what it is: a human-at-a-terminal affordance, and
the vehicle for this plan's end-to-end verification. It is not plumbing.

**Corrected design.** `executionEnv=claude-web` dispatches by POSTing to a routine's
`/fire` endpoint. This is better than the Codex path in three ways and worse in one:

- The response is structured JSON (`claude_code_session_id`,
  `claude_code_session_url`), so `extractTaskId`'s regex-scraping has no analogue
  here — the identifier is a field, not something parsed out of console output.
- The dispatching machine needs no CLI and no claude.ai login, only the bearer
  token. The laptop stops being a launcher at all.
- Dispatch and schedule collapse into one mechanism: a routine carries a cron
  trigger and an API trigger simultaneously, so Part D stops needing a separate seam.
- **Worse:** a routine is a saved config created on the web, so there is one routine
  per dispatch target, created by hand — the same emit-tier constraint as the
  environment itself.

The `text` field carries the work item. Per the docs it arrives wrapped in a
`<routine-fire-payload>` block explicitly labelled untrusted, and *"a routine's saved
prompt must opt in to acting on fire text."* That is the parent plan's C.5 boundary
("the ticket body is untrusted input") enforced by the platform rather than by
convention — so the emitted routine prompt must reference the payload deliberately,
e.g. *"Run the Lisa skill named in the routine-fire-payload block."*

The bearer token becomes the dispatcher credential, resolved through
`lisa-secrets-access` and never stored in config. It can be regenerated and revoked,
so it belongs in `secrets.rotating` — mirroring the parent plan's D.3 observation
that the dispatcher's own credential exercises the rotating path.

### U4 — answered: no flag, but the choice is a settings key

CLI 2.1.220 has no per-invocation environment option. `--environment` appears in
the binary but is Bun runtime noise — Claude Code ships as a Bun-compiled
executable, and Commander rejects the flag exactly as it rejects a nonsense one:

```
--definitelynotaflag   -> error: unknown option '--definitelynotaflag'
--environment          -> error: unknown option '--environment'
```

The selection is nonetheless expressible per invocation, because `/remote-env` is
only a picker that writes `remote.defaultEnvironmentId` into user settings, and
`--settings` accepts inline JSON:

```sh
claude --cloud --settings '{"remote":{"defaultEnvironmentId":"<id>"}}' '<prompt>'
```

Two consequences for this plan. First, nothing here is load-bearing for dispatch —
U1 already moved that onto the routine `/fire` endpoint, and this affects only the
interactive and verification paths. Second, `remoteEnv.surfaces["claude-web"]`
should **not** carry an `environmentId` as though it were a binding: the durable
handle is the routine, and an environment recorded in config would imply an
enforcement this surface cannot provide. A repo's project settings outrank
`--settings` for the same key, which is a further reason not to write it there.

### U5 — open: which repository owns a multi-repo session

A Codex environment binds to one repository. A Claude environment binds to **none** — it is
`{network access, environment variables, setup script}` and nothing else, and the repositories
arrive per session or per routine: *"Add one or more GitHub repositories for Claude to work in.
Each repository is cloned at the start of a run, starting from the default branch."*

So "which repo does this environment use" is not a question the model supports. The real question
is which of several attached repositories supplies configuration, and the docs do not answer it.
Checked: the web, quickstart, cloud-environments, routines, settings, `.claude`-directory and
large-codebases pages.

What **is** documented, and frames the answer:

- Everything config-like arrives in the clone, never from the environment — `CLAUDE.md`,
  `.claude/settings.json` hooks, `.mcp.json`, `.claude/rules/`, `.claude/skills|agents|commands`,
  and plugins declared in `.claude/settings.json`, which are *"installed at session start from the
  marketplace you declared."*
- *"Project settings in `.claude/settings.json` load only from your starting directory and are not
  inherited from parent directories the way CLAUDE.md files are."*
- *"In a cloud session, Claude Code runs hooks from the repository and from your organization's
  server-managed settings."* Singular.
- For directories added beyond the working directory, the loading rules differ by mechanism:
  `additionalDirectories` loads **neither** skills nor `CLAUDE.md`; `--add-dir` loads skills, and
  loads `CLAUDE.md`/rules only under `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`.

**Why this blocks.** Lisa reaches a cloud session through `enabledPlugins` in the repo's
`.claude/settings.json`. If that file only loads from the primary repository, then a routine whose
primary repo is not the Lisa-configured one gets no Lisa skills and **no PreToolUse enforcement**,
with no error — the same silent-zero-enforcement failure already recorded for plugin-less cloud
sessions. A multi-repo routine would look like it was governed and not be.

#### The probe

Two throwaway private repositories, identical layout, different marker strings. Purpose-built
rather than real repos, because Lisa's skills arrive from the *marketplace plugin* and would
appear whichever repo is primary — only repo-local markers discriminate.

```
CLAUDE.md                          ALPHA_CLAUDE_MD_LOADED
.claude/settings.json              SessionStart hook: echo ALPHA_HOOK_FIRED
.claude/skills/probe-alpha/SKILL.md   ALPHA_SKILL_LOADED
.claude/rules/probe-alpha.md          ALPHA_RULE_LOADED
```

`probe-repo-beta` is the same with `ALPHA` → `BETA`. Nothing writes, installs, or reaches the
network; the hook is an `echo`.

Read-only prompt, answers one per line as `N: <answer>`, `ABSENT` rather than a guess:

```
1.  pwd
2.  $CLAUDE_PROJECT_DIR
3.  ls -1 /
4.  find / -maxdepth 4 -name .claude -type d 2>/dev/null
5.  Which of these appear in your available skills: probe-alpha, probe-beta
6.  The full list of skill names available to you right now
7.  Which are in context from CLAUDE.md: ALPHA_CLAUDE_MD_LOADED, BETA_CLAUDE_MD_LOADED
8.  Which are in context from rules: ALPHA_RULE_LOADED, BETA_RULE_LOADED
9.  Which SessionStart markers you saw: ALPHA_HOOK_FIRED, BETA_HOOK_FIRED
10. $CLAUDE_CODE_REMOTE
11. $CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD
12. Any plugin-provided skills, and their namespaces

Then state which repository you consider your working directory.
```

Item 4 earns its place independently: it reveals the on-disk layout of a multi-repo session, which
no doc states.

**Two runs, order swapped** — `[alpha, beta]` then `[beta, alpha]` — because one run cannot
distinguish "first listed wins" from "alpha wins". Default environment, no setup script, **Run
now**; one-off runs are exempt from the daily routine cap.

| Observation | Conclusion |
|---|---|
| Items 1–2 follow the listed order across the two runs | primary = first listed |
| Items 1–2 name the same repo in both runs | order-independent; record the actual rule |
| `probe-beta` present in items 5–6 | secondaries attach with `--add-dir` semantics |
| `probe-beta` absent from items 5–6 | secondaries attach with `additionalDirectories` semantics — no config at all |
| `probe-beta` present but `BETA_CLAUDE_MD_LOADED` absent | matches the documented split; item 11 is then the lever |
| Only `ALPHA_HOOK_FIRED` in item 9 | **hooks and plugins are primary-repo only — the Lisa consequence is real** |
| Both markers in item 9 | hooks load from every attached repo; better than documented |

If item 7 comes back absent, set `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` in the
environment's variables box and re-run the first ordering. That tests whether the documented
workaround reaches this surface.

**Status: not yet run.** It needs an account with a multi-repo session available; deferred until
one is at hand. Record the answers in the Sessions table below and strike U5 when settled.

## Sequencing

Five PRs. Each carries `bun run build:plugins` **and**
`bun run build:upstream-evidence-manifest` in the same commit, with all five variants
(`plugins/src/base`, `lisa`, `lisa-cursor`, `lisa-agy`, `lisa-copilot`) regenerated.

### PR 0 — Probes

Settle U1–U4, record findings here. No source changes beyond this plan file.

### PR 1 — Secrets surface

The load-bearing PR; everything else composes on it.

- `lisa-secrets-access/scripts/surfaces.mjs` — add
  `"claude-web": { materialized: true, mayWriteValues: true }` to `SURFACES` (:32),
  and a `CLAUDE_CODE_REMOTE` branch to `detectSurface` (:59), ordered after the
  existing `GITHUB_ACTIONS` check.
- `doctor-secrets.mjs` — `checkRequired` (:57) gains a distinct verdict when a
  required name resolves to exactly `proxy-injected` on this surface: **not** `ok`,
  and the message names the proxy and the fact that scripts reading the variable get
  the placeholder rather than a token.
- `validate-config.mjs` — schema for `remoteEnv.surfaces["claude-web"]`.

Tests land beside the existing seven files in `tests/unit/secrets/`.

### PR 2 — Remote env setup, emit tier

- `lisa-setup-remote-env/scripts/setup-remote-env.mjs` — `main()` (:200) becomes
  surface-aware: on `claude-web` it runs toolchain + project hook and **skips** the
  secrets phase, printing why.
- `assets/session-start.sh` (new) — the materialize phase, gated on
  `CLAUDE_CODE_REMOTE`, reusing the same skill-resolution ladder already in
  `assets/setup.sh` (which correctly prefers `.claude/skills/` and falls back to
  `node_modules/@codyswann/lisa`).
- The emitter — produces the three paste-able field values (network access level,
  env-var block containing *only* the bootstrap variable, setup script), plus the
  `.claude/settings.json` SessionStart block, and states plainly that no API tier
  exists for this surface.
- `toolchain.mjs` — `gh` as an `install` entry.
- `verify-remote-env.mjs` — `main()` (:145) gains the `claude-web` read-back: the
  existing mode/notes/clean-checkout assertions plus the `proxy-injected` check and
  a `CLAUDE_CODE_REMOTE` assertion.

### PR 3 — Dispatch via the routine `/fire` endpoint

- `lisa-remote-dispatch/scripts/dispatch.mjs` — `EXECUTION_ENVS` (:27) gains
  `claude-web`. `assertPreconditions` (:103) becomes surface-aware: this surface
  requires `routineId` and `fireUrl`, and **not** `repository` — the repo is a
  property of the routine, recorded for the ledger rather than enforced as a binding.
- New `dispatchClaudeWeb` beside `dispatchCodexCloud` (:177): an HTTPS POST with
  `Authorization: Bearer <resolved through lisa-secrets-access>`,
  `anthropic-beta: experimental-cc-routine-2026-04-01`, body `{"text": prompt}`.
  It reads `claude_code_session_id` / `claude_code_session_url` straight from the
  response — `extractTaskId` (:125) is not extended to this surface, because there
  is nothing to scrape.
- Ledger entries carry `surface: "claude-web"`, the session ID, and the session URL.

### PR 4 — Scheduler, runbook, docs

Smaller than originally scoped: a routine's cron trigger and API trigger are the same
object, so registering a `claude-web` loop is the same emit-tier artifact PR 3
already produces, plus a schedule.

- `scheduler: "claude-routine"` in the `automations` block, registered emit-tier —
  config records `routineId` and `fireUrl`; the bearer token lives in the provider
  and is declared in `secrets.rotating`.
- `lisa-automation-status` stopped-clock detection for routines: paused schedule,
  daily-run-cap exhaustion, and a one-off routine that already fired and
  auto-disabled — the Claude analogues of GitHub's 60-day auto-disable. Note the
  1-hour minimum cron interval, which is coarser than the parent plan's hourly
  intake assumes in places.
- Runbook per the Automation Runbook Contract; `AGENTS.md` and `wiki/` updates.

## Verification

Unit and contract level:

```bash
bun test tests/unit/secrets/
bun run build:plugins && bun run build:upstream-evidence-manifest
git diff --exit-code   # manifest must be current in the same commit
```

End to end — this is the part that matters, and per
`feedback_verify_e2e_not_just_unit` it cannot be skipped:

1. Configure a **personal** (never org-shared) cloud environment with one bootstrap
   variable and the emitted setup script.
2. `claude --cloud "run /lisa:setup:remote-env verify"` against a real repo, and read
   the read-back output in the session. It must report the surface as `claude-web`,
   both file modes, every required variable, and the `proxy-injected` verdict —
   without printing a value.
3. Rotate one non-critical credential in the provider, start a **resumed** session,
   and confirm the SessionStart hook re-materialized it. This is the specific
   regression the design exists to prevent, and a cached session is the only place it
   shows up.
4. Dispatch one real ticket with `executionEnv=claude-web` through to a merged PR,
   per the parent plan's C.6 rule that a surface is proven on one real item before
   being extended.
5. Confirm `.lisa/remote-dispatch.json` carries the session identifier — a dispatch
   whose ID was not captured is treated as failed.

## Repository constraints

- Five-variant fanout; parity is a project rule, not a nicety.
- Manifest regeneration reads **tracked** files — run it after `git add`.
- Thresholds may only tighten.
- Merge with `--merge`, never `--squash`.
- `Closes #N` does not fire in this repo — close and relabel by hand.
- CI needs `Work-Item` in the PR **body** plus a `[lisa-pr-link]` backlink comment.

## Concerns to carry, not resolve

Stated plainly rather than designed around:

- **Claude Code on the web and routines are both research preview.** The `/fire`
  endpoint ships behind a dated beta header (`experimental-cc-routine-2026-04-01`)
  that rotates, with two prior versions honoured. Expect churn.
- **Personal vs org-shared environments are not programmatically distinguishable.**
  The rule that a bootstrap secret must not live in a shared environment is therefore
  documented and asserted at verify time by the operator — it cannot be enforced.
- **Routines run as an individual's account.** Commits, PRs, and connector actions
  appear as that person. That sits awkwardly against the "humans are not allowed
  inside a factory" premise in `AGENTS.md`: the loop has a human owner in a way the
  GitHub Actions clock does not. Worth a decision before Part D is enabled for a
  production loop, not before it is built.

## Sessions

| Session | Date | Phases | Notes |
|---------|------|--------|-------|
| 1 | 2026-08-03 | Research | Audited Claude Code web / cloud environments / routines docs against the shipped `codex-cloud` implementation. Confirmed `--cloud` and `--teleport` exist in CLI 2.1.220 but are hidden from `--help`. Established the four structural differences and the `proxy-injected` landmine. Plan created. |
| 3 | 2026-08-03 | PR 2 follow-up | Setting the surface up for real against a live Bitwarden project surfaced two defects unit tests could not: nothing ever installed `scripts/lisa-remote-env/` despite four references naming it (affects Codex identically), and the toolchain probe read any non-zero exit as a missing tool, so `require: unzip` failed on machines that had it — Info-ZIP's `unzip`, shipped by macOS and Ubuntu alike, exits 10 on `--version`. Settled U4: no per-invocation environment flag, but `--settings` can inject `remote.defaultEnvironmentId`. Verified the full chain end to end — keychain bootstrap, `bws` auth, materialization at 0700/0600 into a throwaway config root. |
| 2 | 2026-08-03 | PR 0 (probes) | Settled U1 by live invocation: `claude --cloud` refuses any non-interactive call (exit 1, <1s) and names `--print` among the rejected modes, so it cannot back `executionEnv`. Dispatch redesigned onto the routine `/fire` endpoint; PR 3 rewritten, PR 4 reduced. Verified account preconditions are met (`claude.ai` auth, Max, first-party) and that no `remote.defaultEnvironmentId` is saved in user settings, so CLI cloud sessions would fall back to the first available environment. U2–U4 still open — U3 and U4 now need a session started from the web or a TTY rather than a scripted dispatch. |
