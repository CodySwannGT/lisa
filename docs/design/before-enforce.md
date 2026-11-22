# Before enforce: a tool is present, and a bad change still goes through

`lisa controls attest --before-enforce` answers one question about a
repository in which nothing has been installed yet: which checks exist and
are not enforced? On an existing codebase that is the finding that matters
most. A linter is configured, everybody believes it protects the main branch,
and a change that breaks its rule is committed and pushed without anything
running it.

It is a mode of `attest` because it uses the same register, the same proof
patches and the same disposable copy. It is not a proof, and nothing about it
can be read as one. This note says how the two differ and why.

The paired proof itself is in [the paired proof](paired-proof.md); what a
plain run writes down is in [evidence and verdict](evidence-and-verdict.md).

## What a plain run proves, and why that is not this question

A plain `lisa controls attest` builds a disposable copy of the last commit
and **installs Lisa's commit and push carriers in it**. Then it plants each
entry's violating change and makes a real commit or push. So a plain run
proves the chain Lisa installs: hook, carrier, gate runner, check. It says
nothing about what the repository does today, before that chain exists.

A before-enforce run builds the same copy without installing Lisa carriers.

## What the copy is

The copy is built by the same code (`src/controls/proof-copy.ts`), asked for
with `carriers: "none"`:

- a bare clone that stands in for the remote, so a push never leaves the
  machine;
- a clone of the last commit, on the operator's branch;
- the files that describe the checks, taken from the working copy by explicit
  path, exactly as in a plain run: `.lisa.config.json`, the carrier record
  and what it lists, and `.lisa/controls/proofs/`;
- any setup declared in the committed
  [proof-copy preparation](paired-proof.md#preparing-the-disposable-copy).
  The command uses the hooks the preparation installs.

With no preparation, the clone has no new wiring. Git copies commits into a clone and
nothing else: not `core.hooksPath`, which is a setting of one checkout; not
the files under `.git/hooks`; and nothing a hook manager wrote when somebody
ran an install step. The copy's git also reads none of the machine's own
settings, so a hook folder set for the whole machine does not count either.

This is not a weakness of the test. It is the finding. Every new checkout of
the repository starts in the same state, and stays in it until somebody sets
hooks up there. The result says so in plain words, and its `copy` section
reports what was measured in the clone (`hooks_path`, `hooks`) and not what
is usually true.

A hook that is switched on only in the operator's own checkout is a
different fact about a different place. `lisa controls reconcile` reads it.

## What is done with each entry

Which entries can be exercised is decided by reading, before any clone is
made, by the same plan a paired proof uses (`src/controls/proof-plan.ts`): a
commit or push enforcement point, a command that measures the entry, and
both proof patches. One more is left out: an entry declared `optional` at its
moment, which never refuses anything. When nothing can be exercised, no clone
is made.

For each entry that can be exercised, two things are done with its violating
change, one after the other, with the clone put back to its starting commit
in between:

1. **The canary.** The change is staged and really committed, or committed
   and really pushed to the stand-in remote. Git's exit status and what git
   did have to agree: exit 0 with the commit created, or the remote branch
   moved; non-zero with neither. Where they disagree there is no answer.
2. **The tool.** When the canary went through, the entry's own command is
   started on the same change, in the entry's own folder, the way its gate
   would start it. This is what makes "the tool is present" something that
   was measured. A tool that cannot be started on this machine is not shown
   to be present.

A proof patch has to change a file inside the entry's own folder. Once the
carriers are installed, a check is only started when the change touches its
folder, so a patch that edits a file elsewhere never starts it.

## The words

A before-enforce run has its own result words, and none of them is a proof's
(`src/controls/before-enforce-types.ts`):

| result | means |
| --- | --- |
| `not-enforced` | The violating change went through, and the entry's own command ran on it. The tool exists and nothing makes it run. |
| `enforced` | Something in the fresh clone refused the violating change. |
| `not-exercised` | Nothing was tried. The reason says why: no proof patches yet, checked only on pull requests, declared optional, outside effects not agreed to. |
| `unknown` | It was tried and gave no answer that can be relied on: the patch did not apply, git's exit status and what git did disagree, or the change went through and the tool's command could not be run to an end. |

The meanings run the other way from a proof's. In a proof, a violating change
that is accepted is a control that failed. Here it is the expected finding: a
check that exists and is not enforced. That is why the result carries no
`passed`, no `outcome` on an entry and no `halves`, and calls itself
`"mode": "before-enforce"`.

`enforced` says the violating change was refused. Whether a clean change
still gets through is the paired proof's question, after the enforce step.

## What is written

Nothing. No evidence record, no register, no verdict. A before-enforce run
is a diagnosis made before anything is installed, so:

- it cannot be mistaken for a Level 1 result, because there is no verdict;
- it cannot set or clear an entry's `unproved` mark, because that mark is
  derived from the evidence file, which it does not touch;
- it sends nothing anywhere: the hosting platform is not read and no pull
  request is opened.

It prints a table, or with `--json` one document. Its excerpts of command
output go through the same function a plain run uses to make output ready to
be kept (`prepareEvidenceExcerpt`), so whatever is done there to output is
done here too.

## How the findings reach the audit report

The audit report holds exactly one finding per requirement per place, and
all of it is checked by `lisa controls report-check`. `lisa controls
reconcile` met the same question and this run answers it the same way: the
command does not rewrite the report. It prints `audit_findings`, each already
in the report's shape, in state `exists-not-enforced`, placed where the
report places that requirement (at `.` for a requirement answered once, at
the entry's folder for one answered per part).

The attest skill puts them in: it replaces the report's finding at the same
`criterion` and `scope`, keeps any mechanism the replaced finding listed that
the offered one does not, and runs `report-check`.

The accepted canary is the evidence, in two places. The finding's `what`
quotes it in plain words: the git command, its exit status, and that the
change went through. The full record (command, exit status, times, output)
is the entry's `canary` in the printed document.

Each offered mechanism points at the gate in `.lisa.config.json`, where the
check and its command are written down, and at every place the entry itself
cites. The entry's own pointers are kept on purpose: `lisa controls
declaration-check` holds each part's evidence against the report, and a
finding that dropped them would make a supported declaration look
unsupported.

## Exit codes

| code | means |
| --- | --- |
| 0 | There is a result and every entry was answered. A finding is something to look at, not a failure. |
| 1 | There is a result, complete for everything else, and at least one entry is `unknown`. |
| 2 | There is no result: the path is not a folder, the gates declaration was refused, the fresh clone could not be made, the run could not finish, or the option was combined with `--check`, `--workspace` or `--pull-request-canaries`. |
