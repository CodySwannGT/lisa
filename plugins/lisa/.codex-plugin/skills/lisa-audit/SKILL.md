---
name: lisa-audit
description: "Audit any repository, on any…"
allowed-tools: ["Bash", "Read", "Write", "Glob", "Grep"]
---
Audit any repository, on any stack, against the Level 1 requirements: read what already checks each one in each part of the repository and write a plain-language report to .lisa/audit. Read-only. Works where Lisa was never applied.


# Audit: $ARGUMENTS

Find out, for every Level 1 requirement, what this repository already has in place, what it lacks,
and what could not be answered, and write that down as one report. Audit is the first of four steps
(audit, configure, enforce, attest) and the one an operator runs on a repository Lisa has never
touched. It needs no `.lisa.config.json`, no `lisa apply`, and no supported project type.

The audit **reads and proposes. It never issues a pass.** The later steps act on what it finds:
configure turns the findings and the operator's answers into a written record of which checks
govern the repository and when each one runs, enforce wires those checks in, and attest proves, by
code, whether each one really stops a bad change.

The operator may name the folder of the repository to audit (`$ARGUMENTS`). With nothing named,
audit the repository this session is in.

**Running it.** Claude Code, Cursor, OpenCode, Antigravity and Copilot: `/lisa:audit`. Codex has no
slash commands: `$lisa-audit`. Devin has no plugin command surface: `/lisa:lisa-audit`. The skill
comes with the Lisa plugin for the agent in use. The repository being audited needs nothing from
Lisa.

## Ground rules

These hold in every step.

1. **Change nothing but the report.** The only paths this skill may create or change are
   `.lisa/audit/report.json`, which you write, and `.lisa/audit/report.md`, which the check in
   step 6 writes. Nothing else: no notes or scratch files inside the repository, no installed
   packages, no edit to `.gitignore` or any configuration, no `git add`, commit, stash, branch
   switch or push. Do not create `.lisa.config.json` and do not run `lisa apply`. Anything you
   need to set aside while you work (the printed requirements, drafts of the report) goes in the
   system's temporary folder, outside the repository.
2. **Read, never run.** Discover by reading files and by asking git what it already knows
   (`git remote -v`, `git log`, `git config --get …`). Do not run the repository's own tests,
   linters, builds, hooks or scripts: they leave caches and output behind, and running a check
   proves nothing the audit is allowed to claim. This audit reads the repository only. It does not
   ask the hosting platform, the tracker or any other outside system.
3. **You never decide `proved`.** A tool, a configuration file, a hook or a green pipeline shows
   that a control exists, not that it works. See "The one way a finding may say proved" in step 4.
4. **Write for someone who does not code.** Everything the operator reads (the three plain-language
   fields of every finding, and your closing message) is plain language: no requirement ids, no
   stack traces, and no tool or file-format name used as if it explained itself. A tool's name may
   appear, but the sentence must still make sense to someone who has never heard of it. Ids and
   file paths have their own fields and stay there.
5. **Name a secret, never show it.** If a command or file you quote contains a password, key or
   token, write the name it goes by and leave the value out.
6. **Code decides whether the report is acceptable.** You do not judge your own report. Step 6
   does, and an unchecked report is not an audit result.

## How to run the Lisa commands

Some steps run a command written here as `lisa …`. Run it from the root of the repository being
audited, using the first of these that passes the check in step 1, and keep to that one for the
whole run:

1. `lisa …` when `lisa` is on the PATH.
2. `bunx @codyswann/lisa …`
3. `npx --yes @codyswann/lisa …`
4. `bunx @codyswann/lisa@latest …`, when the copy the others found is too old.

Each reads the requirements from the Lisa package itself, so the repository needs no `spec/`
folder, and none of them installs anything into the repository. If none of them runs at all, the
machine has neither Bun nor Node.js: stop, and tell the operator that the audit needs one of them
installed and that nothing was changed.

## Steps

Run the steps in order. Each one says what it **needs** from the steps before it and what it
**hands on**, so a step can be read, repeated or added to without rereading the others.

### Step 1: Preflight

**Needs:** nothing. **Hands on:** the repository root, the before picture, and a way of running
Lisa that is known to work.

1. Find the root of the repository being audited. Run this inside the folder the operator named,
   or inside the folder this session is in when none was named:

   ```bash
   git rev-parse --show-toplevel
   ```

   The folder it prints is the repository root, even when the operator named a folder inside it:
   the audit covers the whole repository. Every later command runs from the root, and every path
   in the report is written from it. If the folder is not a git repository, audit the folder as
   it is, skip the before picture and step 7, and say in your closing message that the unchanged
   check could not be made.
2. Take the before picture and keep it outside the repository. Make an empty file in the system's
   temporary folder:

   ```bash
   mktemp "${TMPDIR:-/tmp}/lisa-audit-before.XXXXXX"
   ```

   The path it prints is the before picture. Save the state of the repository into it: first
   the whole repository, then every file under `.lisa`, one by one.

   ```bash
   git status --porcelain --ignored > "<before picture>"
   git status --porcelain --ignored --untracked-files=all -- .lisa >> "<before picture>"
   ```

   Remember that path. Step 7 compares against it.
3. Check that the copy of Lisa you are about to use knows the `controls` commands:

   ```bash
   lisa --help
   ```

   The list of commands it prints must include `controls`. If it does not, that copy of Lisa is
   older than this skill. **Do not run any `lisa controls …` command with it:** an older copy takes
   `controls` for the name of a folder to set Lisa up in. Move to the next way of running Lisa in
   "How to run the Lisa commands" and check that one the same way. If none passes, stop and tell
   the operator that the audit needs a newer Lisa and that nothing was changed.

### Step 2: Get the requirements

**Needs:** the repository root. **Hands on:** the list of requirements to answer.

```bash
lisa controls catalogue
```

It prints one JSON document and writes nothing. The document is long: if you need to keep it, save
it in the system's temporary folder, never inside the repository. Its `criteria` list holds every
requirement the audit must answer, in order. For each one:

| Field | What it tells you |
| --- | --- |
| `id` | The requirement's id. Goes in a finding's `criterion` field and nowhere else. |
| `question` | The requirement as a plain question. This is what you are answering. |
| `kind` | What sort of thing answers it. `gate`: an automatic check that can refuse a change. `artifact`: a file or record that exists. `human-attested`: something a person vouches for, so look for where it is written down. |
| `not_applicable_when` | The one condition under which the requirement does not apply. `never` means it always applies. |
| `gates` | Only on a `gate`: the names Lisa gives its own checks of this kind. Read them as hint words for what to look for (`code-style`, `dependency-vulnerability`). An empty list means Lisa has no check of its own for it; the requirement still stands. |
| `title`, `in_scope`, `minimum_rung`, `level_note`, `no_gate_reason` | Background. Not needed to answer. |

Answer exactly the requirements on that list: no more and no fewer.

### Step 3: Name the parts of the repository

**Needs:** the repository root. **Hands on:** the list of parts.

Findings are reported part by part, and a part is identified by its folder path.

- **The whole repository** is always the first part, written `.`.
- **A folder is a part** when it holds a piece of software of its own: it has its own manifest or
  build definition (for example `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`,
  `pom.xml`, `Gemfile`) and its own language or tools, so the answer to "is this checked?" can
  differ from the folder next to it.
- Name the shallowest folder that holds the whole piece: `services/api`, not `services/api/src`.
  Write the path from the repository root with `/` between folder names, with no leading `./` and
  no trailing `/`.
- Folders that use the same tools from one shared configuration are one part, named by the folder
  they share. Split only where the answer could differ.
- These are never parts: documentation, vendored third-party code, installed dependencies, build
  output, test fixtures.
- When the root itself is the one piece of software, there are no separate parts and the list is
  just `.`. Every requirement is then answered in the whole-repository section, and the rules
  about sections in step 4 do not come into play.

### Step 4: Discover what checks each requirement in each part

**Needs:** the requirements and the parts. **Hands on:** one finding for every requirement in every
part.

**Where to look.** Read all of these before deciding anything is absent:

- **Hooks:** `.git/hooks/` (ignore `*.sample`), the folder `git config --get core.hooksPath`
  names, and hook managers such as `.husky/`, `lefthook.yml`, `.pre-commit-config.yaml` and
  `lint-staged` settings.
- **CI configuration:** `.github/workflows/`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml`,
  `azure-pipelines.yml`, `Jenkinsfile`, `.circleci/`, `.buildkite/`.
- **Manifests and task files:** the scripts in `package.json`, `pyproject.toml`, `Makefile`,
  `justfile`, `Taskfile.yml`, and the build files of the language in use.
- **Scripts:** `scripts/`, `bin/`, `tools/` and anything the hooks, pipelines or manifests call.
- **Tool configuration:** linter, formatter, type checker, test runner, coverage and scanner
  settings.
- **Coding-agent settings:** hook registrations and instruction files for the agents used here.
- **A gate declaration:** the `gates` block of `.lisa.config.json`, when the file exists.
- **Written records:** policies, registers, runbooks and ownership files, for requirements of kind
  `artifact` and `human-attested`.
- **What git knows:** `git remote -v` for where the repository is hosted, and `git log` for who
  commits and how changes are described.

**What to record for each thing found.** One mechanism per tool per place it runs:

| Field | Value |
| --- | --- |
| `tool` | The name the tool goes by, such as `ruff` or `eslint`. For a written record, what the document is, such as `written policy`. |
| `command` | The command that runs it, exactly as written where you found it. `null` only when there is no command to quote: a tool that is set up but that no script, hook or pipeline runs. |
| `moment` | When it runs: `commit`, `push`, `pull-request`, `session-start`, `pre-tool`, `post-tool`, or `pre-deploy`, `post-deploy` or `continuous`, each optionally followed by `:` and an environment name such as `pre-deploy:production`. `none` when nothing runs it by itself: a settings file alone (`command` is `null`), or a script that exists but that no hook or pipeline calls (`command` is the script's own line). |
| `locators` | Where you saw it: one or more `{ "path", "line" }`, the path from the repository root and the line counted from 1. Point at a line that exists. |

A mechanism's file may sit anywhere. File the finding under the part whose code it checks. Something
you found that answers no requirement on the list (a type checker, for example) is left out of the
report.

**Which section a requirement is answered in.** Every requirement gets exactly one finding in every
part, but it is really answered in one kind of place. Ask: _could the answer differ between two
folders, because it depends on that folder's code, language or tools?_

- **Yes: it is answered part by part.** Tests, coverage, style, structure, copied code, load
  tests, walk-throughs of the working software before and after release, screens and design, and
  the outside packages a folder's code pulls in. Each part's section holds that part's real
  answer. In the whole-repository section, answer it for the code that is in no part; when there
  is none, the finding there only points at the parts.
- **No: it is answered once, in the whole-repository section.** Accounts, permissions, secrets,
  merge and release rules, agent instructions, records, people, schedules, monitoring, and the
  companies that supply models or services. In each part's section the finding only points at the
  whole-repository section.
- **When a requirement seems to fit both,** go by what is being checked: the software itself is
  answered part by part, and the way people or agents work is answered once.
- **A finding that only points** has the state `not-applicable` and an empty `mechanisms` list.
  Its `what` says the requirement is answered elsewhere, its `why` says it is answered once so
  that it is not counted twice, and its `next` names the section to read: "Whole repository", or
  "Folder api" for the folder `api`.
- Every requirement needs at least one finding that is not a pointer.

**Which state to choose.** Take the first row that is true:

| State | Choose it when | It must carry |
| --- | --- | --- |
| `not-applicable` | The requirement's `not_applicable_when` condition is true here and you can name the fact that makes it true, or the finding only points at another section (above). Something missing from the repository is such a fact only when the condition is about what the repository holds (it has no screen, it uses no outside packages). When the condition is about how the organisation or its agents work, nothing in the repository can show it: that is a `question`. Whether the software is released, deployed or run for users is one of those, unless the repository itself shows it (a release script, a deployment pipeline). Never choose this state because a requirement is hard to answer. | The fact, or the section, in `what`. |
| `exists-not-enforced` | Reading found something that checks or records this. This is the strongest thing an audit can say by itself, however well wired the mechanism looks. It is also the state when what you found covers only some of the requirement: say in `what` which part is covered and which is not. | At least one mechanism with a locator. |
| `unknown` | The answer is a setting held by an outside system you can name from what you read (a hosting platform named by a remote or a pipeline file, a tracker, a monitoring service), and this audit does not read outside systems. A repository with no remote and no pipeline has no such system to name: that is `missing`. | In `next`, the system that holds the answer and the access needed to read it. |
| `question` | Only a person can say: the requirement is of kind `human-attested` and nothing written down vouches for it; or nothing you can read shows whether its `not_applicable_when` condition holds; or two things you found contradict each other. | In `what`, what you looked for and could not establish. In `next`, who is likely to know. |
| `missing` | Everything else: you read every source above and nothing does this. A requirement about keeping something in order (two copies of a check in step, a list up to date) is also `missing` when that thing does not exist at all. | An empty `mechanisms` list. |

**The one way a finding may say `proved`.** You never choose it. If `.lisa/controls/evidence.json`
exists, the attest step wrote it. A finding may say `proved` only by copying: the file holds a
record for the same requirement, and you put that record's `id` in the finding's `evidence_id`. The
check in step 6 refuses a `proved` finding that cites no record, cites a record made for another
requirement, or cites one that is too old. When it refuses, change the state to what you actually
found. Never hunt for another record id to make it pass.

**The three plain-language fields.** Every finding carries all three, each a sentence or two:

- `what`: what was found, or that nothing was. The report prints the requirement's question above
  it, so do not repeat the question.
- `why`: what can go wrong for the business while it stays this way. On a finding that does not
  apply, what would have to change for it to apply.
- `next`: the one thing to do next. When that is the configure step, say what the operator will
  decide there, such as when a check should run. On a finding that does not apply, that nothing
  needs doing now.

### Step 5: Write the report record

**Needs:** every finding. **Hands on:** `.lisa/audit/report.json`.

Write the whole file new on every run, from what you found in this run. Do not edit an earlier
report into shape. The record has exactly these keys and no others:

```json
{
  "schema_version": 1,
  "scopes": [".", "api", "web"],
  "findings": [
    {
      "criterion": "SI7",
      "scope": "api",
      "state": "exists-not-enforced",
      "what": "A style checker is set up for this folder, but nothing runs it when code is committed, pushed or proposed for merging.",
      "why": "A change that breaks the house style can reach the main branch without anyone being told.",
      "next": "Run the configure step and choose when this check should run.",
      "mechanisms": [
        {
          "tool": "ruff",
          "command": null,
          "moment": "none",
          "locators": [{ "path": "api/ruff.toml", "line": 1 }]
        }
      ]
    },
    {
      "criterion": "SI7",
      "scope": "web",
      "state": "missing",
      "what": "Nothing in this folder checks code style, size or complexity.",
      "why": "Code that is hard to read and maintain can be merged with nothing to stop it.",
      "next": "Decide which tool should check this folder, then run the configure step.",
      "mechanisms": []
    },
    {
      "criterion": "SI7",
      "scope": ".",
      "state": "not-applicable",
      "what": "All the code this applies to sits in the two folders, so it is answered for each of them.",
      "why": "It is answered once for each folder so that it is not counted twice.",
      "next": "Read the sections Folder api and Folder web.",
      "mechanisms": []
    }
  ]
}
```

The example shows three findings. The real file has one finding for every requirement in every
part: the number of requirements times the number of parts.

- `scopes` is the list from step 3, `.` first, each part once.
- Every finding has all seven keys shown: `criterion`, `scope`, `state`, `what`, `why`, `next` and
  `mechanisms`, which is an empty list when nothing was found.
- `scope` is one entry of `scopes`. `criterion` is one `id` from step 2.
- `evidence_id` is the only other key a finding may have, and only on a `proved` finding.
- The order of the findings does not matter.
- The file is large. You may draft it in pieces in the system's temporary folder and put the
  pieces together, as long as every finding is your own judgment of what you read and the finished
  file is the only thing written inside the repository.

### Step 6: Have the report checked

**Needs:** `.lisa/audit/report.json`. **Hands on:** a checked report, and `.lisa/audit/report.md`.

```bash
lisa controls report-check
```

- **Exit 0.** The record is valid. The command wrote `.lisa/audit/report.md`, the readable report,
  with one section for the whole repository and one for each part. Never write or edit that file
  yourself.
- **Any other exit.** The audit has not completed. **Stop here:** do not go on to step 7, and do
  not present any finding as the audit's result. Each line printed is one problem, in plain words,
  naming the requirement and the part. The only way forward is to correct
  `.lisa/audit/report.json` so that it says truthfully what you found, and run this step again.
  Never clear a problem by removing a requirement or a part, by pointing at a line that does not
  show the control, or by inventing an evidence record. If the report cannot be made to pass
  honestly, stop and tell the operator in plain words that the audit did not complete and why.

The check holds the record to its shape, its coverage and its pointers. It cannot tell whether you
chose the right state or the right section: that judgment stays yours.

### Step 7: Confirm nothing else changed

**Needs:** the before picture from step 1 and a checked report. **Hands on:** proof that the audit
was read-only.

Take an after picture the same way the before picture was taken in step 1. Make a second empty
file in the system's temporary folder:

```bash
mktemp "${TMPDIR:-/tmp}/lisa-audit-after.XXXXXX"
```

The path it prints is the after picture. Save the state of the repository into it, then compare
the two pictures:

```bash
git status --porcelain --ignored > "<after picture>"
git status --porcelain --ignored --untracked-files=all -- .lisa >> "<after picture>"
diff "<before picture>" "<after picture>"
```

`diff` exits 1 when there is a difference; that is expected. Every line it marks with `<` or `>`
must be the report's own path: `.lisa/` when that folder did not exist before, `.lisa/audit/`, or
one of the two report files under `.lisa/audit/`.

If any other line appears, the audit changed something it must not. Remove only what you yourself
created during this run, then take the after picture and compare again. Never delete, restore or
reset anything you did not create. If a difference remains, tell the operator exactly which paths
changed.

Then remove both pictures, and anything else you set aside in the temporary folder:

```bash
rm "<before picture>" "<after picture>"
```

### Step 8: Tell the operator

**Needs:** the checked report and the result of step 7. **Hands on:** the closing message.

In plain language, for someone who does not code:

1. What was audited: the repository, and each part by its folder.
2. The picture, section by section: for the whole repository and then for each part, how many of
   the requirements really answered there are in place but not yet shown to be enforced, how many
   are missing, how many do not apply, how many could not be checked, and how many need a
   person's answer. When some findings only point at another section, leave them out of every
   count and say that the report's own summary table includes them under "Does not apply".
3. The few findings that matter most, each as its `what` and its `next`.
4. Where the report is: `.lisa/audit/report.md` to read, `.lisa/audit/report.json` as the checked
   record.
5. That nothing else in the repository was changed, and that nothing was committed.
6. The next step: `/lisa:configure` turns these findings, and the operator's answers, into the
   record of what governs the repository.

Say nothing is proved unless the report says so: an audit shows what exists, not what works.
