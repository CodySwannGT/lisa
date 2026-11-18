# The enforce report: one outcome per requirement

The enforce step makes a control register real. It runs three things in
order: it installs the carriers that run the declared checks, it files one
ticket for each requirement the repository has nothing for, and it compares
the hosting platform's merge protection with the register. Then it says
where every Level 1 requirement stands, and that statement is made by code:

```
lisa controls enforce-report [path] --carriers <file> --tickets <file> --protect <file>
```

It builds on [gates and policy](gates-and-policy.md) for the register, the
carriers and the required checks, and it is the step before the
[paired proof](paired-proof.md).

## How the three results reach the report

`lisa controls install-carriers` and `lisa controls protect` print one JSON
document each and keep nothing, and the ticket flow is carried out by an
agent. The skill saves each result in a file, in a folder it makes in the
system's temporary folder, outside the repository, and names the three files
to the report command. The skill removes the folder at the end.

| Option | What the file holds | Written by |
| --- | --- | --- |
| `--carriers` | The result of installing the carriers | `lisa controls install-carriers` (stdout) |
| `--tickets` | `{ "schema_version": 1, "results": [...] }`, one result per missing requirement | The agent, from what the missing-capability ticket flow returned |
| `--protect` | The comparison of merge protection with the register | `lisa controls protect` (stdout) |

All three are required. Before anything is derived the command refuses, with
one line per problem and nothing on stdout:

- a file that is absent, empty (the command behind it failed), not JSON, or
  of the wrong shape;
- a carriers result that is what `lisa controls install-carriers --check`
  printed. A check installs nothing and lists what it would write, so read as
  a result it would report carriers that are not there and changes nobody
  made. The refusal names the file to pass instead;
- a checkout whose carriers cannot be read (see "The carriers result is not
  believed on its own");
- an audit report `report-check` would refuse;
- a committed register that is not what the declaration generates;
- a merge-protection result that does not list exactly the entries this
  register asks the hosting platform to require, which is how a result saved
  before the declaration changed is caught;
- ticket results that answer for a requirement `lisa controls gaps` does not
  list, under a key it did not give, twice, or not at all where a tracker is
  configured; and a claimed ticket where no tracker is configured.

## The carriers result is not believed on its own

The carriers result is a file saved at one moment. It can be from an earlier
run, and a hook can have been removed since. So the report reads the
checkout's carriers again itself, with the read `lisa controls reconcile`
makes: the carrier check, which writes nothing, run for the coding agents
the saved result names (`src/controls/enforce-carriers.ts`).

| The saved result says | Reading the checkout shows | The point is | The reason says |
| --- | --- | --- | --- |
| in place | in place | `wired` | nothing more |
| in place | not in place | `blocked` | why it is not in place, and that the saved result said otherwise |
| blocked, or nothing | in place | `wired` | that the saved result said otherwise |

The read of the checkout always wins. The saved result is still where the
run's `changes` come from. The `limits` about carriers (the per-checkout git
setting, an agent that is only told of a failure, an agent whose refusal is
assumed, an agent that cannot refuse) are taken from the carriers the
checkout holds, not from the saved result.

## The outcomes

| Outcome | It means |
| --- | --- |
| `wired` | A declared check serves the requirement, and every place the enforce step is answerable for now runs it. |
| `ticketed` | The repository has nothing for the requirement, and a ticket for that work exists. |
| `blocked` | Somebody has to act first. The reason says who and what for. |
| `nothing-to-enforce` | Nothing to install, file or wait for: the requirement does not apply here, it is met by a written record or a person's word, or what checks it is something Lisa itself ships and a Lisa project type runs, which this step neither installs nor looks at. |

The product requirement names the first three. The fourth exists because
the three cannot be said truthfully of a requirement that needs nothing from
this step. Most Level 1 requirements are met by a record or by a person's
word, not by a check. Calling a written policy `wired` would claim a check
runs; calling it `blocked` would tell the operator to act where there is
nothing to do. `lisa controls protect` met the same case and answered it the
same way, with `nothing-to-require`. Every requirement still gets exactly one
outcome, and the command fails when one has none or two.

## How one outcome is derived

A requirement is spoken for by two kinds of source, and each makes a claim.

**The audit's finding for it, in each part of the repository:**

| The audit found | And | The claim |
| --- | --- | --- |
| `missing` | the ticket flow found or filed a ticket | `ticketed`, with the ticket |
| `missing` | no ticket could be filed, or no tracker is configured | `blocked`, with why, pointing at the open tracker question |
| `question` | | `blocked`: waiting on the operator's answer to that question |
| `unknown` | | `blocked`: waiting on the access the audit named |
| `not-applicable` | | `nothing-to-enforce` |
| `exists-not-enforced` or `proved` | the requirement is of kind `artifact` or `human-attested` | `nothing-to-enforce` |
| `exists-not-enforced` or `proved` | kind `gate`, and an entry that serves it and has a moment to run at covers that part | none: the entry speaks for it |
| `exists-not-enforced` or `proved` | kind `gate`, and the only entries that cover that part have no moment to run at | `blocked`: no check is declared to run there, naming those entries; the configure step has to choose when |
| `exists-not-enforced` or `proved` | kind `gate`, and no entry covers that part | `blocked`: waiting on the operator to declare it in the configure step |

An entry covers a finding's part when the finding is about the whole
repository, when the entry is, or when the entry's folder is that part or
inside it. An entry with no moment to run at covers nothing.

**Each register entry that serves it**, from its enforcement points:

| Where | Who answers | The point is |
| --- | --- | --- |
| The checkout, at commit and at push | A read of the checkout's carriers, made for this report | `wired` when the carrier is in place now; `blocked` when it is not, or when the read reports no carrier for the moment |
| The coding agent, after a file write | The same read, for the agents the saved carriers result names | `blocked` when any named agent's carrier is not in place, when no named agent can refuse a write, and for a declared command when no agent was named; otherwise `wired`, naming the agents that cannot refuse, the ones that are only told of a failed check afterwards (Cursor), and the ones whose refusal is assumed |
| The coding agent, at any other moment | Nobody | `not-checked` |
| The hosting platform, an entry merge protection is asked to require | The merge-protection result | `wired` or `blocked`, as it says |
| The hosting platform, a pipeline file the host wrote | The file itself | `blocked` when it is absent or does not start the gate runner; otherwise as merge protection says, noted as unproved |
| The hosting platform otherwise, a deployment pipeline, a scheduled run | Nobody | `not-checked` |

| The entry's points | The entry is |
| --- | --- |
| It has none: no moment was chosen, or every one is switched off | `nothing-to-enforce`, and it makes no claim about any requirement (see below) |
| Any point is `blocked` | `blocked` |
| Otherwise, at least one is `wired` | `wired` |
| None was checked, and at one of them the check is one Lisa itself ships: an interceptor, a built-in job, or a task under one of the gate registry's own ids | `nothing-to-enforce`: what Lisa ships runs it, and this step did not look |
| None was checked, none is one Lisa ships, and at one of them the check is a command the repository declares | `blocked`: nothing Lisa installs starts a command there |
| None was checked, the check is a task under a gate the repository invented (an `x-` gate), one another system reports, or nothing measures it, and it serves a requirement of kind `gate` | `blocked`: nothing Lisa ships runs it and this step cannot see that anything does; the configure step has to choose when it must pass |
| None was checked, the same kinds of check, and it serves no requirement of kind `gate` | `nothing-to-enforce` |

The rows about unchecked points go by the check at every point, not at the
first one: a gate can be measured differently at different moments.

**What counts as a check Lisa ships.** Any gate that names a task to run is
recorded as a task. So going by that alone, a repository on no Lisa project
type that declares its own lint script under `x-lint-check`, optional on a
proposed change, was told that a Lisa project type runs it, while nothing
did; the same check written as a command was `blocked`. A task counts as
shipped only under one of the registry's own gate ids, which is what a Lisa
project type brings pipelines for. The registry decides what an `x-` gate is
(`CUSTOM_PREFIX`), and a suite holds this code to it.

**An entry with no moment makes no claim.** A requirement of kind `gate` is
met only by a check that can refuse a change, and an entry nothing runs is
not one. It is left out of the claims altogether:

| The requirement is served by | Its outcome comes from |
| --- | --- |
| Such an entry and another entry with a moment | The other entry, and the findings |
| Only such entries, and the audit found a check in place | The finding: `blocked`, saying no check is declared to run and that the configure step chooses when |
| Only such entries, and the audit found anything else | The finding alone: a requirement that does not apply stays `nothing-to-enforce`, a missing capability keeps its ticket |
| Only such entries, and the audit says nothing of it | The entries, so that it still has an outcome: `blocked` for a `gate` requirement, else `nothing-to-enforce` |

Two wrong outcomes are closed by that. Counted as an answer, the entry made
the requirement `nothing-to-enforce` while nothing ran. Counted as
`blocked`, it held back a requirement another check serves: Lisa's own
declaration switches `test-node-suites` off at every moment and runs the
same requirement through `test-correctness` at push and on a proposed
change, and that requirement read "run the configure step and choose when
this check has to pass" although its check was wired.

**From many claims to one outcome.** The strongest claim wins: `blocked`,
then `ticketed`, then `wired`, then `nothing-to-enforce`. So a requirement is
`wired` only when nothing about it still waits on a person or a ticket, and
`wired` always rests on a result a step reported, never on silence.

## Enforce adds no check

The enforce step wires what the configure step declared, and declares
nothing. A check nobody declared is reported as not wired and sent back to
the audit and configure steps, where it is declared with what supports it
like any other. That holds for a check Lisa ships a program for, such as the
one that refuses a lowered threshold: when thresholds are declared and that
check is not, the report says so in `limits`, and the requirement it serves
is `ticketed` or `blocked` from the audit's finding.

## Why the outcomes are printed and not kept in a file

An outcome depends on things outside the repository at one moment: what the
tracker holds, what the hosting platform requires, and whether git in this
one checkout is set to run hooks. A committed file would repeat `wired` in a
clone where nothing is wired, and it would be one more thing a second run
could change. So the document is the answer to one run, as the
merge-protection result is.

That is also what makes a second run a run that writes nothing. Each step
says what it wrote, the report gathers those statements in `changes`, and a
run that found everything in place gathers none.

## The checks that fail on the default branch today

Making a check required does not make the code pass it. Each register entry
that is `required` at some moment and measured by a command the repository
declares is run once, on every run, against the head of the default branch,
and the ones that do not pass are listed with the end of what they printed.

- **Which commit.** The branch the hosting platform named when the
  merge-protection step read it; else the branch `origin/HEAD` points at;
  else `main` or `master`; else the branch checked out. The commit is
  `origin/<branch>` as the checkout last saw it, or the local branch when
  there is no such copy. Nothing is fetched. The report says which was used.
- **Where.** A clone in a temporary folder that belongs to the run, checked
  out at that commit with no branch, built with the isolated git the proof
  copy uses, cut off from the repository it came from, and removed on every
  way out, a signal included. The operator's working copy is never where a
  check runs, so unfinished work is never mistaken for the default branch.
- **How.** The command is started directly, in the entry's folder, by the
  gate runner's own function, and its answer is judged by the gate runner's
  own function. No commit or push is made in the copy, so a part is never
  left out because a change did not touch its folder.
- **What counts.** A command that ran to an end and that the runner does not
  judge as passing is listed, because that is exactly when the gate stops a
  change. `judged` says whether the runner read a broken rule (`failed`) or
  could not tell a broken rule from a broken command (`unproved`). A check
  is `unproved` whenever it ends with an error and nothing in its output is
  a failure the runner knows or the entry declares: an entry with no
  `failure_shape`, or with one that names a different rule than the one the
  branch breaks, lands there when the code really does fail it, and so does
  a command that could not run for want of the project's dependencies. The
  report cannot say which, so the skill does not either: it has the agent
  say that Lisa could not tell, quote `output_excerpt`, and say that the
  next commit or push is stopped if the failure is real. It never tells the
  operator that the code fails the check, and never that it does not. A
  command that could not be started, ran out of time or was killed is
  listed as not measured, never as failing. A check that runs through the
  project's task runner is not run: a fresh copy holds no installed
  dependencies.
- **What is said when nothing gave an answer.** `checked` counts the checks
  that ran to an answer. The summary sentence says how many ran, how many of
  those do not pass and how many gave no answer, and stderr carries one line
  for each check that gave no answer, with why. When no check ran to an
  answer the summary says that nothing is known about whether they pass. It
  never reads "0 required checks do not pass", which is what a clean run
  would say.
- **What is kept.** The end of what the command printed, through
  `prepareEvidenceExcerpt`, with the copy's own path replaced by `<copy>`.
