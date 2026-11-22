---
name: lisa-attest
description: "Prove, by code, whether each…"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"]
---
Prove, by code, whether each declared check really stops a bad change, and report the Level 1 verdict that code computes. The agent reports the verdict and never edits it. Run before the enforce step, it finds the checks that exist and that nothing enforces.


# Attest: $ARGUMENTS

Find out whether the checks this repository declares really work, and tell the operator the result.
Attest is the last of four steps (audit, configure, enforce, attest).

**Code decides. You report.** Every result in this step comes from a `lisa controls` command: it
plants a change that breaks a rule, makes a real commit or push with it, and records what happened.
The verdict is computed from those records by code that asks no model anything. You run the
commands, read what they wrote, and say it in plain language. You never issue a verdict, never
improve one, and never repair one.

There are two kinds of run. Which one this is comes from the operator (`$ARGUMENTS`):

- **The attest run**, the normal one, after the enforce step: prove every declared check, compare
  the record with what is installed, and present the Level 1 verdict. Steps 1 to 8.
- **The before-enforce run**, when the operator asks for it (`--before-enforce`, or "before
  enforce" in their own words): before anything is installed, find the checks that exist and that
  nothing enforces. It gives a diagnosis, not a verdict. Step 1, then "The before-enforce run".

The operator may also name the folder of the repository (`$ARGUMENTS`). With nothing named, work in
the repository this session is in.

**Running it.** Claude Code, Cursor, OpenCode, Antigravity and Copilot: `/lisa:attest`. Codex has
no slash commands: `$lisa-attest`. Devin has no plugin command surface: `/lisa:lisa-attest`. The
skill comes with the Lisa plugin for the agent in use.

**Where coding agents differ.** What an agent cannot do the way this skill describes it:

- **Codex, Devin:** the skill is started directly there, with no command file in front of it to
  pass on what the operator named. Wherever this skill says `$ARGUMENTS`, read what the operator
  wrote when they started it.

## Ground rules

These hold in every step.

1. **The result files belong to the commands.** `lisa controls attest` writes three files:
   `.lisa/controls/evidence.json`, `.lisa/controls/register.json` and `.lisa/controls/verdict.json`.
   You never create, edit, correct, reformat or delete any of the three, and you never copy a
   value into one. When one of them looks wrong, the only repair is to run `lisa controls attest`
   again.
2. **A result is only what a file says after it has been checked.** Do not tell the operator
   whether Level 1 is met from a command's exit code, from a line a command printed, from memory
   of an earlier run, or from your own reading of the repository. Step 6 is the only place the
   Level 1 result is read, and it is read from the verdict file after the check in step 5 has
   passed.
3. **Ask before anything leaves the repository or reaches outside it.** Two options do that, and
   you never pass either on your own: one opens real pull requests on the hosting platform, the
   other runs a proof that says it does something outside the repository. Step 3 says how to ask.
   Silence is not a yes. If nobody is there to answer, do not pass the option, and say in your
   closing message what was left unproved because of it.
4. **Commit nothing.** This step leaves changed files in the working tree for the operator to
   review and commit. You do not run `git add`, commit, stash, switch branches or push.
5. **Write for someone who does not code.** Everything the operator reads is plain language: no
   requirement ids used as if they explained themselves, no stack traces, and no tool or
   file-format name used as if it explained itself. Say what a requirement asks, then give its id
   in brackets for those who want it.
6. **Name a secret, never show it.** What a check printed can hold a password, key or token. If
   you quote output, write the name the secret goes by and leave the value out.

## How to run the Lisa commands

Some steps run a command written here as `lisa …`. Run it from the root of the repository, using
the first of these that passes the check in step 1, and keep to that one for the whole run:

1. `lisa …` when `lisa` is on the PATH.
2. `bunx @codyswann/lisa …`
3. `npx --yes @codyswann/lisa …`
4. `bunx @codyswann/lisa@latest …`, when the copy the others found is too old.

None of them installs anything into the repository. If none of them runs at all, the machine has
neither Bun nor Node.js: stop, and tell the operator that attesting needs one of them installed and
that nothing was changed.

## Steps

Run the steps in order. Each one says what it **needs** from the steps before it and what it
**hands on**, so a step can be read, repeated or added to without rereading the others.

### Step 1: Preflight

**Needs:** nothing. **Hands on:** the repository root, a way of running Lisa that is known to
work, and what was already changed before this run.

1. Find the root of the repository. Run this inside the folder the operator named, or inside the
   folder this session is in when none was named:

   ```bash
   git rev-parse --show-toplevel
   ```

   The folder it prints is the repository root. Every later command runs from it.
2. Check that the copy of Lisa you are about to use knows the `controls` commands:

   ```bash
   lisa --help
   ```

   The list of commands it prints must include `controls`. If it does not, that copy of Lisa is
   older than this skill. **Do not run any `lisa controls …` command with it:** an older copy takes
   `controls` for the name of a folder to set Lisa up in. Move to the next way of running Lisa in
   "How to run the Lisa commands" and check that one the same way. If none passes, stop and tell
   the operator that attesting needs a newer Lisa and that nothing was changed.
3. Note what is already changed, so that step 7 can tell this run's changes from earlier ones:

   ```bash
   git status --porcelain --untracked-files=all
   ```

   Keep the list it prints. If it lists anything, tell the operator now that the proofs run
   against the last commit and not against uncommitted work.

   The files that define the checks are the exception: `.lisa.config.json`, anything under
   `.lisa/controls/proofs/`, `.lisa/controls/carriers.json` and the files it lists. The proofs do
   use those as they are on disk, committed or not. The results are tied to what those files
   hold, not to a commit, so there is no order the operator has to commit in: before the
   results, with them or after them all work. You commit nothing yourself.

For a before-enforce run, go from here to "The before-enforce run".

### Step 2: Run the proofs

**Needs:** the repository root. **Hands on:** one result for each declared check, and three
written files.

```bash
lisa controls attest --json
```

The command makes a temporary copy of the last commit, installs the commit and push hooks there,
plants each check's two test changes one at a time, makes a real commit or push with each, and
removes the copy. It changes nothing in the repository except the three files of ground rule 1,
which it writes when the proofs have run. For a check that runs before a merge it only reads the
hosting platform's settings; it creates nothing there.

On its standard output it prints one JSON document: `entries` holds one result per declared check
(`outcome`: `passed`, `failed`, `unproved` or `unknown`, with `detail` saying why in plain words).

A proof is two test changes, kept as patch files: one that breaks the check's rule and one that
does not. At commit and at push a check is only started when the change touches the check's own
folder. So each test change has to edit a file inside the check's own folder: one that edits a
file anywhere else never starts the check, and that half reads `unknown` (not started), never a
pass. When an entry is `unknown` for that reason, say so: the test change is in the wrong place,
and the configure step (`/lisa:configure`) is where it is corrected.

An entry that is `unproved` because a test change is missing (`reason` is `half-missing`) has
nothing wrong with its check: the two test changes were never written for it, or only one was. The
configure step writes them and has `lisa controls proof-check` confirm that they work. Send the
operator back to `/lisa:configure` for that entry; nothing in this step can supply it.

A test change has to break the check's rule, not rewrite the check. An entry is `unknown`, and
nothing was run for it, when one of its test changes does either of these:

- **It edits what the check is** (`reason` is `declaration-changed`): the file that declares the
  checks, a hook file, the program the check's command starts, or the script or target that
  command runs. For a check declared as `npm run lint`, `make lint` or the like, that means the
  `scripts` in `package.json`, the Makefile or the justfile.
- **It leaves a file where the repository ignores files** (`reason` is `ignored-path`), for
  example under `node_modules/`. Git leaves such a file out of a commit, so the check would see
  a file the commit does not hold.

Either way the `detail` names the file. The test change has to be written again without it, and
the configure step is where that is done.

**What the exit code means, and what it does not.**

| Exit | Meaning | What you do |
| --- | --- | --- |
| 0 | The proofs ran and every declared check passed its proof. | Go on. |
| 1 | The proofs ran and at least one check did not pass, or nothing is declared. The three files were still written. After a run with test pull requests it can also mean one of them was merged; see step 3. | Go on. This is a result, not a breakdown. |
| 2 | Nothing ran, and nothing was written. Each line on standard error is one reason. | Stop. Tell the operator the reasons in plain language, and that there is no verdict. |

Neither 0 nor 1 says whether Level 1 is met. A run can exit 0 with Level 1 far from met, because
most requirements are not checks at all. Do not report a Level 1 result from this step.

**Read standard error on every run, whatever the exit code.** With `--json` the results are on
standard output and anything the command has to tell a person is on standard error, one line each,
beginning `attest:`. A run can exit 0 and still have lines there. Keep them: step 3 says what to do
with the ones about test pull requests. Two more kinds matter later:

- **`attest: note. What defines the checks in this repository is not what the proofs ran
  against …`** names files that are not the same here as in the copy the proofs ran in. The check
  of step 5 will fail on exactly those files. The line says what puts each right: for a hook file
  or the program that runs the checks, the enforce step (`/lisa:enforce`) brings this
  repository's copy up to date; any other was changed since the last commit, and the operator
  either commits the change or undoes it. Tell the operator, then run this step again once it is
  put right. Do not go on to present a verdict while that line is there.
- **`attest: note. … earlier pull-request records were made when the checks were defined
  differently, so they were dropped …`** says an earlier run's test pull requests no longer
  count, because the checks have changed since. Nothing is wrong. Tell the operator in step 8,
  and that running the test pull requests again (step 3) produces those results anew.

### Step 3: Ask about the two things that need a yes

**Needs:** the results of step 2. **Hands on:** the results of a second run, when the operator
agreed to one; otherwise the results of step 2 unchanged.

Look in the results for two situations. Ask only when one is there, one question at a time.

**A proof that reaches outside the repository.** An entry whose `reason` is `external-effects` was
not run. Its `detail` quotes what the proof says it does. Put that to the operator, quoting it:

> One check's proof says it does this outside the repository: "posts a message to the team
> channel". Running the proof means that really happens. Shall I run it?

On a yes, run the proofs again with the option that allows it:

```bash
lisa controls attest --json --acknowledge-external-effects
```

**A check that runs before a merge and was only read, not exercised.** When the document has a
`pull_request` section whose `mode` is `observed` and one of its `points` has `rung` `observed`,
the platform's settings were read and nothing was tried. Trying it for real is possible on GitHub
only, and means this:

> To show that a bad change really is blocked before it can be merged, I can open real draft pull
> requests on GitHub, one for each test change, each from a branch whose name starts with
> `lisa-attest/`. I read whether GitHub would block each one, then close it and delete its branch.
> None is ever merged. This needs permission to push to the repository, and people who watch the
> repository may be notified. Shall I do that?

On a yes, run the proofs again with the option that does it:

```bash
lisa controls attest --json --pull-request-canaries
```

When the operator said yes to both, pass both options in one run. A second run replaces the three
files, and its exit code and results are read exactly as in step 2. On a no, or no answer, run
nothing more: the entry stays as it is, and step 8 says what was left unproved and why.

**After a run with test pull requests, relay what it left behind.** The command opens only draft
pull requests, which GitHub does not merge, and it removes each one. When it could not, it says so
on standard error, one line for each thing, naming the branch or the pull request. Pass every such
line on to the operator in plain language, in the same message as the results, even when the run
exited 0. The command prints them when it exits 2 as well, because its results could not be
written down or its temporary copy could not be removed: pass them on there too, before you stop.

| The line says | Tell the operator |
| --- | --- |
| A canary could not be removed, naming a pull request that is still open or a branch that still exists. | That pull request or branch is still in the repository and has to be closed or deleted by hand on GitHub. It must not be merged. |
| A canary an earlier run left behind needs attention, naming a branch under `lisa-attest/`. | The same: it is left over from an earlier run and has to be removed by hand. |
| A canary pull request was merged, naming its number. The run exits 1 and its last line begins `attest: FAIL.` | Stop and say this first. A test change is now in the protected branch. Name the pull request, say that the merge has to be undone, and that something on GitHub merges pull requests by itself and must be found before test pull requests are run again. Run nothing more with `--pull-request-canaries`. |
| The head of the protected branch moved while canaries were open. | What the line says: whether a test pull request was merged into it, whether that could not be ruled out (the run exits 1), or that something else moved it. |

Where GitHub does not offer draft pull requests for the repository, the command opens none: the
entry is `unknown`, its `detail` quotes GitHub's reason, and no pull request was created. A branch
was: for each test change the command pushed a branch under `lisa-attest/` to open the pull
request from, and removed it again when GitHub refused. Say that the check could not be exercised
here and why, and that a test branch was pushed to the repository and removed. If a branch could
not be removed, a line on standard error names it: pass it on as the table above says. Do not
suggest opening an ordinary pull request in its place.

### Step 4: Compare the record with what is installed

**Needs:** the written register. **Hands on:** the places where the record and this checkout
differ.

```bash
lisa controls reconcile
```

The proofs ran in a temporary copy with the hooks installed. This command answers a different
question: are those hooks really installed in **this** checkout, and does anything run here that
the record does not list? It writes nothing, runs nothing it finds, and sends nothing anywhere. It
prints one JSON document: `findings` lists each difference, with `message` and `next` in plain
words.

Reconcile checks the local edit-time hook of each agent named in the carrier record. It names
missing or changed registrations and undeclared commands in the shared shell carrier or the
agents' shell hook settings. For an older carrier record with no agents listed, report the
`not-verifiable` result and tell the operator that enforce can record the original roster.
Deployment and scheduled points stay `not-verifiable`.

| Exit | Meaning | What you do |
| --- | --- | --- |
| 0 | Everything it needed was read. `findings` may be empty or not. | Go on. A finding is something to tell the operator, not a failure of this step. |
| 2 | Something it needed could not be read. The document is complete for the rest and says which. | Go on, and tell the operator the comparison is incomplete and what could not be read. |
| 1 | There is no result. | Go on, and tell the operator the comparison could not be made. |

Keep the findings for step 8. Do not change anything to clear one: installing or repairing what is
missing is the enforce step's work.

### Step 5: Have the verdict checked

**Needs:** the three written files. **Hands on:** a verdict that is known to be what the register
and the evidence give, now; or the knowledge that there is none to present.

```bash
lisa controls attest --check
```

It runs no proof and writes nothing. It computes the verdict again from the register and the
evidence, at the current time, and compares it with the file. It also asks whether the checks
that were proved are the checks that are here: the evidence holds a fingerprint of the content of
every file that defines the checks, taken where the proofs ran, and the command takes the same
fingerprint from the repository as it is now and compares the two. Those files are the `gates`
block of `.lisa.config.json`, the test changes under `.lisa/controls/proofs/`, the hook files, the
program that runs the checks, and the repository's own hook files that call it.

It reads the files as they are and nothing from version history. So it gives the same answer in
any copy of the repository, however that copy was made, and whatever order things were committed
in. It prints the commit the proofs' copy was made from, for information; it never fails on it.

| Exit | Meaning | What you do |
| --- | --- | --- |
| 0 | The verdict file is exactly what the register and the evidence give today, and what defines the checks is what the proofs ran against. | Go on to step 6. |
| 1 | The files do not agree, the evidence has gone out of date, a file that defines the checks is not what the proofs ran against, or the evidence was written by an older Lisa that did not record that fingerprint. Each line printed is one difference, and names the file. | **Present no verdict.** Run step 2 again, once, then this step again. If it still differs, stop and tell the operator what the differences are. A file that keeps differing is one of the files a line of step 2 named: what that line says puts it right. |
| 2 | Nothing could be compared: the folder is not a repository's root, or the declaration of the checks was refused. | **Present no verdict.** Tell the operator why. |

Exit 0 means the verdict is authentic and current. It does **not** mean Level 1 is met: a verdict
that says "not met" passes this check too.

### Step 6: Read the verdict

**Needs:** the check of step 5, passed with exit 0 in this run. **Hands on:** the verdict, as the
file states it.

Read `.lisa/controls/verdict.json`. Everything you tell the operator about Level 1 comes from this
file, read now. If step 5 did not exit 0, you do not have this step's result and you present no
verdict.

| Field | What it tells you |
| --- | --- |
| `result` | `conforming` or `non-conforming`: the Level 1 result. |
| `counts` | How many requirements came out `conforming`, `not-applicable`, `non-conforming` and `unknown`. |
| `criteria` | One entry per requirement: `criterion` (its id), `verdict`, `reason`, `detail` (the reason as a sentence), `kind`, `rung`, and `entries` (the declared checks that serve it). |
| `prevented_by` | The ids of the requirements that prevent a conforming result. |
| `evidence_as_of` | When the newest evidence was gathered. |
| `current_until` | The moment the evidence first goes out of date. After it, this verdict no longer stands and the proofs have to be run again. |

**On what basis a requirement is met.** For each requirement whose `verdict` is `conforming`,
`rung` says what the verdict rests on:

| `rung` | Say it as |
| --- | --- |
| `exercised` | Proved: a bad change was really tried, and the check stopped it. |
| `observed` | Observed: a document was found where it should be, or a platform setting was read. Nothing was tried. |
| `asserted` | A person's answer: someone answered the audit's question. Nothing was checked by code. |

**What prevents a pass, and who can do something about it.** For each id in `prevented_by`, find
its entry in `criteria` and read `reason`:

| `reason` | What the operator can do |
| --- | --- |
| `nothing-found` | Nothing in the repository does this. Add a check or a record for it: the enforce step (`/lisa:enforce`) files a ticket for each such requirement. |
| `no-evidence` with an empty `entries` | No check is declared for it. Declare one with the configure step (`/lisa:configure`), or run the audit (`/lisa:audit`) if it was never audited. |
| `no-evidence` with `entries` | A check is declared and has no proof on record, most often because it has no test changes yet. The configure step (`/lisa:configure`) writes the two test changes a proof needs and confirms they work; then run this step again. |
| `control-failed` | The declared check let a bad change through, or stopped a good one. Fix the check or how it is wired, with the enforce step, then run this step again. The entry's `detail` in step 2 says which. |
| `proof-incomplete` | The proof ran and gave no answer to rely on. Step 2's `detail` for the entry says why: a missing test change, a test change that edits a file outside the check's own folder (so the check never started), no failure text declared, or a hook that is not wired. The test changes and the failure text are corrected in the configure step (`/lisa:configure`), where `lisa controls proof-check` says what to change; a hook that is not wired is the enforce step's to repair. |
| `rung-too-low` | It was observed and needs to be tried for real. For a check before a merge that means the real pull requests of step 3, which need the operator's yes and permission to push. |
| `audit-unknown` | The audit could not find out, usually for lack of access. The finding's next step in `.lisa/audit/report.md` names the access to get; then run the audit again. |
| `artifact-not-found` | The record is not where the audit pointed. Run the audit again. |
| `no-attestation` | Only a person can vouch for this. Answer the question on its answer line in `.lisa/audit/report.md`, then run the audit again. |
| `stale-evidence` | The evidence is older than it may be. Run this step again. |
| `evidence-dated-later` | A record is dated after the current time, so a clock is wrong somewhere. Correct the clock and run this step again. |

### Step 7: Confirm what changed

**Needs:** the list from step 1. **Hands on:** the files this run changed.

```bash
git status --porcelain --untracked-files=all
```

Apart from what step 1 already listed, the only paths that may appear are the three files of
ground rule 1. They are meant to be committed: they are the record someone else can check with
`lisa controls attest --check`. Leave committing them to the operator. If anything else appears,
this run changed something it must not: remove only what you yourself created, and run this step
again. Never delete, restore or reset anything you did not create.

### Step 8: Tell the operator

**Needs:** the verdict read in step 6, the findings of step 4, the answers of step 3 and the
result of step 7. **Hands on:** the closing message.

If step 5 did not pass, say so first, say there is no verdict to present, and give the reasons.
Otherwise, in plain language, for someone who does not code:

1. **The Level 1 result**, from `result`: met or not met.
2. **How many requirements are met and on what basis**, from `counts` and each `rung`: how many
   are proved by a check that was really tried, how many rest on a document or a platform setting
   that was observed, how many rest on a person's answer, and how many do not apply.
3. **What prevents a pass**, grouped by what the operator can do about it, using the table in step
   6: declare a check (the configure step); install or repair what makes a check run (the enforce
   step, and each finding of step 4); answer a question (the audit report); get access, naming the
   access. For each requirement say what it asks, in a sentence, before its id.
4. **What this checkout really has**, from step 4: each place the record says a check runs and
   nothing runs it here, and each command a hook runs that the record does not list.
5. **When the evidence goes out of date**, from `current_until`, and that the proofs have to be run
   again before then for the verdict to keep standing.
6. **What was left unproved because a yes was needed**, from step 3.
7. **The limits that apply**, said plainly, each only when it is true of this run:
   - A check that runs before a merge on a platform other than GitHub stays unproved in this
     release: nothing can try it there yet, so its mark does not clear.
   - The proofs ran against the last commit, not against uncommitted work.
   - The check in step 5 covers the files that define the checks and not the settings of the
     tools those checks run. A rule switched off in a linter's own settings after the proofs ran
     is not noticed by that check. It is noticed when the proofs are run again.
   - Earlier test pull requests no longer count, when step 2 said their results were dropped.
   - The check in step 5 shows that the three files agree with each other today. It is local and
     unsigned, so it cannot show they were not rewritten together by someone who changed all
     three consistently. Version history, or running the proofs again, can.
8. **The three files** of ground rule 1 were changed and are meant to be committed, and you have
   not committed them.

## The before-enforce run

Use this when the operator asks what is unenforced **before** the enforce step has installed
anything. Do step 1 first. This run presents no verdict, and it never reads or changes the three
files of ground rule 1.

A before-enforce result means something different from a proof's, and the two must not be mixed
up. Here a bad change that **goes through** is the finding: the tool exists and nothing makes it
run. Nothing here says a check passed or failed a proof, and nothing here counts toward Level 1.

### Before-enforce step 1: Try each check's bad change with nothing installed

**Needs:** the repository root and a working way of running Lisa, from step 1. **Hands on:** one
result for each declared check, and the findings offered to the audit report.

```bash
lisa controls attest --before-enforce --json
```

The command makes a fresh clone of the last commit and installs nothing in it. For each declared
check that has both of its test changes and runs when code is committed or pushed, it really
commits or pushes the bad change there, then runs the check's own command on the same change. It
writes nothing in the repository and sends nothing anywhere.

A fresh clone has no hooks: git copies commits into a clone, never the hook settings of the
checkout it came from. So a bad change going through there is not a quirk of the test. It is what
happens in every new checkout until someone sets hooks up in it, and the operator should hear it
that way. The document's `copy` section says what the clone really had.

It prints one JSON document. Read `outcome`, `reason`, and for each of `entries`:

| `result` | Meaning |
| --- | --- |
| `not-enforced` | The bad change went through, and the check's own command ran on it. The tool exists and is not enforced. `canary` is the record of the change that went through: the git command, its exit status and what it printed. `tool` is what the check's own command said. |
| `enforced` | Something in the fresh clone refused the bad change. Something already enforces this check. |
| `not-exercised` | Nothing was tried. `detail` says why: most often the check has no test changes yet, which the configure step (`/lisa:configure`) writes. |
| `unknown` | It was tried and gave no answer to rely on. `detail` says why. |

| `outcome` | Meaning |
| --- | --- |
| `findings` | At least one check exists and is not enforced. |
| `nothing-found` | Something was tried and nothing went through. |
| `nothing-exercised` | Checks are declared and none could be tried yet. |
| `nothing-declared` | No check is declared. The configure step comes first. |
| `incomplete` | At least one check gave no answer. |

| Exit | Meaning | What you do |
| --- | --- | --- |
| 0 | There is a result and every check was answered. A finding is not a failure. | Go on. |
| 1 | There is a result, and at least one check gave no answer. | Go on, and tell the operator which and why. |
| 2 | Nothing was tried. Each line on standard error is one reason. | Stop and tell the operator the reasons. |

The same rule about test changes holds here as in step 2: a test change has to edit a file inside
the check's own folder. One that edits a file anywhere else is not seen by the check, here or once
the hooks are installed, so when `tool` shows the check's own command passing the bad change, look
at where the test change is before concluding anything about the tool.

An entry whose `reason` is `external-effects` was not tried because its proof says it does
something outside the repository. Ask as in step 3, and only on a yes run this step's command
again with `--acknowledge-external-effects` added.

### Before-enforce step 2: Put the findings into the audit report

**Needs:** the document of the step before. **Hands on:** an audit report that says, for each such
check, that it exists and is not enforced; checked by code.

Skip this step when `audit_findings` is empty, or when there is no `.lisa/audit/report.json`: say
in your closing message that the audit (`/lisa:audit`) has to be run before findings can be
recorded.

Each entry of `audit_findings` is a finding already in the report's shape, in the state
`exists-not-enforced`. For each one:

1. Find the finding in `.lisa/audit/report.json` with the same `criterion` and the same `scope`.
   If there is none, leave the report alone for this one and tell the operator.
2. Replace that finding with the offered one, exactly as offered. If the finding you are replacing
   listed entries under `mechanisms` that the offered one does not, add them after the offered
   ones, unchanged, so nothing the audit found is lost.

Change nothing else in the report. Then have it checked:

```bash
lisa controls report-check
```

- **Exit 0.** The report is acceptable and `.lisa/audit/report.md` was written again from it.
- **Any other exit.** Each line printed is one problem. Put back, exactly as it was, each finding
  a problem names, run the check again, and tell the operator which finding could not be recorded
  and why. Never clear a problem by changing a finding's words, state or pointers yourself.

### Before-enforce step 3: Confirm what changed

**Needs:** the list from step 1. **Hands on:** the files this run changed.

```bash
git status --porcelain --untracked-files=all
```

Apart from what step 1 already listed, the only paths that may appear are
`.lisa/audit/report.json` and `.lisa/audit/report.md`, and `wiki/gaps.md` in a repository that
already keeps a wiki. If anything else appears, remove only what you yourself created. Never
delete, restore or reset anything you did not create.

### Before-enforce step 4: Tell the operator

**Needs:** the document of before-enforce step 1 and the results of the two steps after it.
**Hands on:** the closing message.

In plain language, for someone who does not code:

1. That this was a look before anything is installed, that it is not a Level 1 result, and that
   nothing was proved to work.
2. Each check that exists and is not enforced: what it checks, the part of the repository it
   covers, that a change breaking its rule was really committed or pushed in a fresh clone and
   went through, and what the tool itself said about that change.
3. That a fresh clone runs no hook at all, so this is true of every new checkout today.
4. Each check that could not be tried yet, and why; each that gave no answer, and why.
5. Where the record is: the findings are in `.lisa/audit/report.md`, and the full record of each
   change that went through is the `canary` of its entry in what the command printed.
6. That the audit report was changed and nothing was committed.
7. The next step: `/lisa:enforce` installs what makes these checks run, and `/lisa:attest` then
   proves they stop the same changes.
