---
type: documentation
created: 2026-11-17
updated: 2026-11-18
---

# Control Audit: Audit, Configure, Enforce, Attest

Four commands that tell an operator which controls a repository really has, on any stack. This page is for someone arriving cold: what each command is for, what it leaves behind, the words it uses, and the limits you will meet. The [README](../../../README.md) has the short version.

## What it is for

A **control** is a rule about the software plus the check that enforces it. Most repositories have some: a formatter, a test suite, a rule that nothing merges without review. Having them is not the same as knowing, with evidence, which of them would actually stop a bad change today.

The four commands answer that in order:

1. **Audit** finds what already checks the repository, and what is missing.
2. **Configure** declares the checks that govern it, in one record a person can review.
3. **Enforce** wires those checks in, so that something really runs them.
4. **Attest** proves each one by trying to break it, and gives a verdict that code computed.

The verdict measures the repository against Level 1 of the specification under `spec/` ([`spec/tasc-0.1-draft.md`](../../../spec/tasc-0.1-draft.md)). The wiki describes that specification, under its provisional name, in [TASC — Trust in Autonomous Software Criteria](../../concepts/tasc-specification.md). Level 1 is 77 requirements. Each one is held in the criterion catalogue, [`spec/tasc-criteria.json`](../../../spec/tasc-criteria.json), with the plain question it asks.

## Two roads

Which road a repository takes is decided by code (`lisa controls seed`), never by the agent.

| Road | When | What happens |
| --- | --- | --- |
| **Paved** | The whole repository is one piece of software on a project type Lisa supports. | Configure declares the checks Lisa ships for that type. Nothing is discovered and nothing is asked. Two runs give the same result. |
| **Discovery** | Anything else: a stack Lisa has no project type for, or a repository with more than one part, such as `api/` beside `web/`. | Your own coding agent supplies the knowledge of your tools. It reads what is there, proposes each check, and you decide one at a time. Lisa's code checks the agent's work at every step. |

A repository with more than one part is always on the discovery road, even when one of the parts is a supported project type. Lisa does not apply a project type to one folder of a mixed repository.

On both roads the agent never decides an outcome. It writes a report or a declaration, and a `lisa controls` command accepts or refuses it. No verdict is ever written by a model.

## The four commands

None of them commits, pushes or stages anything. What they write stays in the working copy for the operator to review and commit.

| | Audit | Configure | Enforce | Attest |
| --- | --- | --- | --- | --- |
| **Does** | Reads the repository and reports where each requirement stands. | Declares the checks and generates the control register. | Installs what runs the checks, files tickets for what is missing, compares merge protection. | Proves each check and computes the verdict. |
| **Asks you** | The questions only a person can answer. | Each check, one decision at a time. Each threshold. | Which coding agents the team uses. Whether to change merge settings. | Whether to open real pull requests. Whether to run a proof that reaches outside the repository. |
| **Needs first** | Nothing. Not even `lisa apply`. | An audit report, on the discovery road. | A declaration and a register. | A register whose checks have paired proofs. Enforce should have run, or what is proved in the copy is not what runs in your checkout. |

### Audit

The audit reads files and asks git what it already knows. It never runs the repository's tests, linters, builds or hooks. It splits the repository into **parts** by folder and gives every requirement exactly one **finding** in each place the requirement is answered: once for the whole repository, or once per part where the answer can differ from folder to folder.

Each finding is in one of six states.

| State | Means |
| --- | --- |
| `exists-not-enforced` | Something is in place. Nothing has shown that it stops a bad change. |
| `missing` | The repository has nothing for this. |
| `not-applicable` | The requirement does not apply here, for a stated reason. Refused for a requirement that always applies, which is about half of them. |
| `unknown` | It could not be checked, usually because an outside system could not be read. |
| `question` | Only a person knows. The audit asks. |
| `proved` | An attest run has already proved it for this part, and that evidence is still current. The audit never decides this itself. |

The audit also tries one harmless read of each outside system a requirement depends on, such as the hosting platform's merge protection or the ticket tracker. It records whether each could be reached and names the access that is missing when it could not. It never sends a write.

**What the check refuses.** `lisa controls report-check` holds the agent's report to rules before anyone relies on it. Among them:

- A requirement that always applies cannot be filed as `not-applicable`. For the others, whether the stated reason holds is the agent's judgement, so the line that says the check passed also says how many findings were filed that way.
- A finding shows that something is in place by pointing at a file and a line. The pointer has to lead to something the repository itself holds. It may not lead into `.lisa/audit/` (the audit's own report), into `.lisa/controls/` (Lisa's own records, except the control register), or into `.git` (except a hook installed in `.git/hooks/`).
- `proved` needs an evidence record for the same requirement and the same part. Where that record is one half of a paired proof, the other half has to be on record too. The record also has to be as strong as the requirement asks for: a setting that was only read does not prove a requirement that needs a bad change to have been tried. A finding in any other state cites no record.

**Answering a question.** Open `.lisa/audit/report.md`, find "Open questions" near the top, type each answer on its `- **Answer**:` line, save, and run the audit again. The answer is taken into the record and the question is not asked again. The agent never answers a question for you.

- **Type on the answer line only.** Text typed on any other line of a question, such as the question itself or one of the candidates, is refused with its line number. It is never taken as an answer and never dropped without a word. Running a Markdown formatter over the file is not such a change: what it does to escapes, emphasis marks, bullets and spacing is ignored. Re-wrapping long lines onto several is not ignored, so keep a formatter from doing that to this file. A refusal never asks you to give up an answer: for a question that is already answered, it says which lines to put back.
- **A placeholder is not an answer.** A line left as it was, or holding only `TBD`, `?` or `n/a`, leaves the question open.
- **An answer counts only while it stands on its line.** Keep `.lisa/audit/report.md`. If the file is deleted, the answers in the record are refused until the file is put back or the answers are removed, because nothing then shows that a person typed them. Attest reads the answer lines again when it records a person's word.

**It writes** `.lisa/audit/report.json` (the record, checked by `lisa controls report-check`) and `.lisa/audit/report.md` (rendered from it). In a repository that already has a `wiki/` folder it also lists the open questions in `wiki/gaps.md`. Nothing else is created or changed, and a `wiki/` folder is never created.

### Configure

Configure turns findings and answers into a declaration. A check is declared only where the audit shows it exists or a person has answered the audit's question about it. Every declared check names what supports it, and `lisa controls declaration-check` refuses one that the audit does not back. Nothing is declared for a requirement that is still missing or still a question.

On the discovery road a **threshold**, such as a minimum share of code covered by tests, is the repository's own number. The agent proposes the value measured today and the operator confirms it. Lisa never imposes the numbers it uses on its own project types.

For each check, configure also writes the **paired proof**: two small patch files, one change that breaks the check's rule and one that does not. `lisa controls proof-check` tries them and says whether they work. This is a feedback loop for whoever writes the patches. It is not a proof of the control.

**It writes** the `gates` block in `.lisa.config.json` (the only thing a person or an agent authors), the patch files under `.lisa/controls/proofs/`, and the **control register** at `.lisa/controls/register.json`.

The register is generated from the `gates` block by `lisa controls register` and is never edited by hand. The same declaration always gives the same file, byte for byte. It has one entry per check and folder, named `<check>@<folder>` (for example `code-style@api`), and each entry states:

- which requirements it serves;
- the folder it covers;
- whether it is **authoritative** (required somewhere the author of a change does not control) or **advisory**. A check that is declared authoritative but is required only at commit or push is refused, because its author can skip it there;
- its **enforcement points**: each moment it runs at, and where;
- what measures it, with which parameters;
- its paired proof;
- the accountable party, when one is declared.

Its format is published as `schemas/control-register.schema.json` in the Lisa package.

### Enforce

A declared check governs nothing until something runs it. Enforce does three things and then reports.

1. **It installs the carriers.** A carrier is the small script that starts the declared checks at a given moment: before a commit, before a push, and after a coding agent writes a file. Existing hooks are kept. Whoever owns hooks in the repository keeps them (a hooks folder, Husky, Lefthook, the pre-commit framework, or git's own hooks folder), and the call is added in the owner's own way. What was there runs first and still fails the hook when it fails. Lisa never replaces a file it did not write.
2. **It files one ticket for each missing capability**, through the configured tracker. The tickets are filed on hold unless the operator passed `build_ready=true`. A later run finds the same ticket again and does not file a second. With no tracker configured, nothing is filed and each such requirement is reported as waiting on one.
3. **It compares merge protection with the register.** `lisa controls protect` reads the hosting platform and, where a declared check is not required before a merge, writes a handover file telling an administrator exactly what to set.

Then `lisa controls enforce-report` gives every requirement exactly one outcome.

| Outcome | Means |
| --- | --- |
| `wired` | A declared check serves it, and something now runs that check everywhere enforce is answerable for. |
| `ticketed` | The repository has nothing for it, and a ticket exists. |
| `blocked` | Somebody has to act first. The reason says who and what. |
| `nothing-to-enforce` | Nothing to install, file or wait for: it does not apply, it is met by a written record or a person's word, or it is a check Lisa itself ships, which a supported project type runs where enforce cannot look. A declared check that nothing runs yet never puts a requirement here: the requirement takes the outcome of another declared check that serves it, and when there is none it is `blocked` until configure says when the check runs. |

The report also lists every required check that fails on the default branch as it stands today, with what it printed. Enforce fixes nothing and adds no check of its own.

**It writes** the program that runs the checks under `scripts/`, hook scripts under `.lisa/hooks/`, a record of both at `.lisa/controls/carriers.json`, one ignore entry for that program's timing files, one hook entry in each coding agent's own settings, the git setting that makes git run the hooks in this checkout, the tickets, and `.lisa/controls/merge-protection-change.md`. In `.lisa.config.json` it may record a coding agent that cannot be enforced on, and the pipeline file it wrote on a platform other than GitHub. A second run with nothing changed writes nothing.

### Attest

Attest is the only step allowed to say a control works, and it says so by code alone. It makes a temporary copy of the last commit and installs the carriers there. Then, for each register entry, it plants the violating change and makes a real `git commit` or `git push`, and does the same with the clean change. The copy is removed however the run ends, and the proofs touch nothing in the operator's own files.

| Result | Means |
| --- | --- |
| `passed` | The check refused the violating change, printing the failure text declared for it, and let the clean change through. |
| `failed` | The violating change got through, or the clean change was refused. |
| `unproved` | No proof was run: a patch is missing, or the check does not run at commit or push. |
| `unknown` | A proof was called for and gave no answer that can be trusted. |

For a check that runs on pull requests, the default is to read the hosting platform's merge protection and create nothing. With the operator's yes (`lisa controls attest --pull-request-canaries`), it opens real draft pull requests on GitHub from branches under `lisa-attest/`, reads whether the platform would block each one, closes them and deletes the branches. None is ever merged. Only drafts are opened, because GitHub does not merge a draft: where it does not offer drafts for the repository, no pull request is opened in their place and the check reads unknown, with GitHub's reason. Before closing each one the command asks whether it was merged. Anything it could not remove is named on standard error, and a test pull request that something else merged fails the run and is named with its number.

A proof that says it does something outside the repository is not run unless the operator agrees (`lisa controls attest --acknowledge-external-effects`).

**It writes** three files, when the proofs have run: `.lisa/controls/evidence.json` (one record per result per requirement), `.lisa/controls/register.json` again (new evidence can change it), and `.lisa/controls/verdict.json`. They are meant to be committed. `lisa controls attest --check` runs no proof and writes nothing: it computes the verdict again from the committed register and evidence, at the current time, and names every difference. A verdict edited by hand fails it. It also asks whether the checks that were proved are the checks that are here. The evidence holds a fingerprint of the content of everything that defines the checks, taken where the proofs ran: the `gates` block of `.lisa.config.json`, each proof's patch files, the hook scripts, the program that runs the checks, and your own hook files that call it. The command takes the same fingerprint from the repository as it is, and fails, naming the file, when one differs.

**You can commit in any order.** Configure and enforce leave the declaration, the patch files and the hook files in the working copy for you to commit. Attest proves them as they are on disk, and its evidence is tied to what those files hold, not to a commit. Commit them before the three result files, with them or after them: the check passes as long as they are not changed. It reads the files and nothing from version history, so it gives the same answer in a shallow clone, after a squash or rebase merge, and in a checkout another user owns.

If attest finds a file that defines the checks is not the same in your repository as in the copy it proved, it says so on standard error and says what to do: for a hook script or the program that runs the checks, run `lisa controls install-carriers` to bring your copy up to date; for anything else, commit the change or undo it, then run attest again.

`lisa controls attest --workspace <folder>` is a report and writes none of the three files. It runs each check's own command in a copy you made and makes no commit or push, so it shows that a check works and not that anything runs it.

The attest step also runs `lisa controls reconcile`, which compares the register with what is installed in this checkout, in both directions: a place the register says a check runs where nothing runs it, and a command a hook runs that the register does not list.

**Before anything is installed.** `lisa controls attest --before-enforce` answers a different question: which checks exist and are enforced by nothing? It builds the same copy with no carriers, tries each violating change through a real commit or push, and runs the check's own command on it. A change that goes through is a check that exists and is not enforced. This is a diagnosis, not a verdict: it writes no evidence, register or verdict, and it offers its findings to the audit report.

## Starting a command on each coding agent

| Coding agent | Audit | Configure | Enforce | Attest |
| --- | --- | --- | --- | --- |
| Claude Code | `/lisa:audit` | `/lisa:configure` | `/lisa:enforce` | `/lisa:attest` |
| Cursor | `/lisa:audit` | `/lisa:configure` | `/lisa:enforce` | `/lisa:attest` |
| OpenCode | `/lisa:audit` | `/lisa:configure` | `/lisa:enforce` | `/lisa:attest` |
| Antigravity | `/lisa:audit` | `/lisa:configure` | `/lisa:enforce` | `/lisa:attest` |
| Copilot | `/lisa:audit` | `/lisa:configure` | `/lisa:enforce` | `/lisa:attest` |
| Codex | `$lisa-audit` | `$lisa-configure` | `$lisa-enforce` | `$lisa-attest` |
| Devin | `/lisa:lisa-audit` | `/lisa:lisa-configure` | `/lisa:lisa-enforce` | `/lisa:lisa-attest` |

Codex and Devin have no command files. There the skill's name is the way in, and any option (a folder, `build_ready=true`, a before-enforce run) goes in the operator's message. The per-agent facts are recorded in `parity/control-commands.json` and checked by `bun run check:plugins`.

## The files

| Path | Written by | Notes |
| --- | --- | --- |
| `.lisa/audit/report.json` | The agent, in the audit | The checked record. Refused by `lisa controls report-check` when it is incomplete or unsupported. |
| `.lisa/audit/report.md` | `lisa controls report-check` | For reading. A person types only on the answer lines, and the file is kept: the answers in the record count only while it holds them. |
| `wiki/gaps.md` | `lisa controls report-check` | Only where a `wiki/` folder already exists. The open questions, in one marked block. |
| `.lisa.config.json`, `gates` block | The agent, in configure, on the operator's decisions | The only authored source of what governs the repository. |
| `.lisa/controls/proofs/` | The agent, in configure | Two patch files per check: `<check>.violation.patch` and `<check>.clean.patch`. |
| `.lisa/controls/register.json` | `lisa controls register`, and attest | Generated. Never edited. |
| `scripts/`, `.lisa/hooks/` | `lisa controls install-carriers` | The program that runs the checks and the hook scripts that start it. |
| `.lisa/controls/carriers.json` | `lisa controls install-carriers` | The list of files Lisa placed. Committed, so a later run knows what it may replace. |
| `.lisa/controls/merge-protection-change.md` | `lisa controls protect` | The handover for an administrator. Removed once nothing is left to hand over. |
| `.lisa/controls/evidence.json` | `lisa controls attest` | Generated. Never edited. |
| `.lisa/controls/verdict.json` | `lisa controls attest` | Generated. Never edited. Carries a digest of the register and the evidence. |

**Secrets.** These files name a secret and never hold its value. Text a person or an agent wrote is refused when it holds something shaped like a credential. Text captured from a tool has the value replaced by a placeholder before the file is written.

## The words

| Word | Means |
| --- | --- |
| Part | One piece of the repository, named by its folder (`api`, `web`). `.` is the whole repository. |
| Check | A command that measures one rule. In `.lisa.config.json` it is a **gate**, and a gate may have one command per part. |
| Moment | When a check runs: after a coding agent writes a file, at commit, at push, on a pull request, around a deployment, or on a schedule. |
| Enforcement point | One moment at one place: the coding agent, the local checkout, the hosting platform, a deployment pipeline, a scheduled run. |
| Carrier | What starts the checks at an enforcement point: a git hook or a coding agent's own hook. |
| Authoritative / advisory | Authoritative: required somewhere the author of a change does not control. Advisory: anything the author could skip. |
| Paired proof | The two test changes a check is proved with: one that breaks its rule and one that does not. |
| Failure text | What a check prints when its rule is broken. A refusal only counts when this text is in the output. |
| Rung | What a "met" rests on. `exercised`: a bad change was really tried and stopped. `observed`: a document or a platform setting was looked at; nothing was tried. `asserted`: a person's recorded answer. |
| Canary | A branch and a draft pull request made only to be read and removed. |

## The commands underneath

The four commands are skills. The deterministic work is behind `lisa controls`, and each subcommand's `--help` says what it writes and what its exit codes mean.

| Command | Used by | What it does |
| --- | --- | --- |
| `lisa controls catalogue` | Audit, configure | Prints the 77 requirements with their plain questions. |
| `lisa controls report-check` | Audit | Checks the audit report and renders `report.md`. `lisa controls report-check --absorb` takes in typed answers. |
| `lisa controls merge-protection` | Audit | Reads the hosting platform's merge protection. Writes nothing. |
| `lisa controls seed` | Configure | Says which road the repository takes and, on the paved road, declares the shipped checks. A `package.json` that is there and cannot be read is refused: the repository is never taken to have no tasks on a guess. |
| `lisa controls propose-threshold` | Configure | Turns a value measured today into the threshold to propose. Writes nothing. |
| `lisa controls declaration-check` | Configure, enforce | Checks that the audit report supports every declared part. Writes nothing. |
| `lisa controls proof-check` | Configure | Says whether each check's two test changes are ready for attest. Writes nothing. |
| `lisa controls register` | Configure, enforce | Writes the control register. `lisa controls register --check` writes nothing and fails when the committed file differs. |
| `lisa controls gaps` | Enforce | Lists the requirements the audit reports as missing, each with the marker its ticket carries. |
| `lisa controls install-carriers` | Enforce | Installs the commit and push carriers. `lisa controls install-carriers --agents` adds the coding agents. `lisa controls install-carriers --check` writes nothing. |
| `lisa controls protect` | Enforce | Compares merge protection with the register and writes the handover. Changes the setting only with `lisa controls protect --apply`. |
| `lisa controls enforce-report` | Enforce | One outcome per requirement, and the required checks that fail today. Writes nothing. |
| `lisa controls attest` | Attest | Runs the paired proofs and writes evidence, register and verdict. |
| `lisa controls reconcile` | Attest | Compares the register with what is installed in this checkout. Writes nothing. |

## What the verdict means, and what it does not

- **It is Level 1 only.** Level 1 asks that the controls are designed and in place. Levels 2 and 3 of the specification, including continuous attestation, are not measured.
- **Unknown is never a pass.** The result is `conforming` only when every requirement is `conforming`, or `not-applicable` with a recorded fact. One unknown prevents it, and `prevented_by` names every requirement in the way.
- **It says what each answer rests on.** Every requirement that is met carries its rung. Fewer than a third of the requirements need a check. Most need a record that must exist, and the rest need a person's word.
  - A requirement that needs a check is met only through a declared check. For most of them that means a paired proof that held. A few also accept a platform setting that was read.
  - A requirement that needs a record is met when the audit pointed at it and attest found every line it pointed at. A few ask for more and are met only by a paired proof.
  - A requirement only a person can vouch for is met when the audit found it written down and that person's answer is on record.
  - An agent's say-so alone never meets any of them: code runs the proof, finds the line, or checks the answer. For an answer, what code checks is that the record and the answer line in `.lisa/audit/report.md` (or `wiki/gaps.md`) hold the same words at the moment it looks. It does not check who typed that line. The skills tell the agent never to type on an answer line, and no command can tell a line an agent typed from one a person typed.
- **It rests on judgement in two places.** For a located record, code confirmed the file and line exist. That the file is the right record, and says what it should, is the judgement of the agent that ran the audit. A person's answer is as good as the person who gave it.
- **It goes out of date.** Every evidence record is current for 30 days. After that its requirement reads unknown, and `current_until` in the verdict says when that first happens. Running attest again renews it.
- **It is a local, unsigned check.** `lisa controls attest --check` shows that the verdict, the register and the evidence agree with each other, with the declaration and with the clock, and that the files defining the checks hold what they held where the proofs ran. It does not see a change to a checked tool's own configuration, such as a rule switched off in a linter's settings or a script changed in `package.json`: there is no list of such files, so none is in the fingerprint. Running attest again does see it. It cannot show that the evidence is what a run really produced: someone who rewrites all three files together, consistently, leaves three files that agree. Version history, running the proofs again, or a signature made somewhere the author cannot reach can tell the difference. This release makes no signature.
- **An exit code is not the verdict.** `lisa controls attest` exits 0 when every declared check passed its proof. That can be true with Level 1 far from met, because most requirements are not checks at all.

## Requirements

- **Node.js.** The Lisa package declares Node 24.21.0 (`engines` in `package.json`), the version it is built and tested on. The program that runs the checks is a Node program, so every carrier needs a `node` program on the PATH, including in a repository with no JavaScript in it. Without one the carrier stops the commit, the push or the write with a sentence that names Node. It never passes having checked nothing.
- **git.** The proofs are real commits and pushes in a clone.
- **macOS, Linux, or Windows with WSL.** The carriers are POSIX shell scripts. Windows without WSL is not supported. Nothing in the commands checks the operating system, so they will not refuse to start there; they are simply not built or tested for it.
- **For anything on the hosting platform:** a repository on GitHub and the GitHub CLI (`gh`), signed in. Reading merge protection needs an account that can read the repository's rulesets, opening canary pull requests needs permission to push, and changing merge protection needs administrator access. Each is learned by reading, never from a write that failed.

## Limits

Each of these is something an operator will meet. They are stated here so that a result is not read as more than it is.

**Proofs run on a clone of the last commit.** Nothing git ignores is in that clone: no installed dependencies, no built output. A check that only runs with those cannot run there yet. `lisa controls proof-check` reports such a check as not ready, and attest reports its halves as unknown. Uncommitted work is not part of a proof either, and attest says so when the working copy has any.

**Supported project types have no paired proofs yet.** On the paved road this release writes no test changes for the checks Lisa ships. Those checks read unproved, and the requirements they serve read unknown, until a proof is declared for them.

**A hook manager that is switched on per checkout is not switched on in the clone.** Where the repository's hooks belong to a manager such as Husky, the fresh clone attest makes has not run that manager's own install step, so git runs no carrier there and the check's proof reads unknown. Attest never falls back to running the check's command on its own, because that would be a different proof under the same name.

**Pull-request checks can be exercised only on GitHub.** It is opt-in, uses real draft pull requests that are never merged, needs permission to push, and people who watch the repository may be notified. A repository GitHub does not offer draft pull requests for cannot be exercised at all: an ordinary pull request could be merged, so none is opened. Only a check that runs on pull requests and not at commit or push, and that the platform already requires, gets canaries. Without the opt-in the setting is only read, and a setting that was read is never counted as a proof.

**On another hosting platform, the pipeline file is yours.** Lisa ships the pull-request pipeline for GitHub only, as part of its supported project types. Elsewhere the operator's agent writes the file to a stated contract, and every check it runs stays marked unproved in the register. Nothing in this release can exercise a check there, so that mark does not clear.

**GitHub repositories can supply their own pull-request workflow.** When Lisa's shipped workflow already runs the checks, enforce leaves it in place. A repository without that workflow can declare its own executor and report one check per gate. The gate's job runs its declared folder checks together. The register keeps the entries `unproved` until attest records both proof halves. Merge protection waits for the required check names to be reported.

**Merge protection is changed only when asked, and only with permission.** `lisa controls protect` reads and writes a handover for an administrator. It changes a setting only with `--apply`, only on GitHub, and only after a read confirms the signed-in account administers the repository. The enforce step never adds `--apply` on its own.

**Only rulesets are read.** A check required through a classic branch protection rule is enforced by the platform, and `lisa controls protect` still reports it as not required; the handover asks for a ruleset and says why. `lisa controls reconcile --platform` does not call such a check missing: where no ruleset governs the branch it reports the point as not read. It does not pass either. A repository with no merge protection at all looks the same from there, so the run is incomplete and exits 2, and says that only rulesets are read and none governs the branch.

**Edit-time enforcement differs by coding agent.**

| Coding agent | What happens when a check fails after a write |
| --- | --- |
| Claude Code | The agent is refused. Documented behaviour. |
| Codex | The agent is refused, but the hook runs only for a person who has approved the repository's hooks once, with `/hooks` inside Codex. |
| Cursor | The write is not failed. The agent is told afterwards. |
| OpenCode | The agent is refused. Measured. |
| Copilot | The hook is installed. That it stops the agent is assumed, not measured. |
| Devin | The hook is installed. That it stops the agent is assumed, not measured. |
| Antigravity | Nothing can refuse a write there, so nothing is installed. The register records the agent as one the check cannot be enforced on. |

In every case the write has already happened: a refusal tells the agent the file does not pass. On a supported project type Lisa's plugin hooks already run these checks, so the edit-time carrier is for the discovery road.

**Hook wiring is per checkout.** Where Lisa sets git's `core.hooksPath`, that setting lives in one checkout and is not copied into a clone. In each new checkout, run `lisa controls install-carriers` once. `lisa controls install-carriers --check` says whether a checkout is wired, and `lisa controls reconcile` reports a checkout where it is not.

**Reconcile checks recorded edit-time hooks.** It checks each installed coding agent's local registration and names an agent whose edit-time hook no longer starts Lisa's carrier. It also reports undeclared shell commands in `.lisa/hooks/post-tool` and in the recorded agents' shell hook settings. If the carrier record predates the agent list, repeat `lisa controls install-carriers --agents` with the original roster. OpenCode's JavaScript registration is compared with the installed Lisa version. A wiring result covers files in the checkout. It cannot establish that an agent has approved or loaded its hooks.

**Reconcile reads hooks and pipelines as text.** With `--platform` it also checks what GitHub requires. Deployment and scheduled points remain `not-verifiable`. The hook reader can find commands inside another command, such as `OUT=$(npx eslint .)`. It reports a call to a script without opening that script. A hook too large to read makes the run incomplete.

**A terminal is not filtered for secrets.** The files attest writes have credential-shaped values taken out. The table and the JSON it prints to the terminal show a check's output as it was captured.

**Tickets need a tracker.** With no tracker configured, enforce files nothing, and each missing requirement is reported as blocked until one is set up.

**Windows without WSL is not supported.**

## Keeping it current

- Run attest again before `current_until`. Evidence lasts 30 days, so a run a little more often than that keeps a verdict standing.
- After a new clone, run `lisa controls install-carriers` once in it.
- After changing the `gates` block, run `lisa controls register`, and attest again.
- To check someone else's verdict, run `lisa controls attest --check` in a checkout that holds it. Any checkout will do, a shallow clone included: the check reads the files and no history.
- An evidence file written by an earlier Lisa has no fingerprint of what defines the checks. `lisa controls attest --check` says so and does not pass. Run attest again to write it anew.

## Where the detail lives

- The skills: `plugins/src/base/skills/lisa-audit/`, `lisa-configure/`, `lisa-enforce/` and `lisa-attest/`, each with a command file under `plugins/src/base/commands/`.
- The code: `src/controls/`, wired in `src/cli/controls-cmd.ts`.
- The requirements: [`spec/tasc-criteria.json`](../../../spec/tasc-criteria.json) and its schema, and the operator questionnaire generated from it, [`docs/agentic-readiness-questionnaire.md`](../../../docs/agentic-readiness-questionnaire.md).
- The published formats: `schemas/control-register.schema.json`, `schemas/control-evidence.schema.json` and `schemas/control-verdict.schema.json`.
- The design notes:
  - [Gates and policy](../../../docs/design/gates-and-policy.md): parts, the register, carriers, required checks.
  - [The paired proof](../../../docs/design/paired-proof.md): what counts as a rejection, the disposable copy, canaries.
  - [Before enforce](../../../docs/design/before-enforce.md): the diagnosis run.
  - [Evidence and verdict](../../../docs/design/evidence-and-verdict.md): the records, the rungs, the digest, the check.
  - [Reconciling the register](../../../docs/design/control-reconcile.md).
  - [The enforce report](../../../docs/design/control-enforce.md).
  - [Secret values](../../../docs/design/secret-values.md).
