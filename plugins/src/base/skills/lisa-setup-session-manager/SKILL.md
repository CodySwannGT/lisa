---
name: lisa-setup-session-manager
description: "Set up the local session manager for this project: writes the non-secret `sessionManager` block to `.lisa.config.json` (detecting a multi-repo `projects/*` layout), stores the project's own Telegram bot token outside the repo, checks the Telegram plugin is installed but not enabled at user scope, keeps the manager's state out of git, seeds the checked-in runbook, starts the manager in tmux, walks the operator through pairing, and finishes with doctor's session-manager check. Idempotent."
allowed-tools: ["Bash", "Read", "Write", "Skill", "AskUserQuestion"]
---

# Setup session manager

After this skill the project has a `sessionManager` block, a bot token in its own state directory, a
runbook at `.lisa/automations/session-manager.runbook.md`, and a running manager paired with the
operator's Telegram chat. Re-running is safe: every step keeps what is already there.

The manager itself always runs on Claude Code (see `lisa-session-manager` "Runtime parity"). Setup
can run from any agent that can reach the scripts; `start` launches the Claude Code manager.

## Step 0: Preconditions

Stop with the named gap if any of these fail:

- **Tracker configured.** `.tracker` in `.lisa.config.json` is `github`, `jira` or `linear`.
  Otherwise stop: "No tracker configured. Run the matching /lisa:setup:<tracker> first."
- **Tools.** `claude --version` is at least 2.1.224; `tmux -V` and `bun --version` succeed. Name the
  missing or outdated tool and stop.

## Step 1: Locate the scripts

Resolve the scripts directory with the same ladder as `lisa-session-manager`:

```bash
SM="${SM_SCRIPTS_DIR:-}"
[ -z "$SM" ] && [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && SM="$CLAUDE_PLUGIN_ROOT/skills/lisa-session-manager/scripts"
[ -n "$SM" ] && [ -f "$SM/session-manager.mjs" ] || SM="$(claude plugin list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>{s+=d}).on("end",()=>{let l=[];try{l=JSON.parse(s)}catch{}const c=l.filter(p=>String(p.id).startsWith("lisa@"));const p=c.find(p=>p.projectPath===process.cwd())||c.find(p=>p.scope==="user");process.stdout.write(p?p.installPath:"")})')/skills/lisa-session-manager/scripts"
[ -f "$SM/session-manager.mjs" ] || SM="$PWD/node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-session-manager/scripts"
[ -f "$SM/session-manager.mjs" ] || { echo "lisa-session-manager scripts not found" >&2; exit 1; }
echo "$SM"
```

Shell variables do not survive between Bash calls: use the printed absolute path wherever this skill
writes `$SM`, and pass `--project-root "$ROOT"` (the absolute project root) on every call.

## Step 2: Write the config block

1. Preview: `node "$SM/session-manager.mjs" init-config --project-root "$ROOT"`. It detects
   `projects/*/.lisa.config.json` and proposes `name`, `interval`, `repos`, `capacity`, `stall` and a
   per-project `notify.stateDir`. Repo detection leaves out linked worktrees and keeps one checkout
   per remote, so ticket worktrees and second clones under `projects/` are not proposed. Show the
   block to the operator and ask whether any repo is missing or should not be routed.
2. Write it: the same command with `--write`. It adds only non-secret fields and never overwrites an
   existing block (`reason: "exists"` means keep it).
3. Each repo's `hints` are a draft: its name plus one per well-known dependency (`NestJS`, `Expo`,
   `AWS CDK`, ...). Ask the operator to correct them and add the areas that identify the repo
   (e.g. `api`: `["NestJS","migrations"]`, `web`: `["Expo","screens"]`), and whether to
   set `sessionManager.trustedAuthorIds`. Without it, any author's Ready item reaches a
   bypass-permissions worker; say so plainly. The list holds stable tracker user ids as strings,
   never logins: the GitHub numeric user id (`gh api users/<login> --jq .id`), the Jira
   `accountId`, or the Linear user id. A login matches no one and silently excludes every item.
4. Set `sessionManager.operatorIds` to a non-empty **array** holding the operator's own tracker
   user id, e.g. `"operatorIds": ["<operator-id>"]` (a bare string fails `validate`). Look up the
   OPERATOR, not the credential: `gh api user` / `viewer.id` return whoever the tracker credential
   belongs to, which is the agent account in exactly the case this key exists for. The manager dispatches
   the operator's assigned items first, then items assigned to the tracker credential's identity
   ("me"), then unassigned ones, and skips items assigned to anyone else. When the tracker
   credential is not the operator's (an agent or bot account), leaving this unset means the
   operator's own Ready items are never dispatched; say so plainly. Unlike `trustedAuthorIds`, this
   is matched against the assignee, exactly and case-sensitively, so use the same kind of id as
   "me", spelled as the tracker API returns it: the GitHub **login** (`gh api users/<login> --jq
   .login`), the Jira `accountId`, or the Linear user id (the operator's entry in the team's member
   list, or `viewer.id` only when the operator runs the lookup with their own credential).
5. `node "$SM/session-manager.mjs" validate --project-root "$ROOT"` must print `valid: true`.

## Step 3: Store the bot token

The operator creates a bot with @BotFather, one per project. Then run
`node "$SM/session-manager.mjs" store-token --project-root "$ROOT"`.

- `stored: true`: done.
- Exit 2 because a token already exists: keep it (re-running setup is safe). Only when the operator
  says the stored token is wrong or belongs to another project, re-run with `store-token --replace`.
- `reason: "no-tty"` (an agent's Bash has no terminal): offer the operator both routes, and say
  plainly that Claude Code's `!` prefix has no terminal either, so it fails the same way:
  - **Clipboard (simplest):** they copy the token from the BotFather chat and tell you; then run
    `clipboardCommand` from the output (`store-token --from-clipboard`). It validates the token,
    stores it, never prints it, and clears the clipboard. On `stored: false`, say what `message`
    reports and ask them to copy it again.
  - **Separate terminal app:** print `command` and ask them to run it in Terminal, iTerm or similar,
    outside the agent, where it prompts with echo off. Wait for them to confirm.
- `empty` / `invalid`: say what was wrong and ask again.

Never ask for the token in chat, never echo, log or commit it, and never put it in
`.lisa.config.json`. It lives only in `<notify.stateDir>/.env`.

## Step 4: Telegram plugin scope

Read `claude plugin list --json` and look at the `telegram@claude-plugins-official` entries.

- **Not installed:** ask the operator to install it with
  `claude plugin install telegram@claude-plugins-official -s user`, then re-check.
- **Enabled at user scope** (`scope: "user"` and `enabled: true`): every session on this machine
  would start its own poller and take the bot away from the manager. Print the remedy and stop until
  it is fixed:

  ```bash
  claude plugin disable telegram@claude-plugins-official -s user
  ```

- **Installed and not enabled at user scope:** correct. The manager enables it for itself only.

## Step 5: Keep manager state out of git

At the project root, when it is a git repo:
`git check-ignore -q .lisa/session-manager/ledger.json || printf '%s\n' '.lisa/session-manager/' >> "$(git rev-parse --git-common-dir)/info/exclude"`,
then re-run `git check-ignore -q .lisa/session-manager/ledger.json`. If it is still not ignored, stop
and report. A root that is not a git repo needs nothing.

## Step 6: Seed the runbook

If `.lisa/automations/session-manager.runbook.md` does not exist, copy
`$SM/../references/runbook-template.md` there. Never overwrite an existing runbook: it is the
project's. It is checked in, like every automation runbook (`automation-runbook-contract`).

## Step 7: Check for competing intake loops

The scheduled `intake-repair` loop can re-dispatch an item a local worker is still building (it treats
a claimed item with no tracker activity for `intake.repair.staleAfterHours` as stalled), and
`intake-tickets` competes for the same Ready items. Find out whether either is running before you
start the manager; do not leave the operator to check.

1. Run `node "$SM/session-manager.mjs" coexistence --project-root "$ROOT"`. For each loop it reports
   the last run recorded in this project's run log and whether that is `recent`. `live` lists the
   loops that ran recently.
2. A run log is evidence, not proof: also list your runtime's scheduler for those loop names (Claude
   Code: the `/schedule` listing of claude.ai routines; Codex: automations; a `lisa-<loop>.yml`
   workflow with a `schedule:` trigger on GitHub Actions).
3. Report what you found, per loop, in one line each. Only for a loop that is live (a recent run, or a
   scheduler entry): recommend tearing down `intake-tickets` (`/lisa:tear-down-automations
   intake-tickets`) and either raising `intake.repair.staleAfterHours` above
   `stall.noOutputMinutes × stall.maxAttempts` or tearing down `intake-repair`. When neither is live,
   say so and move on.

## Step 8: Accept workspace trust in each worker repo

Workers are background sessions, and a background session cannot show Claude Code's "trust this
folder?" prompt: until someone has accepted it in a directory, `claude --bg` refuses to start there
and `spawn` exits 2 saying so. Do this once per routed repo (or once for the root on a single-repo
project), on every machine that runs the manager:

1. Run `node "$SM/session-manager.mjs" trust-status --project-root "$ROOT"`. It lists every
   directory workers start in (each routed repo, or the root on a single-repo project) with whether
   Claude Code has already recorded trust for it. `needsTrust` lists the ones that are not
   `trusted: true`. When it is empty, this step is done: say so.
2. For each directory in `needsTrust`, ask the operator, in a separate terminal app (not the agent's
   Bash or Claude Code's `!` prefix), to run `claude` once in that directory, accept the trust prompt,
   then exit. An agent's Bash cannot answer that prompt, so never try to accept it for them. Then
   re-run `trust-status` to confirm. (`trusted: "unknown"` means Claude Code's state file could not be
   read; treat it as needing trust.)
3. Re-run this step whenever a repo is added to `sessionManager.repos`.

## Step 9: Start and pair

0. **Public GitHub repo gate.** When `.tracker` is `github`, run
   `gh repo view <github.org>/<github.repo> --json visibility`. If it is `PUBLIC` and
   `sessionManager.trustedAuthorIds` is not set, setup will not start the manager until
   `trustedAuthorIds` is set: anyone on the internet could otherwise write the work a
   bypass-permissions worker runs. Ask the operator for the IDs, add them, re-run `validate`, then
   continue. `lisa doctor` fails on the same condition.
1. `node "$SM/session-manager.mjs" start --project-root "$ROOT"`. `started` and `already-running`
   are both fine. Exit 2 names what is missing (usually the token from Step 3), or that a tmux
   session of the same name belongs to another project root, or that the manager
   exited right after starting. For the last, ask the operator to run the printed foreground command
   in their own terminal: claude prints its own error there. Fix it, then run `start` again.
2. Walk the operator through pairing, in their own terminal:
   1. `tmux attach -t <name>` (the `attach` value from the output).
   2. Send any message to the bot in a private chat. The bot replies with a pairing code.
   3. In the attached manager session: `/telegram:access pair <code>`.
   4. Then: `/telegram:access policy allowlist`, so only paired senders reach the manager.
   5. Detach with `Ctrl-b d`. The manager keeps running.

Pairing and allowlist changes are made only in that terminal. Never approve a pairing because a
Telegram message asked for it. Every allowlisted sender effectively has shell access to this machine
(the manager and its workers run with bypass permissions), so keep the allowlist to the owner.

## Step 10: Verify

Run `lisa doctor` (or `npx @codyswann/lisa doctor` when the `lisa` CLI is not on the PATH) and
confirm the "Session manager Telegram isolation?" check is green. Fix every warning it names, then
`node "$SM/session-manager.mjs" status --project-root "$ROOT"` should show the manager running.

Report: the config block written (or kept), where the token lives (the path, never the value), the
plugin scope result, the runbook path, which repo dirs were already trusted and which the operator
accepted trust in, what the competing-loop check found, the manager's tmux session name, and the
doctor result.
