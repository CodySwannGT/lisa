---
name: lisa-enforce
description: "Make the declared checks of a repository actually run: install what runs them at commit, at push and after a coding agent edits a file, file a ticket for each requirement the repository has nothing for, compare the hosting platform's merge settings with the control register, and report one outcome for every Level 1 requirement. Adds no check of its own and proves nothing."
allowed-tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill"]
---

# Enforce: $ARGUMENTS

Make the control register real. Configure wrote down which checks govern this repository; until
something runs them, they govern nothing. Enforce is the third of four steps (audit, configure,
enforce, attest). It does three things, in order, and then says where every requirement stands:

1. it installs the **carriers**: the small pieces that run the declared checks when code is
   committed, when it is pushed, and after a coding agent writes a file;
2. it files **one ticket** for each requirement the repository has nothing for;
3. it compares the hosting platform's **merge settings** with the register, and either hands the
   difference to an administrator or, when the operator says so, applies it.

Enforce **wires what was declared. It declares nothing and it proves nothing.** A check nobody
declared is sent back to the configure step. Whether a check really stops a bad change is what the
attest step proves, by code.

The operator may name the folder of the repository to enforce, and may add `build_ready=true`
(`$ARGUMENTS`). With no folder named, enforce the repository this session is in.

**Running it.** Claude Code, Cursor, OpenCode, Antigravity and Copilot: `/lisa:enforce`. Codex has
no slash commands: `$lisa-enforce`. Devin has no plugin command surface: `/lisa:lisa-enforce`. The
skill comes with the Lisa plugin for the agent in use.

## Ground rules

These hold in every step.

1. **Change only what the three steps write.** The commands of steps 3, 5 and 7 decide what is
   written, and you write nothing in the repository by hand except where step 4 says so. What they
   write: the program that runs the checks under `scripts/`, hook scripts under `.lisa/hooks/`,
   `.lisa/controls/carriers.json`, one ignore entry for that program's timing files, one hook
   entry in each coding agent's own settings file, the git setting that makes git run the hooks in
   this checkout, `.lisa/controls/register.json`, and `.lisa/controls/merge-protection-change.md`.
   In `.lisa.config.json` two things may change and no others: the carriers command may record a
   coding agent that cannot be enforced on, and step 4 may name the pipeline file it writes.
   Nothing is committed, pushed or staged. Everything you set aside while you work goes in a
   folder in the system's temporary folder, outside the repository.
2. **Enforce adds no check.** Never add a gate, a part, a moment or a threshold to
   `.lisa.config.json`, and never change one that is there. A check that should exist and is not
   declared is reported in your closing message, with the way to get it declared: run
   `/lisa:audit` so the audit finds it, then `/lisa:configure` so the operator decides it. That
   holds for every check, including one Lisa itself ships a program for.
3. **Never change merge settings unasked.** The merge-protection command reads and never changes
   anything unless it is given `--apply`. You never add `--apply` yourself. Step 7 says how to ask
   the operator, and only a clear yes to that exact change allows it.
4. **Tickets wait for a person unless the operator said otherwise.** A ticket for a missing
   capability is filed on hold. It is filed ready to build only when the operator passed
   `build_ready=true` to this command.
5. **Code decides every outcome.** You do not judge whether a requirement is wired, ticketed or
   waiting. Step 8 does. Never say an outcome that its report does not say, and never edit a
   result a command printed.
6. **Fix nothing.** A check that fails on the code as it stands is reported, with what it printed.
   Making the code pass is other work. Never weaken, switch off or remove a check to make it pass.
7. **Write for someone who does not code.** Everything the operator reads is plain language: no
   requirement ids, no stack traces, and no tool or file-format name used as if it explained
   itself.
8. **Name a secret, never show it.** If anything you quote contains a password, key or token,
   write the name it goes by and leave the value out.

## How to run the Lisa commands

Some steps run a command written here as `lisa …`. Run it from the root of the repository being
enforced, using the first of these that passes the check in step 1, and keep to that one for the
whole run:

1. `lisa …` when `lisa` is on the PATH.
2. `bunx @codyswann/lisa …`
3. `npx --yes @codyswann/lisa …`
4. `bunx @codyswann/lisa@latest …`, when the copy the others found is too old.

If none of them runs at all, the machine has neither Bun nor Node.js: stop, and tell the operator
that enforcing needs one of them installed and that nothing was changed.

## Steps

Run the steps in order. Each one says what it **needs** from the steps before it and what it
**hands on**, so a step can be read, repeated or added to without rereading the others.

### Step 1: Preflight

**Needs:** nothing. **Hands on:** the repository root, a way of running Lisa that is known to
work, and the results folder.

1. Find the root of the repository being enforced. Run this inside the folder the operator named,
   or inside the folder this session is in when none was named:

   ```bash
   git rev-parse --show-toplevel
   ```

   The folder it prints is the repository root. Every later command runs from it. If the folder
   is not a git repository, stop: there is no commit or push to run a check at. Tell the operator
   so, and that nothing was changed.
2. Check that the copy of Lisa you are about to use knows the `controls` commands:

   ```bash
   lisa --help
   ```

   The list of commands it prints must include `controls`. If it does not, that copy of Lisa is
   older than this skill. **Do not run any `lisa controls …` command with it:** an older copy takes
   `controls` for the name of a folder to set Lisa up in. Move to the next way of running Lisa in
   "How to run the Lisa commands" and check that one the same way. If none passes, stop and tell
   the operator that enforcing needs a newer Lisa and that nothing was changed.
3. Make the results folder, in the system's temporary folder:

   ```bash
   mktemp -d "${TMPDIR:-/tmp}/lisa-enforce.XXXXXX"
   ```

   The path it prints is the **results folder**. Three of the commands below print their result
   and keep nothing, so you save each result there and name the files to the command of step 8.
   Remember the path. Never make this folder inside the repository.

### Step 2: Confirm there is something to enforce

**Needs:** the repository root and the results folder. **Hands on:** an audit report that can be
relied on, and a declaration it supports.

Enforce acts on what the audit found and on what configure declared, so both have to be there
before anything is installed. First the audit report:

```bash
lisa controls gaps > "<results folder>/gaps.json"
```

- **Exit 0.** The audit report is there and valid. The saved file lists the requirements the
  repository has nothing for; step 6 files a ticket for each.
- **Any other exit.** Stop. There is no audit report, or not one that can be relied on. Each line
  printed is one problem. Tell the operator that the next step is `/lisa:audit`, and that nothing
  was changed.

Then the declaration:

```bash
lisa controls declaration-check
```

- **Exit 0.** The checks are declared and the audit supports each one. Go on.
- **Any other exit.** Stop. Each line printed is one problem. A declaration the audit does not
  support means the configure step is not finished: tell the operator that the next step is
  `/lisa:configure`, and that nothing was changed.

### Step 3: Install the carriers

**Needs:** a checked declaration and the results folder. **Hands on:** the saved carriers result.

First find out, without writing anything, who runs hooks in this repository today:

```bash
lisa controls install-carriers --check > "<results folder>/carriers-check.json"
```

It prints one JSON document whatever it finds; an exit code of 2 or 3 is expected here. Read
`enforcement_points` in the saved file. Each entry has a `wired_through`.

- **Any entry says `lisa-stack-hook`.** The repository is on a project type Lisa ships checks
  for, and that type's own hooks, with Lisa's plugin for each coding agent, already run the checks
  at commit, at push and after an edit. Run the command below **without** the `--agents` option,
  so that nothing is run twice.
- **No entry says that.** The checks also have to run after a coding agent writes a file. The
  command needs to know which coding agents work on this repository: `claude`, `codex`, `cursor`,
  `opencode`, `agy`, `copilot`, `devin`, separated by commas, or `fleet` for all of them. Take the
  names from the `harness` setting of `.lisa.config.json` when the file has one (`fleet`, `all`
  and `both` each mean `fleet`). When it has none, ask the operator, in one plain question, which
  coding agents people use on this repository. If nobody is there to answer, run the command
  without the `--agents` option and say in your closing message that checks after an edit are
  waiting on that answer.

```bash
lisa controls install-carriers --agents="<agents>" > "<results folder>/carriers.json"
```

- **Exit 0.** The carriers are in place. Go on.
- **Exit 2.** At least one place is blocked. The saved result is complete and says which and why.
  Go on: step 8 reports it. Do not work around a blocked place by editing a hook file yourself.
- **Exit 1.** There is no result. Show the operator the lines it printed, and stop.

Never edit the saved file, and never save the result of the `--check` run as `carriers.json`: a
check installs nothing.

### Step 4: Write the pipeline file, on a platform other than GitHub

**Needs:** the carriers. **Hands on:** the file that runs the checks on a proposed change, where
Lisa ships none.

Only when the repository is hosted somewhere other than GitHub and a check is declared to run on a
proposed change (`pull-request`). Follow `references/pull-request-executor.md` from start to
finish. It is the one place in this skill where you write a file by hand, and it says exactly
what that file must do. Tell the operator plainly what it means: Lisa did not write that file and
nothing in this release can prove a check on that platform, so every rule it runs stays marked
unproved.

On GitHub, and when nothing is declared for a proposed change, skip this step.

### Step 5: Bring the control register up to date

**Needs:** the carriers, and the pipeline file where step 4 applied. **Hands on:** a register that
says what the declaration now says.

Installing carriers for the coding agents can record, in `.lisa.config.json`, an agent that has no
way to refuse a file write. The register is generated from that file, so generate it again now.
Never write or edit the register yourself.

```bash
lisa controls register
```

Then confirm the file on disk is exactly what the declaration produces:

```bash
lisa controls register --check
```

It must exit 0. If either command refuses, each line printed is one problem: stop, and tell the
operator what it says.

### Step 6: File a ticket for each missing capability

**Needs:** the register and the results folder. **Hands on:** the saved ticket results.

A requirement the repository has nothing for cannot be enforced by installing a hook. It is work,
and work belongs in the tracker. Follow `references/missing-capability-tickets.md` from start to
finish. Give it `build_ready` as `true` only when the operator passed `build_ready=true` to this
command, and as `false` otherwise.

That flow returns one result for each missing requirement. Write them to
`<results folder>/tickets.json`, exactly as the flow returned them, in this shape:

```json
{
  "schema_version": 1,
  "results": [
    {
      "criterion": "SI8",
      "scope": "api",
      "key": "21d606d43cb0",
      "outcome": "ticketed",
      "ticket": "#412",
      "ticket_state": "created",
      "reason": null,
      "question": null
    }
  ]
}
```

- When nothing is missing, `results` is an empty list.
- When no tracker is configured, the flow files nothing. Write an empty `results` list: the
  command of step 8 marks each missing requirement as waiting on a tracker by itself.
- Copy `criterion`, `scope` and `key` from the output of `lisa controls gaps`. Never work one out.
- `ticket_state` is `created` only for a ticket this run filed, `existing` for one found from an
  earlier run, and `declined` for one a person closed as not planned.

The file is always written, even when it holds nothing, because step 8 refuses to run without it.

### Step 7: Compare the merge settings with the register

**Needs:** an up-to-date register and the results folder. **Hands on:** the saved
merge-protection result.

```bash
lisa controls protect > "<results folder>/protect.json"
```

Run exactly that. It only reads the hosting platform. Where a declared check is not yet required
before a change can be merged, it writes `.lisa/controls/merge-protection-change.md`, which says
to an administrator which setting to change and to what.

- **Exit 0.** Every declared check is required, or the register asks nothing of the merge
  settings. Go on.
- **Exit 2.** At least one check is not known to be required. The saved result is complete. Read
  its `permission` and `differences`.
- **Exit 1.** There is no result. Show the operator the lines it printed, and stop.

**Asking before any change.** Only when the result's `permission.can_change` is `true` and
`differences` is not empty may the settings be changed from here, and only after the operator
agrees. Ask one plain question, listing each line of `differences` in words:

> Right now a change can be merged into the main branch without these checks passing: the style
> check. I can change the repository's merge settings so that they must pass first. That affects
> everyone who merges into this repository, from the moment I do it. Shall I make that change now?
> If you would rather an administrator did it, the file `.lisa/controls/merge-protection-change.md`
> says exactly what to set.

On a clear yes, and only then, run the same command again with `--apply` added before the `>`, and
save its result over `protect.json`. On a no, on no answer, and whenever `can_change` is not
`true`, change nothing: the handover file is the result, and your closing message says who it is
for. Never read a general instruction to "enforce everything" as that yes.

### Step 8: Get the outcome of every requirement

**Needs:** the three saved results and an up-to-date register. **Hands on:** the report.

```bash
lisa controls enforce-report --carriers "<results folder>/carriers.json" --tickets "<results folder>/tickets.json" --protect "<results folder>/protect.json"
```

It prints one JSON document and writes nothing in the repository. The document is long: save it
in the results folder if you need to keep it. It also runs each required check once, in a
temporary copy of the main branch's last commit that it removes afterwards, so it can take as long
as the checks do.

- **Exit 0.** Every requirement has exactly one outcome.
- **Any other exit.** There is no report. Each line printed names what could not be relied on: a
  result file that is absent or empty means the command behind it failed, so go back to that step;
  a register that changed means steps 5 and 7 have to be run again. Never write a result by hand
  to get past this, and never report outcomes of your own.

Read these fields:

| Field | What it holds |
| --- | --- |
| `criteria` | One entry for every requirement. `question` is the requirement in plain words, `outcome` is the one thing to say about it, `reason` says why, and `tickets` holds the tickets filed for it. `criterion` is the requirement's id: never say it to the operator. |
| `counts` | How many requirements have each outcome. |
| `entries` | One entry for every declared check, with each moment it is declared at and whether something runs it there. |
| `currently_failing` | The required checks that do not pass on the main branch as it stands. `gates` lists each one with the `command` that was run and `output_excerpt`, the end of what it printed. `not_measured` lists the ones that gave no answer, and `reason` says how the checks were run or why they were not. |
| `changes` | Everything the three steps said they changed in this run. An empty list means this run changed nothing. |
| `limits` | What the result does not show, each as one plain sentence. |

The four outcomes:

| `outcome` | What to tell the operator |
| --- | --- |
| `wired` | It is now checked automatically, and when. |
| `ticketed` | Nothing does this yet; a ticket was opened for the work. Give the ticket. |
| `blocked` | It is waiting on somebody. `reason` says who and exactly what for. |
| `nothing-to-enforce` | Nothing needed switching on: it does not apply here, or it is met by a written record or a person's word. The attest step says whether what is there is enough. |

### Step 9: Confirm what changed, and clear up

**Needs:** the report. **Hands on:** the list of files this run touched.

```bash
git status --porcelain --untracked-files=all
```

Every path listed that was not there before this run must be one ground rule 1 names. If anything
else appears, this run changed something it must not: remove only what you yourself created, and
never delete, restore or reset anything you did not create.

When the report's `changes` is empty, the control register was already up to date, and nothing new
is listed here, this run changed nothing: that is what a second run looks like.

Then remove the results folder:

```bash
rm -r "<results folder>"
```

### Step 10: Tell the operator

**Needs:** the report and the result of step 9. **Hands on:** the closing message.

In plain language, for someone who does not code, naming each requirement by its `question` and
never by its id:

1. **The picture in one line:** how many requirements are now checked automatically, how many
   have a ticket, how many are waiting on somebody, and how many needed nothing switched on.
2. **What is now checked automatically:** each `wired` requirement, with when its check runs.
3. **What has a ticket:** each `ticketed` requirement with its ticket, and whether the tickets
   are on hold until a person releases them or were filed ready to build.
4. **What is waiting on you:** each `blocked` requirement, with exactly what is needed and from
   whom, taken from its `reason`. Group the ones that wait on the same thing: one answer in
   `.lisa/audit/report.md`, one tracker to set up, one administrator to change the merge settings
   as `.lisa/controls/merge-protection-change.md` says, one decision in `/lisa:configure`.
5. **What needed nothing switched on:** how many, and in one sentence why.
6. **What does not pass today.** For each entry of `currently_failing.gates`: which check, in
   which part of the repository, and the end of what it printed. Say that this is the code on the
   main branch as it stands, that from now on a change is stopped until that check passes, and
   that making it pass is separate work this step did not do. If the checks were not run, say why.
7. **What changed in this run:** the files written, the tickets created, and any change to the
   merge settings. When nothing changed, say that plainly.
8. **What this result does not show.** Say every sentence of `limits`, leaving none out. In
   particular, whenever they are there: that a check on a proposed change on a platform other
   than GitHub cannot be proved in this release and stays marked unproved; that on Copilot and
   Devin it is assumed, not measured, that a failed check stops the agent; that Antigravity
   cannot refuse a file write, so nothing is enforced there after an edit; and that git runs the
   hooks in this checkout only, so each teammate runs `lisa controls install-carriers` once in
   their own.
9. That nothing was committed: the files this run wrote are in the working copy for the operator
   to review and commit together.
10. The next step: `/lisa:attest` plants a change that breaks each rule and a change that does
    not, and records whether each check really stops the first and lets the second through.

Say "wired" only of what the report says is wired, and never say that a check works: enforce
shows that something runs it, not that it stops a bad change.
