---
name: lisa-audit
description: "Audit any repository, on any…"
allowed-tools: ["Bash", "Read", "Write", "Glob", "Grep", "Skill"]
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
   `.lisa/audit/report.json`, which you write and which the command in step 1a adds the
   operator's answers to, and `.lisa/audit/report.md`, which the check in step 6 writes. There is
   one more, and only in a repository that already has a `wiki` folder:
   `wiki/gaps.md`, where the same check copies the open questions. You never write that file
   yourself, and a `wiki` folder is never created. Nothing else: no notes or scratch files inside
   the repository, no installed packages, no edit to `.gitignore` or any configuration, no
   `git add`, commit, stash, branch switch or push. Do not create `.lisa.config.json` and do not
   run `lisa apply`. Anything you need to set aside while you work (the printed requirements,
   drafts of the report) goes in the system's temporary folder, outside the repository.
2. **Read, never run, never write.** Discover by reading files and by asking git what it already
   knows (`git remote -v`, `git log`, `git config --get …`). Do not run the repository's own tests,
   linters, builds, hooks or scripts: they leave caches and output behind, and running a check
   proves nothing the audit is allowed to claim. The audit goes outside the repository for one
   thing only: the probes of step 4a, one harmless read of each outside system a requirement
   depends on. There it sends read-only requests only, never a write, and it never prints a
   credential.
3. **You never decide `proved`.** A tool, a configuration file, a hook or a green pipeline shows
   that a control exists, not that it works. See "The one way a finding may say proved" in step 4.
4. **Write for someone who does not code.** Everything the operator reads (the three plain-language
   fields of every finding, and your closing message) is plain language: no requirement ids, no
   stack traces, and no tool or file-format name used as if it explained itself. A tool's name may
   appear, but the sentence must still make sense to someone who has never heard of it. Ids and
   file paths have their own fields and stay there.
5. **Name a secret, never show it.** If a command or file you quote contains a password, key or
   token, write the name it goes by and leave the value out. The same holds for a probe: record
   the request without its headers, and if an error you quote repeats a credential or a web
   address with a password in it, put the name in its place. Never ask for a secret's value, never
   print one, and never write one anywhere.
6. **Code decides whether the report is acceptable.** You do not judge your own report. Step 6
   does, and an unchecked report is not an audit result.
7. **Only a person answers a question.** When the audit cannot establish something, it asks, and
   the operator answers by typing in the report. You never write an answer, guess one, pick one of
   the candidates, or type on an answer line, and you never edit `.lisa/audit/report.md` or
   `wiki/gaps.md`. The command in step 1a is the only thing that moves an answer into the record.

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

### Step 1a: Take in the answers the operator gave

**Needs:** the repository root and a way of running Lisa. **Hands on:** the answers on record.

An earlier audit may have asked questions, and the operator may have answered them since by typing
on the answer lines of `.lisa/audit/report.md` (or of `wiki/gaps.md`, where the repository keeps a
wiki). Take those answers in before anything else, so that nothing later in this run can overwrite
them:

```bash
lisa controls report-check --absorb
```

- **Exit 0, nothing to absorb.** This is a first audit, or nobody has answered anything. Go on.
- **Exit 0, answers recorded.** Each answer was moved into `.lisa/audit/report.json`: it is now an
  entry of `answers`, and its question is gone from `questions`. The files the operator typed in
  were left exactly as they were.
- **Any other exit.** Nothing was changed. Each line printed names a file and a line number and
  says what is wrong there: usually an answer typed under its answer line instead of on it. **Stop
  here.** Tell the operator, in plain words, which line to correct and how, and that their answers
  are still where they typed them. Do not correct the file yourself.

Then read the `answers` list of `.lisa/audit/report.json`, when that file exists. Each entry is a
fact a person gave:

| Field | What it holds |
| --- | --- |
| `id` | The id of the question that was answered. |
| `question` | The question as it was asked. |
| `answer` | What the person typed, word for word. |

Keep the whole list. Step 4 uses each answer as a fact, and step 5 copies the list into the new
record unchanged.

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
| `answered` | Where its finding goes. `repository`: it has one answer for the whole repository. `part`: it has one answer for each part, because the answer depends on that part's code and tools. Step 4 says exactly where to file each kind. This is decided here, not by you. |
| `not_applicable_when` | The one condition under which the requirement does not apply. `never` means it always applies. |
| `gates` | Only on a `gate`: the names Lisa gives its own checks of this kind. Read them as hint words for what to look for (`code-style`, `dependency-vulnerability`). An empty list means Lisa has no check of its own for it; the requirement still stands. |
| `title`, `in_scope`, `minimum_rung`, `level_note`, `no_gate_reason` | Background. Not needed to answer. |

Answer exactly the requirements on that list: no more and no fewer.

### Step 3: Name the parts of the repository

**Needs:** the repository root. **Hands on:** the list of parts.

Findings are reported part by part, and a part is identified by its folder path.

- **The whole repository** is always the first part, written `.`. It holds the requirements that
  have one answer for the repository.
- **A folder is a part** when it holds a piece of software of its own: it has its own manifest or
  build definition (for example `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`,
  `pom.xml`, `Gemfile`) and its own language or tools, so the answer to "is this checked?" can
  differ from the folder next to it. Each folder holds the requirements that have one answer for
  each part.
- Name the shallowest folder that holds the whole piece: `services/api`, not `services/api/src`.
  Write the path from the repository root with `/` between folder names, with no leading `./` and
  no trailing `/`.
- Folders that use the same tools from one shared configuration are one part, named by the folder
  they share. Split only where the answer could differ.
- These are never parts: documentation, vendored third-party code, installed dependencies, build
  output, test fixtures.
- When the root itself is the one piece of software, there are no separate parts and the list is
  just `.`. Every requirement is then answered once, in the whole-repository section.
- When the root holds a piece of software of its own **and** other folders hold theirs, the list
  needs a folder for the root's software too, because once folders are listed `.` holds only the
  requirements that have one answer for the repository. Name the folder its code is in (`src`,
  for example), so its tests, style and outside packages are answered like any other part's.

### Step 4: Discover what checks each requirement in each part

**Needs:** the requirements and the parts. **Hands on:** one finding for every requirement in each
place it is answered.

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

A mechanism's file may sit anywhere: a pipeline file at the root can run one folder's tests. What
decides where a finding is filed is the requirement's `answered` value, below, and for a
requirement answered per part, the part whose code the mechanism checks. Something you found that
answers no requirement on the list (a type checker, for example) is left out of the report.

**Where each requirement's finding goes.** Read the requirement's `answered` value from step 2 and
file it exactly as this table says. The check in step 6 refuses a finding filed anywhere else.

| `answered` | The list of parts is just `.` | The list of parts names folders |
| --- | --- | --- |
| `repository` | One finding, with the scope `.`. | One finding, with the scope `.`. None under any folder. |
| `part` | One finding, with the scope `.`. | One finding under every folder, each saying what is true of that folder. None with the scope `.`. |

- Every finding is a real answer. There is no finding whose only job is to point at another
  section: a requirement simply does not appear where it is not answered.
- Do not move a requirement because its answer seems to live somewhere else. When a requirement
  with one answer for the repository is met for one folder and not for another, that is one
  finding, with the scope `.`: say in `what` which folder is covered and which is not, and list
  every mechanism you found.
- A requirement answered per part gets a finding under every folder, including a folder where it
  does not apply (a folder with no screen, for a requirement about screens) or where nothing was
  found.

**Which state to choose.** Take the first row that is true:

| State | Choose it when | It must carry |
| --- | --- | --- |
| `not-applicable` | The requirement's `not_applicable_when` condition is true here and you can name the fact that makes it true. Something missing from the repository is such a fact only when the condition is about what the repository holds (it has no screen, it uses no outside packages). When the condition is about how the organisation or its agents work, nothing in the repository can show it: that is a `question`. Whether the software is released, deployed or run for users is one of those, unless the repository itself shows it (a release script, a deployment pipeline). Never choose this state because a requirement is hard to answer, or because its answer is written up in another section. | The fact, in `what`. |
| `exists-not-enforced` | Reading found something that checks or records this. This is the strongest thing an audit can say by itself, however well wired the mechanism looks. It is also the state when what you found covers only some of the requirement: say in `what` which part is covered and which is not. | At least one mechanism with a locator. |
| `unknown` | The answer is a setting held by an outside system you can name from what you read (a hosting platform named by a remote or a pipeline file, a tracker, a monitoring service), and the probe of that system in step 4a got no answer: the read was refused, or could not be tried. When the probe did get an answer, the setting was read, and the finding takes whichever other row is true of what was read. A repository with no remote and no pipeline has no such system to name: that is `missing`. | In `what`, that Lisa could not reach the system, and the error it gave. In `next`, the access needed to read it, in the probe's own words. And the finding is listed in that probe's `needed_by` (step 4a). |
| `question` | Only a person can say, and nobody has said yet: the requirement is of kind `human-attested` and nothing written down vouches for it; or nothing you can read shows whether its `not_applicable_when` condition holds; or two things you found contradict each other. Never choose it for a finding whose question already has an answer on record (see "Using an answer on record"). | In `what`, what you looked for and could not establish. In `next`, who is likely to know. And its question, in the record's `questions` list (see "Asking a question"). |
| `missing` | Everything else: you read every source above and nothing does this. A requirement about keeping something in order (two copies of a check in step, a list up to date) is also `missing` when that thing does not exist at all. | An empty `mechanisms` list. |

**A requirement of kind `human-attested` is met only by a person's answer.** Decide this before the
table above. Something written down that you found does not meet it: the attest step counts such a
requirement as met only when a person's answer to its question is on record. So unless `answers`
already holds an answer under the finding's `criterion` and `scope`, file the finding as `question`
and ask, even when you found a document that seems to cover it; say what you found in the
question's `candidates`.

**The one way a finding may say `proved`.** You never choose it. If `.lisa/controls/evidence.json`
exists, the attest step wrote it. A finding may say `proved` only by copying: the file holds a
record for the same requirement, and you put that record's `id` in the finding's `evidence_id`. The
check in step 6 refuses a `proved` finding that cites no record, cites a record made for another
requirement, or cites one that is too old. When it refuses, change the state to what you actually
found. Never hunt for another record id to make it pass.

**Asking a question.** A question goes in the record's `questions` list, and the operator answers
it by typing in the report. There are two kinds, and neither has an id you make up:

- **A question about a requirement.** Every finding in the state `question` has exactly one, and
  its `id` is the finding's `criterion`, then `@`, then the finding's `scope`: `AC1.7@.` for the
  whole repository, `SI7@api` for the folder `api`. The check in step 6 refuses a `question`
  finding with no question, and a question of this kind whose finding is in another state.
- **A question about how the repository is set up.** It belongs to no single requirement, and its
  `id` is one of these three, exactly as written:

  | `id` | Ask it when |
  | --- | --- |
  | `tracker` | The repository names no tracker for Lisa to file tickets in: `.lisa.config.json` is absent, or its `tracker` is not `jira`, `github` or `linear`. The check in step 6 refuses a report that does not ask it then. A tracker that answered a probe in step 4a is a candidate answer, never the answer: the question is still asked. |
  | `hosting-platform` | You cannot tell from the git remotes or the pipeline files where the repository is hosted and where its changes are merged. |
  | `repository-administrator` | A finding's next step needs someone who can change the hosting platform's settings, and nothing written names who that is. |

Each question has these fields:

| Field | Value |
| --- | --- |
| `id` | As above. The same on every run, so a question is never asked twice. |
| `text` | The question, as one plain sentence ending in a question mark, on one line. No requirement id in it. |
| `candidates` | The answers you found evidence for. Each has an `answer`, the candidate in plain words, and a `found_in`, where you found it in plain words (which file, remote or commit, and what it says there). An empty list when you found none. |
| `no_candidates_reason` | Only when `candidates` is empty, and required then: where you looked and found nothing, in plain words. |

A question never carries an `answer` of its own. Do not ask what you can read, and do not ask a
question that has an answer on record.

**Using an answer on record.** An entry of `answers` (step 1a) is a fact a person gave. Its
question is not asked again: leave it out of `questions`. When its `id` is a finding's `criterion`
and `scope`, decide that finding again with the answer as one more thing you know, by the table
above, and give it any state but `question`:

- the answer shows the requirement's `not_applicable_when` condition holds: `not-applicable`, with
  the answer as the fact in `what`;
- the answer points at something written down that you can now read: read it, and file what you
  find, with its locator;
- the answer names an outside system that holds the setting: probe that system in step 4a, and
  file what the probe allows: what was read when it answered, `unknown` when it did not;
- the answer states something that nothing in the repository records: `missing`. Say in `what`
  that the operator answered and nothing written down records it yet, and in `next` that the
  configure step writes it down.

If an answer does not settle the matter, do not ask again. File what you can establish, and say in
`next` what is still needed and that the operator can replace the answer on its answer line in the
report. The check in step 6 refuses a finding left in the state `question` once its question was
answered.

**The three plain-language fields.** Every finding carries all three, each a sentence or two:

- `what`: what was found, or that nothing was. The report prints the requirement's question above
  it, so do not repeat the question.
- `why`: what can go wrong for the business while it stays this way. On a finding that does not
  apply, what would have to change for it to apply.
- `next`: the one thing to do next. When that is the configure step, say what the operator will
  decide there, such as when a check should run. On a finding that does not apply, that nothing
  needs doing now.

### Step 4a: Try one read of each outside system

**Needs:** the findings of step 4, and the outside systems they turned up. **Hands on:** one probe
for each of those systems, and every finding that depends on one settled.

A tool being set up does not mean an agent can reach it. Before the report says anything about a
setting an outside system holds, try one harmless read of that system and write down exactly what
happened. That record is a **probe**.

**Which systems.** One probe for each outside system that a finding's answer depends on, and that
something you read names: the hosting platform (a git remote, a pipeline file), the tracker, an
error or monitoring service, a code-quality service. Probe a system once, however many findings
depend on it. Do not probe a system that nothing in the repository names.

**What a probe may do.** These hold for every probe, without exception:

- **Read-only requests only.** One request that fetches something and changes nothing. Never
  create, update, delete, comment, label, assign or trigger anything, and never send a request
  whose effect you are not sure of.
- **Never a write to this machine either.** Do not sign in, install a tool, save a setting or
  approve a prompt in order to reach a system. If a read is not possible with the access this
  machine already has, that is the result to record.
- **Never print a credential.** Do not display a token, do not run a command that prints the
  environment, and do not put a credential, a header or a web address with a password in the
  report.

**The hosting platform.** Lisa makes this read itself:

```bash
lisa controls merge-protection
```

It only reads, takes no option that could change that, and writes no file. It prints one JSON
document, and exits 0 whether or not the platform could be read:

| Field | What it holds |
| --- | --- |
| `probe` | The probe entry for the hosting platform. Copy it into the record's `probes` exactly as printed. `null` when nothing says where the repository is hosted. |
| `merge_protection` | What the platform enforces on the default branch, when it answered: `rulesets`, `required_checks` (each a `context`, the check's name, and the `ruleset` that requires it) and a `note` saying what was read. `null` when it did not answer. |
| `branch` | The default branch, when the platform named it. |
| `platform` | Where the repository is hosted and how that was learned. |
| `requests` | Every request that was made, in order. All are reads. |

Then settle the finding for the requirement about checks that cannot be skipped (`AC5.1`, always
with the scope `.`), by the `result` of that probe:

- **`probe` is `null`.** There is no outside system to probe and no entry to record. Leave the
  finding as step 4 decided it.
- **`reachable`.** Decide the finding from `merge_protection`. When `required_checks` is empty,
  the state is `missing`: say in `what` that the platform was read and requires no check before a
  change is merged into the default branch, and that branch protection of the older kind, if the
  repository uses it, was not read. When it lists checks, the state is `exists-not-enforced`: say
  in `what` which checks the platform requires, and point each mechanism at the line of the
  pipeline file that produces one of them. If nothing in the repository produces any required
  check, say so in `what` and choose `missing`.
- **`unreachable` or `not-attempted`.** The state is `unknown`, whatever the pipeline files
  suggest. The check in step 6 refuses any other state.

**Every other system.** Reach it through the Lisa skill that owns access to it, loaded the way
this agent loads a skill:

| System | Skill |
| --- | --- |
| Jira or Confluence | `lisa-atlassian-access` |
| Linear | `lisa-linear-access` |
| Notion | `lisa-notion-access` |
| Sentry | `lisa-sentry-access` |
| SonarQube Cloud or Server | `lisa-sonarcloud-access` |
| PostHog | `lisa-posthog-access` |

Follow only the part of that skill that chooses a way in and confirms which account it is signed
in as. That confirmation is the one harmless read. Stop there: run none of the skill's
operations. Each of those skills fetches the credential it needs through `lisa-secrets-access`.
Let it. Do not fetch one yourself.

- The skill confirmed the account: the result is `reachable`, and `request` is the read it made,
  as the skill names it, without headers.
- The skill stopped because a credential is missing or was refused: the result is `unreachable`,
  and `observed_error` is the message, as it was received.
- No read could be tried: the result is `not-attempted`, with the `reason`. That is the case
  when the repository does not say which account, site or project to read, when this agent cannot
  load a skill, and when the system has no skill in the table.

GitHub Issues is read with the hosting platform's own access: when the hosting platform's probe
covers GitHub, do not probe GitHub a second time as the tracker.

**What a probe records.** Each probe is one entry of the record's `probes` list:

| Field | Value |
| --- | --- |
| `id` | `hosting-platform` for the hosting platform and `tracker` for the tracker. For any other system, its name in lower-case words joined by hyphens, such as `sentry`. Each id once. |
| `system` | What the system is, in plain words on one line, such as `Sentry, where the pipeline sends its error reports`. |
| `needed_by` | The findings whose answer depends on this system, each as its `criterion` and `scope`. An empty list when none does. The hosting platform's probe always lists `AC5.1` with the scope `.`. |
| `result` | `reachable`, `unreachable` or `not-attempted`. |
| `request` | The read-only request that was made, on one line: what was asked and where, with no header and no credential. Required when the result is `reachable`, because a system is never recorded as reached without one. Give it too when the result is `unreachable` and a request was sent. Leave it out when nothing was attempted. |
| `observed_error` | Only when the result is `unreachable`, and required then: the error, quoted as it was received. |
| `reason` | Only when the result is `not-attempted`, and required then: why not, in plain words on one line. |
| `access_needed` | Whenever the result is not `reachable`: the access an agent needs to read this system, in plain words on one line. Name a secret by the name it goes by. |

Write `system`, `reason` and `access_needed` for someone who does not code, with no requirement id
in them.

**Settle every finding that depends on a probe.** A finding listed in the `needed_by` of a probe
that is not `reachable` cannot be answered, whatever you read in the repository:

- its state is `unknown`;
- its `what` says, in these words: `Lisa could not reach <system>: <error>.` For a probe that was
  not attempted: `Lisa did not try to reach <system>: <reason>`;
- its `next` says: `To check this requirement an agent needs <access>.`, where `<access>` is the
  probe's `access_needed`, word for word.

A finding whose system answered is decided from what was read, by the table in step 4.

**A probe is not an answer.** What a probe establishes goes in `probes` and nowhere else. Never add
it to `answers`: that list holds only what a person typed. When the tracker answered its probe,
offer it as a candidate on the `tracker` question, saying in `found_in` that Lisa could read it
with the access this machine has. The question is still asked whenever the repository names no
tracker, and only the operator's answer settles it.

### Step 5: Write the report record

**Needs:** every finding and every probe. **Hands on:** `.lisa/audit/report.json`.

Write the whole file new on every run, from what you found in this run. Do not edit an earlier
report into shape. One thing is carried over and never rewritten: `answers`, the list you read in
step 1a, copied exactly as it was. The record has exactly these keys and no others:

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
      "criterion": "AC1.7",
      "scope": ".",
      "state": "question",
      "what": "Nothing written in the repository names the person who answers for what the agents do, or a backup for that person.",
      "why": "If an agent's change causes harm, nobody is on record as the one who decides what happens next.",
      "next": "Ask whoever runs this team to name that person and a backup.",
      "mechanisms": []
    },
    {
      "criterion": "AC5.1",
      "scope": ".",
      "state": "unknown",
      "what": "Lisa could not reach GitHub, where this repository is hosted and its merge settings are kept: To get started with GitHub CLI, please run: gh auth login.",
      "why": "Until those settings can be read, nobody knows whether a change can be merged without passing its checks.",
      "next": "To check this requirement an agent needs the GitHub command-line tool (gh) signed in with an account that can read this repository on GitHub.",
      "mechanisms": []
    }
  ],
  "questions": [
    {
      "id": "tracker",
      "text": "Which tracker does the team plan and follow its work in?",
      "candidates": [
        {
          "answer": "GitHub Issues",
          "found_in": "The address of the remote named origin is on github.com, and three commit messages end with an issue number."
        }
      ]
    },
    {
      "id": "AC1.7@.",
      "text": "Who answers for what the coding agents do in this repository, and who is that person's backup?",
      "candidates": [],
      "no_candidates_reason": "The audit read the ownership files, the contribution guide and the agent instruction files, and none of them names a person."
    }
  ],
  "answers": [],
  "probes": [
    {
      "id": "hosting-platform",
      "system": "GitHub, where this repository is hosted and its merge settings are kept",
      "needed_by": [{ "criterion": "AC5.1", "scope": "." }],
      "result": "unreachable",
      "request": "GET repos/example-owner/example-repo/rulesets",
      "observed_error": "To get started with GitHub CLI, please run:  gh auth login",
      "access_needed": "the GitHub command-line tool (gh) signed in with an account that can read this repository on GitHub"
    }
  ]
}
```

The example shows four findings: a requirement answered per part (`SI7`), once under each folder
and not under `.`, and two requirements with one answer for the repository (`AC1.7` and `AC5.1`),
each once under `.`.
The real file has one finding for every requirement with the `answered` value `repository`, plus
one for every requirement with the value `part` under each folder. When the list of parts is just
`.`, that is one finding for every requirement.

It also shows two questions: one about how the repository is set up (`tracker`), with a candidate
answer and where it was found, and the one that belongs to the `AC1.7` finding, with no candidate
and a statement of where the audit looked. On a later run, once the operator has answered the
tracker question, that question is gone and `answers` holds what step 1a recorded:

```json
[
  {
    "id": "tracker",
    "question": "Which tracker does the team plan and follow its work in?",
    "answer": "GitHub Issues"
  }
]
```

- `scopes` is the list from step 3, `.` first, each part once.
- Every finding has all seven keys shown: `criterion`, `scope`, `state`, `what`, `why`, `next` and
  `mechanisms`, which is an empty list when nothing was found.
- `scope` is one entry of `scopes`, chosen by the table in step 4. `criterion` is one `id` from
  step 2.
- `evidence_id` is the only other key a finding may have, and only on a `proved` finding.
- `questions` holds every question still open, as "Asking a question" in step 4 describes: one for
  each finding in the state `question`, plus the setup questions. An empty list when there is
  nothing to ask.
- `answers` is the list from step 1a, unchanged: the same entries, the same words. An empty list
  when nobody has answered anything. Never add, reword or remove an entry.
- `probes` holds one entry for each outside system step 4a tried, or could not try, to read. An
  empty list when no finding depends on an outside system. The example shows the hosting platform
  refusing the read, and the finding that depends on it left `unknown`, naming the access needed.
- The order of the findings, of the questions and of the probes does not matter.
- The file is large. You may draft it in pieces in the system's temporary folder and put the
  pieces together, as long as every finding is your own judgment of what you read and the finished
  file is the only thing written inside the repository.

### Step 6: Have the report checked

**Needs:** `.lisa/audit/report.json`. **Hands on:** a checked report, and `.lisa/audit/report.md`.

```bash
lisa controls report-check
```

- **Exit 0.** The record is valid. The command wrote `.lisa/audit/report.md`, the readable report,
  with the open questions near the top, each with a line for the operator's answer, then, when a
  probe got no answer, a section named "What could not be reached", then one
  section for the whole repository and one for each part. Where the repository already has a
  `wiki` folder, it also copied the open questions into `wiki/gaps.md`, as one marked block, and
  left the rest of that file as it was. Never write or edit either file yourself.
- **Any other exit.** The audit has not completed. **Stop here:** do not go on to step 7, and do
  not present any finding as the audit's result. Each line printed is one problem, in plain words,
  naming the requirement and the part. The only way forward is to correct
  `.lisa/audit/report.json` so that it says truthfully what you found, and run this step again.
  A line saying a requirement is answered once for the whole repository, or once for each folder,
  means a finding is filed in the wrong place or is absent from the right one: move it or add it
  as the table in step 4 says.
  A line saying the report or the wiki file holds an answer that the record does not carry means
  the `answers` list was not copied over. Run the command of step 1a again, which puts it back,
  then this step again. The operator's answers are safe meanwhile: a failed check overwrites
  nothing.
  A line saying a finding depends on an outside system the audit could not reach means the
  finding must be `unknown` and its `next` must carry the probe's `access_needed`, word for word.
  A line saying a probe holds something shaped like a credential names the probe and the field
  and never repeats the value: take the value out and write the name it goes by.
  Never clear a problem by removing a requirement or a part, by pointing at a line that does not
  show the control, by inventing an evidence record, by writing an answer, by recording a system
  as reached when it was not, or by removing a probe. If the report cannot
  be made to pass honestly, stop and tell the operator in plain words that the audit did not
  complete and why.

The check holds the record to its shape, its coverage, where each requirement is filed, its
pointers into the repository, its questions, the answers people typed, and its probes: a system
is never recorded as reached without the request that was made, and a finding that depends on a
system that did not answer is never accepted as in place. It cannot tell whether
you chose the right state: that judgment stays yours.

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
one of the two report files under `.lisa/audit/`. One other path may appear, and only in a
repository that had a `wiki` folder before the audit began: `wiki/gaps.md`. A line for `wiki/`
itself means a wiki folder was created, which the audit must never do.

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
   the requirements answered there are in place but not yet shown to be enforced, how many are
   missing, how many do not apply, how many could not be checked, and how many need a person's
   answer. These are the numbers in the report's own summary table. Say once that a requirement
   appears under the whole repository when it has one answer for the repository, and under each
   folder when its answer can differ from folder to folder.
3. The few findings that matter most, each as its `what` and its `next`.
4. The questions that need the operator's answer: how many there are, and each one as its plain
   sentence. Say how to answer: open `.lisa/audit/report.md`, find "Open questions" near the top,
   type each answer on its line that starts `- **Answer**:` in place of `_(human fills in)_`, save
   the file, and run the audit again. Say that an answer goes on that one line and that every
   other line is left as it is. Where the repository has a wiki, say that the same questions are
   in `wiki/gaps.md` and may be answered there instead. If this run took in answers the operator
   had given, say which questions are now settled and will not be asked again.
5. What could not be reached: each outside system that did not answer, as one plain sentence,
   `Lisa could not reach <system>: <error>.`, then the access to arrange,
   `To check this requirement an agent needs <access>.` Say that once the access is in place,
   running the audit again reads the system. If every system answered, or none was needed, leave
   this out.
6. Where the report is: `.lisa/audit/report.md` to read, `.lisa/audit/report.json` as the checked
   record.
7. That nothing else in the repository was changed, that nothing was sent to an outside system
   except harmless reads, and that nothing was committed.
8. The next step: `/lisa:configure` turns these findings, and the operator's answers, into the
   record of what governs the repository.

Say nothing is proved unless the report says so: an audit shows what exists, not what works.
