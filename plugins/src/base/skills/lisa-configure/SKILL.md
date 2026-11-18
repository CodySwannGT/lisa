---
name: lisa-configure
description: "Turn the audit's findings and the operator's answers into the record of which checks govern a repository: declare each supported check in .lisa.config.json, write its two test changes, and generate the control register. Declares nothing unsupported, and never imposes Lisa's own thresholds."
allowed-tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"]
---

# Configure: $ARGUMENTS

Write down which checks govern this repository, where each one applies and when it runs, and
produce the one record of that: the control register. Configure is the second of four steps (audit,
configure, enforce, attest). It acts on what the audit found and on what the operator decides, and
on nothing else.

Configure **declares, and writes the two small test changes each check will be proved with. It
wires nothing in and it proves no check.** The enforce step installs what makes the declared checks
run and files tickets for what is missing. The attest step proves, by code, whether each one really
stops a bad change, and it does that with the test changes written here.

The operator may name the folder of the repository to configure (`$ARGUMENTS`). With nothing named,
configure the repository this session is in.

**Running it.** Claude Code, Cursor, OpenCode, Antigravity and Copilot: `/lisa:configure`. Codex
has no slash commands: `$lisa-configure`. Devin has no plugin command surface:
`/lisa:lisa-configure`. The skill comes with the Lisa plugin for the agent in use.

**Where coding agents differ.** What an agent cannot do the way this skill describes it:

- **Codex, Devin:** the skill is started directly there, with no command file in front of it to
  pass on what the operator named. Wherever this skill says `$ARGUMENTS`, read what the operator
  wrote when they started it.

## Ground rules

These hold in every step.

1. **Change the declaration, the test changes and the register, and nothing else.** The only
   paths this skill may create or change are `.lisa.config.json`, where the checks are declared;
   the patch files under `.lisa/controls/proofs/`, which step 8 writes; and
   `.lisa/controls/register.json`, which the command in step 9 writes. In `.lisa.config.json`,
   change only the `gates` block, and in it only the checks decided in this run: keep every other
   key and every check somebody else declared exactly as it is. No hook, pipeline, script, tool
   setting or platform setting is installed or edited here, and nothing is committed, pushed or
   staged. Anything you need to set aside while you work goes in the system's temporary folder,
   outside the repository.
2. **Declare only what is supported.** A check is declared only where the audit report shows it
   exists there, or where a person has answered the question the audit asked about it. Every
   declared part names what supports it. A check you believe a repository should have, and that
   nothing shows it has, is not declared: the enforce step turns a missing check into a ticket.
3. **An open question declares nothing.** While the audit still asks a question about a
   requirement in a part of the repository, nothing is declared for that requirement there. Do not
   answer it yourself and do not declare around it.
4. **The operator decides, one decision at a time.** You propose and the operator chooses. Put one
   decision in front of them at a time, in plain language: what was found, what you propose, and
   what saying yes means. Never bundle several decisions into one question, and never treat
   silence as a yes. If nobody is there to answer, declare nothing for that decision and list it
   in your closing message as waiting.
5. **A threshold is the repository's own.** On a stack Lisa ships no checks for, a number such as
   a minimum share of code covered by tests is whatever the operator confirms. You propose the
   value the repository measures today. You never write a number Lisa uses elsewhere, a number
   from memory, a rounder number, or a number the operator did not confirm.
6. **Write for someone who does not code.** Everything the operator reads is plain language: no
   requirement ids, no stack traces, and no tool or file-format name used as if it explained
   itself. A tool's name may appear, but the sentence must still make sense to someone who has
   never heard of it.
7. **Name a secret, never show it.** If a command you declare needs a password, key or token,
   write the name it goes by and leave the value out.
8. **Code decides whether the declaration is acceptable.** You do not judge your own declaration
   or your own test changes. Steps 7, 8 and 9 do, and a declaration that has not passed all three
   is not a result.
9. **A check is never changed to make its test changes work.** If a check does not catch the
   change you wrote for it, the change is wrong, or the check does not do what was assumed. Fix
   the test change, or say what you found. Never edit the tool's settings, loosen or tighten the
   command, or declare failure text the tool does not print, to get a pass. A check that cannot be
   given a working pair is left without one, and your closing message says so.

## How to run the Lisa commands

Some steps run a command written here as `lisa …`. Run it from the root of the repository being
configured, using the first of these that passes the check in step 1, and keep to that one for the
whole run:

1. `lisa …` when `lisa` is on the PATH.
2. `bunx @codyswann/lisa …`
3. `npx --yes @codyswann/lisa …`
4. `bunx @codyswann/lisa@latest …`, when the copy the others found is too old.

None of them installs anything into the repository. If none of them runs at all, the machine has
neither Bun nor Node.js: stop, and tell the operator that configuring needs one of them installed
and that nothing was changed.

## Steps

Run the steps in order. Each one says what it **needs** from the steps before it and what it
**hands on**, so a step can be read, repeated or added to without rereading the others.

### Step 1: Preflight

**Needs:** nothing. **Hands on:** the repository root, and a way of running Lisa that is known to
work.

1. Find the root of the repository being configured. Run this inside the folder the operator
   named, or inside the folder this session is in when none was named:

   ```bash
   git rev-parse --show-toplevel
   ```

   The folder it prints is the repository root. Every later command runs from it, and every path
   in the declaration is written from it.
2. Check that the copy of Lisa you are about to use knows the `controls` commands:

   ```bash
   lisa --help
   ```

   The list of commands it prints must include `controls`. If it does not, that copy of Lisa is
   older than this skill. **Do not run any `lisa controls …` command with it:** an older copy takes
   `controls` for the name of a folder to set Lisa up in. Move to the next way of running Lisa in
   "How to run the Lisa commands" and check that one the same way. If none passes, stop and tell
   the operator that configuring needs a newer Lisa and that nothing was changed.

### Step 2: Find out which road this repository takes

**Needs:** the repository root. **Hands on:** the road, and on the paved road the declaration
itself.

```bash
lisa controls seed
```

It prints one JSON document. Read these fields:

| Field | What it tells you |
| --- | --- |
| `road` | `paved` or `discovery`. Code decides this, never you. |
| `reason` | Why, in words you can pass on to the operator. |
| `audit_report` | `found` or `missing`: whether the audit has been run here. |
| `parts` | The parts of the repository the audit named, when there is a report. |
| `wrote` | Whether this command changed `.lisa.config.json` just now. |
| `seeded` | The checks it declared just now, each with the moment it runs at. |
| `declared_gates` | How many checks the declaration holds now. |

- **`paved`.** The whole repository is one piece of software on a project type Lisa ships checks
  for. The command has already declared every one of those checks that the repository has a task
  for, and it never changes a check that was already declared, so running it again changes
  nothing. Nothing is discovered and nothing is asked on this road. **Go straight to step 7, and
  skip step 8.** If
  `declared_gates` is `0`, nothing could be declared because the repository does not yet have the
  tasks those checks run: say so in your closing message, and that setting Lisa up for this
  project type (`lisa apply`) is what supplies them.
- **`discovery` with `audit_report` `found`.** The command wrote nothing. Go on to step 3.
- **`discovery` with `audit_report` `missing`.** Stop. Tell the operator that this repository's
  checks are declared from what the audit finds, that the audit has not been run yet, and that the
  next step is `/lisa:audit`. Nothing was changed.

If the command exits with an error, each line it prints is one problem in plain words. An audit
report it cannot rely on means the audit has to be run again first. A `package.json` it cannot
read means that file has to be put right first: tell the operator which problem was printed, and
do not edit the file yourself.

### Step 3: Read what the audit found

**Needs:** the discovery road and an audit report. **Hands on:** the list of checks that may be
declared, and the list of things that may not.

Read `.lisa/audit/report.json`. Each entry of `findings` says where one requirement stands in one
part of the repository (`scope`; `.` is the whole repository). Then get the requirements
themselves, for the plain question each one asks and the names Lisa gives its checks:

```bash
lisa controls catalogue
```

Sort the findings:

| A finding whose `state` is | Means for this step |
| --- | --- |
| `exists-not-enforced` or `proved`, with at least one entry in `mechanisms`, for a requirement whose `kind` is `gate` | **A check that may be declared.** One for each requirement in each part. |
| `question` | **Still open.** Declare nothing for that requirement in that part. List it for the closing message. |
| `missing` | Nothing to declare. The enforce step files a ticket for it. |
| `unknown` or `not-applicable` | Nothing to declare. |
| any state, for a requirement whose `kind` is `artifact` or `human-attested` | Nothing to declare here: it is a record or a person's word, not a check that can refuse a change. |

**What a person answered.** The report's `answers` list holds what people have answered. Each
entry has the `id` of the question, the `question` as it was asked, and the `answer`. A question
about a requirement has the id `<requirement id>@<scope>`, so the id says which requirement and
which part of the repository the answer is about. When such an answer names a check for that
requirement there (the tool, and how it is run), that check may be declared too, whatever the
finding's state, and it names the answer's `id` as what supports it. An answer that names no check
declares nothing.

The `questions` list holds the questions still waiting for a person: an id on it supports nothing
yet. The answers about how the repository is set up (`tracker`, `hosting-platform`,
`repository-administrator`) are about no requirement and support no check.

### Step 4: Decide each check with the operator

**Needs:** the checks that may be declared. **Hands on:** for each one the operator agreed to, the
facts the declaration needs.

Take the checks one at a time. For each, work out what you will propose, then ask the operator one
question.

| Fact | Where it comes from |
| --- | --- |
| The gate it belongs to | The first name in the requirement's `gates` list. When that list is empty, a short name of your own that starts with `x-`, such as `x-design-tokens`. Requirements that share a gate name share one gate. |
| The requirement it serves | The requirement's `id`, in the gate's `criteria`. List only requirements a finding supports. |
| The part it covers | The finding's `scope`. A requirement that has one answer for the whole repository has its one finding under `.`, even when a check it lists covers a single folder: the part is then the folder that check covers. |
| The command | The mechanism's `command`, split into a list with one item per argument and the program first. The command is started in the part's folder and never through a shell. If the line as written chains or pipes commands, declare the script or task that wraps it. If `command` is `null`, nothing runs the tool today: propose the tool's own usual way of running a check, and say to the operator that this is a proposal, not something found. |
| What supports it | The `path` and `line` of the mechanism's `locators`, copied exactly. |
| When it runs | The operator's choice. For most checks: when code is committed (`commit`), before it is pushed (`push`), or before it is merged (`pull-request`). For a check tied to a release: before or after a deployment to a named environment (`pre-deploy:production`, `post-deploy:production`). And whether a failure stops the change (`required`) or is only reported (`optional`). Not every check can run at every moment: when step 9 refuses a moment, its message lists the ones that check accepts, and you go back to the operator with those. |

Ask in this shape, one check per question:

> In the folder `api`, a style checker (ruff) is set up, but nothing runs it today. I propose it
> runs before a change is merged and must pass. Saying yes means a change that breaks the house
> style can no longer be merged into the main branch. Shall I record that?

Record the check only on a yes. A no, or no answer, records nothing for it. Ask once, separately,
who answers for these checks (a person or a team), and record that name as the gate's `owner`; if
the operator does not know, leave `owner` off.

### Step 5: Set each threshold from what the repository measures today

**Needs:** the checks the operator agreed to. **Hands on:** each threshold the operator confirmed.

Only for a check that holds a number, such as the lowest share of code that tests must cover. A
check with no number skips this step.

1. **Measure.** Run the repository's own tool, in the part's folder, the way the check runs it,
   and read the number it reports today. Run it so that it leaves nothing behind: note what
   `git status --porcelain --ignored` shows before, and afterwards remove only what the
   measurement created. If the tool cannot be run here, do not estimate: tell the operator it
   could not be measured, and ask them for the number they hold the repository to today.
2. **Turn the measurement into a proposal.** Code does this, not you:

   ```bash
   lisa controls propose-threshold --name "<name>" --measured "<measured value>" --direction "<direction>"
   ```

   `<name>` is what the number is called on the check, such as `minimum-coverage`.
   `<measured value>` is the number exactly as the tool reported it. `<direction>` is `floor` for
   a lowest allowed value and `ceiling` for a highest. It prints one JSON document: `question` is
   the decision to put to the operator, `yes_means` is what agreeing means, and `parameters` is
   what the declaration will carry. The proposed value is the measured value, unchanged.
3. **Ask the operator.** Say in plain words what is being measured, then give them `question` and
   `yes_means`.
4. **Record what they confirm.** On a yes, the check's `parameters` is the `parameters` the
   command printed. If they name a different number, that number replaces `value`. If they
   decline, the check has no threshold: leave `parameters` off and say so in your closing message.

The parameter records the number; it does not apply it. When the tool takes the number as an
argument, put the same number in the command too.

### Step 6: Write the declaration

**Needs:** every check the operator agreed to, and every threshold they confirmed. **Hands on:**
the `gates` block of `.lisa.config.json`.

Add each check to the `gates` block of `.lisa.config.json`, creating the file when it does not
exist. Keep everything else in the file as it is.

```json
{
  "gates": {
    "code-style": {
      "pull-request": "required",
      "criteria": ["SI7"],
      "owner": "Platform team",
      "parts": [
        {
          "scope": "api",
          "command": ["ruff", "check", "."],
          "evidence": { "locators": [{ "path": "api/ruff.toml", "line": 1 }] }
        }
      ]
    },
    "coverage-adequacy": {
      "pull-request": "required",
      "criteria": ["SI2"],
      "owner": "Platform team",
      "parts": [
        {
          "scope": "api",
          "command": ["python", "-m", "pytest", "--cov", "--cov-fail-under=41"],
          "parameters": {
            "minimum-coverage": { "value": 41, "direction": "floor" }
          },
          "evidence": { "locators": [{ "path": "api/pyproject.toml", "line": 7 }] }
        }
      ]
    }
  }
}
```

- A gate holds the moments it runs at (`"pull-request": "required"`), the requirements it serves
  (`criteria`), who answers for it (`owner`) and one entry of `parts` for each part of the
  repository it covers.
- A part holds `scope`, `command`, `evidence`, and `parameters` when it has a threshold. Those are
  the only keys this step writes on a part.
- `evidence` is what supports the part, and every part has it. It holds `locators`, the places the
  audit found the check, each copied from the finding as `{ "path", "line" }`; or `questions`, the
  ids of the answers it rests on, each copied from the report's `answers`, such as `"SI2@api"`; or
  both.
- A check that covers two parts is one gate with two entries in `parts`, each with its own
  command and its own evidence.

### Step 7: Have the declaration checked against the audit

**Needs:** the declaration. **Hands on:** a declaration every part of which the audit supports.

```bash
lisa controls declaration-check
```

- **Exit 0.** Every declared part is supported. On the paved road it passes at once, because
  nothing was declared from a finding.
- **Any other exit.** Each line printed is one problem, naming the gate and the part. A part that
  names a place the audit did not report, rests on a question nobody answered or on an answer
  about something else, or serves a requirement the audit still asks about is refused. Correct the
  declaration so that it says truthfully what supports each part, and run this step again. Never
  clear a problem by pointing at a place that does not show the check, by naming an answer about
  another requirement, or by writing an answer yourself: only a person answers, on the answer
  line of `.lisa/audit/report.md`. A part that cannot be supported honestly is removed.

### Step 8: Give each check the two test changes that will prove it

**Needs:** a checked declaration. **Hands on:** for each part declared in this run, two patch files
under `.lisa/controls/proofs/`, their names and the failure text in the part's `proof`, and code's
word that the pair works.

The attest step proves a check by trying two small changes against it: one that breaks the rule the
check enforces, which the check must refuse, and one that is harmless, which it must let through.
The two changes are kept as patch files beside the declaration. Nothing else writes them, and a
part left without them stays unproved however well everything else is set up. Writing them takes
knowing the tool, which is why you write them. Code then tries them and tells you whether they
work.

**On the paved road, skip this step.** This release writes no test changes for the checks Lisa
ships for a supported project type. Those checks read unproved until a proof is declared for them,
and your closing message says so plainly.

Take the parts you declared in this run one at a time.

**1. Decide the two changes.**

| | The violating change | The clean change |
| --- | --- | --- |
| What it is | The smallest change that breaks exactly the rule this check enforces, and nothing else. For a style checker: one line the style forbids. For a test runner: one assertion made false. For a type checker: one value of the wrong type. | A harmless change the check accepts: a comment added to a source file, or a new trivial file the check reads and passes. |
| Where | A file inside the part's own folder. At commit and at push a check only starts when the change touches its folder, so a change anywhere else never starts it. A part that covers the whole repository (`.`) takes a file anywhere. | The same folder. |

Both changes are made to the last commit and to nothing else, so both apply to it cleanly. Keep
each to a few lines. Neither may touch the check's own settings: not the tool's settings file, not
a list of files it skips, and never `.lisa.config.json`.

**2. Write each change as a patch file, without touching the working copy.** Make the change in a
scratch copy of the last commit and let git write it down, so the edit is never in the operator's
files and uncommitted work is never mixed into the patch.

Make a new, empty scratch folder in the system's temporary folder (`mktemp -d` prints one). It is
written `<scratch folder>` below. Put a copy of the last commit in it:

```bash
git clone --quiet . "<scratch folder>"
```

Make the violating change in the copy: edit the file under `<scratch folder>`, at the same path it
has in the repository. Then stage everything the copy holds, and have git write the change down:

```bash
git -C "<scratch folder>" add --all
```

```bash
git -C "<scratch folder>" diff --cached --binary --no-color --no-ext-diff --output="<patch file>"
```

`<patch file>` is the full path of the patch file: the repository root from step 1, then
`.lisa/controls/proofs/`, then the file's name. Create the folder `.lisa/controls/proofs` in the
repository first when it is not there. The two files of one check are named after it:

- `<check>.violation.patch` for the violating change and `<check>.clean.patch` for the clean one.
- `<check>` is the gate's name, then `@`, then the part's folder with every `/` written as `-`:
  `code-style@api.violation.patch`, `code-style@services-api.clean.patch`.
- For a part that covers the whole repository, `<check>` is the gate's name alone:
  `code-style.violation.patch`.

Put the copy back to the last commit before the next change:

```bash
git -C "<scratch folder>" reset --quiet --hard
```

Do the same for the clean change, into the other patch file. When the last patch of the last part
is written, remove the scratch folder. Nothing of it is left in the repository.

**3. Declare the pair and the failure text.** Add `proof` to the part in `.lisa.config.json`:

```json
{
  "scope": "api",
  "command": ["ruff", "check", "."],
  "evidence": { "locators": [{ "path": "api/ruff.toml", "line": 1 }] },
  "proof": {
    "violation": ".lisa/controls/proofs/code-style@api.violation.patch",
    "clean": ".lisa/controls/proofs/code-style@api.clean.patch",
    "failure_shape": ["Found 1 error"]
  }
}
```

- `violation` and `clean` are the two patch files, written from the repository root.
- `failure_shape` is a short piece of text the tool prints when it finds this rule broken, and
  does not print when it passes: the name or code of the rule, or its summary line. It is how a
  real refusal is told from a tool that is broken or not installed. Leave out anything that
  differs from run to run or from machine to machine: a time, a folder outside the repository, a
  count that other changes would move. If you are not sure what the tool prints, declare your best
  guess: the next command shows you what it really printed.
- When the tool needs a long time, `timeout_seconds` is how long one run of it may take.

**4. Have the pairs tried.**

```bash
lisa controls proof-check
```

It puts each change on the last commit in a temporary copy, runs the check's own command on it
there, and removes the copy. It changes nothing in the repository, it installs nothing, and it
works with uncommitted work in place. It prints one JSON document; read `parts`, one entry per
declared part:

| `result` | Meaning | What you do |
| --- | --- | --- |
| `ready` | The check failed on the violating change, printing the declared failure text, and passed on the clean change. | Nothing more for this part. |
| `not-ready` | `detail` says in one sentence what is wrong and what to change. `halves` shows, for each change, the files it touches (`changed_paths`) and, once the check was run on it, how the tool ended and what it printed (`run.exit_status`, `run.output_excerpt`). | Change the patch or the failure text as `detail` says, and run the command again. |
| `no-proof` | The part names no patch file. | Write its pair, or leave it and say so in your closing message. |

| Exit code | Meaning |
| --- | --- |
| 0 | Every part that declares a pair reads `ready`. Go on. |
| 1 | At least one pair is `not-ready`. Fix it and run the command again. Do not go on to step 9 with a pair that is not ready. |
| 2 | Nothing could be checked. Each line printed is one problem in plain words; most often the declaration itself is refused. Fix it and run the command again. |

Repeat until every part that declares a pair reads `ready`. Ground rule 9 holds throughout: you
change the test changes, never the check.

The temporary copy holds the last commit and nothing git ignores. A tool that only runs with files
the working copy has and the commit does not (installed dependencies, built output) cannot run
there, and reads as not started, or as failing on the clean change without its failure text. Do not
install anything and do not commit anything to get around that.

When a pair cannot be made ready honestly (the tool is not installed on this machine, it cannot run
in a copy of the last commit, or the check does not catch what it was assumed to catch), delete its
two patch files and take `proof` off the part. The part then reads `no-proof`, it stays unproved,
and your closing message names the check and says why.

A `note` on a part that is `ready` says why the attest step will still not prove it at commit or
push, for example because it only runs before a merge. Pass it on in your closing message.

**5. Tell the operator, one sentence for each check.** They are never asked to read a patch. For
example:

> I tried the style check for the folder `api` on a small test change that breaks the house style
> and on a harmless one. It caught the first and let the second through.

### Step 9: Write the control register

**Needs:** a checked declaration, and test changes that read `ready`. **Hands on:**
`.lisa/controls/register.json`.

```bash
lisa controls register
```

The command generates the register from the declaration and writes it. Never write or edit that
file yourself. If it refuses the declaration, each line printed is one problem: fix the
declaration and run steps 7 and 8 and this step again. When it refuses a gate name or a moment,
the line says which names or moments it accepts.

Then confirm the file on disk is exactly what the declaration produces:

```bash
lisa controls register --check
```

It must exit 0. The same declaration always produces the same register, byte for byte.

### Step 10: Confirm what changed

**Needs:** the written register. **Hands on:** proof that only the declaration, the test changes
and the register changed.

```bash
git status --porcelain --untracked-files=all
```

Apart from anything that was already there before this run (the audit's own report under
`.lisa/audit/`, for one), the only paths listed may be `.lisa.config.json`, the patch files under
`.lisa/controls/proofs/` and `.lisa/controls/register.json`. If anything else appears, this run
changed something it must not: a test change left in a source file is the one to look for first.
Remove only what you yourself created, and run this step again. Never delete, restore or reset
anything you did not create.

### Step 11: Tell the operator

**Needs:** the register and the result of step 10. **Hands on:** the closing message.

In plain language, for someone who does not code:

1. Which road was taken and why, in one sentence.
2. What is now declared: each check, the part of the repository it covers, when it runs, and
   whether a failure stops the change. On the paved road, the checks that were declared in this
   run and the ones that were already there.
3. Each threshold: what is measured, the value measured today, and the value the operator
   confirmed.
4. For each check, in one sentence, that a test change showed it catches a problem: it refused a
   small change that breaks its rule and let a harmless one through. Name each check that has no
   test changes and say why: on the paved road, because this release does not write them for the
   checks that come with the project type; otherwise, what stood in the way. A check without them
   stays unproved.
5. What was **not** declared and why: each open question, with who is likely to know the answer,
   and that it is answered by typing on its answer line in `.lisa/audit/report.md` and running
   `/lisa:audit` again; each proposal the operator declined; each decision still waiting because
   nobody was there to make it.
6. Where the record is: `.lisa.config.json` holds what was decided, the test changes are the
   patch files under `.lisa/controls/proofs/`, and `.lisa/controls/register.json` is the record
   generated from the declaration.
7. That nothing was committed and nothing was wired in. The test changes show each check can tell
   a bad change from a good one; whether anything actually stops a bad change is what the attest
   step proves, once the enforce step has made the checks run.
8. The next step: `/lisa:enforce` makes the declared checks actually run and files a ticket for
   each requirement that has nothing behind it.
