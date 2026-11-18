# The paired proof

A control is a rule and a check that enforces it. The control register says a
control exists. It does not say the control works. The paired proof does: it
plants a change that breaks the rule and a change that does not, and records
what the check did with each.

```
lisa controls attest [path]                               # a table
lisa controls attest [path] --json                        # one JSON document
lisa controls attest [path] --workspace <folder> [--json] # in a copy you made
```

This is the only code allowed to say a control works. It asks no model
anything, so the same repository always gets the same results. It builds on
[gates and policy](gates-and-policy.md): the register it reads is described
under "The control register", and the check it starts is a part's command,
described under "How the runner runs a part".

## The words

One half of a proof shows one of three things.

| half | means |
| --- | --- |
| `rejected` | The check ran, said no, and said it in the failure text the entry declares. |
| `accepted` | The check ran and passed. |
| `unknown` | Anything else. A reason says which. |

An entry gets one of four results.

| result | means |
| --- | --- |
| `passed` | The violating change was rejected and the clean change accepted. |
| `failed` | The violating change was accepted, or the clean change rejected, or both. `failed_halves` names which. |
| `unproved` | No proof was run: a half is missing, or the entry is not enforced at commit or push. |
| `unknown` | A proof was called for and gave no answer that can be trusted. |

The two halves decide the result, and it passes in exactly one of nine
combinations:

| violating change \ clean change | `accepted` | `rejected` | `unknown` |
| --- | --- | --- | --- |
| `rejected` | **passed** | failed (clean) | unknown |
| `accepted` | failed (violation) | failed (violation, clean) | failed (violation) |
| `unknown` | unknown | failed (clean) | unknown |

A definite failure outranks a missing answer. A check that let the violating
change through has failed, whatever its clean half did.

## What counts as a rejection

A check that exits non-zero has not necessarily found the rule broken. A
missing configuration file, a crashed tool and a planted violation all end in
a non-zero exit, and only one of them says the control works. So a half is
`rejected` only when both of these hold:

1. The gate runner itself reads the answer as a measured failure. The proof
   does not have its own reading: it calls `judgePart` in
   `lisa-run-gates.mjs`, the judgement every gate gets. Exit 0 from a run that
   says it ran no tests is not a pass, and a command that was killed is not a
   failure.
2. The output carries the entry's `proof.failure_shape`, matched by the
   runner's own `declaredFailure`.

Every other non-zero exit is `unknown`, with the reason `wrong-reason`.

**An entry with no `failure_shape` can never show a rejection.** There is
nothing to tell its planted violation from a broken tool, so a non-zero exit
is `unknown` with the reason `no-failure-shape`, and the entry cannot pass.
Its halves are still run, because a violating change that is let through is a
failure whatever the entry declares.

The reasons a half is `unknown`:

| reason | what happened |
| --- | --- |
| `patch-not-applied` | The change could not be put in place, so no check was run. Git's reason is quoted. |
| `not-started` | The check could not be started: the program is not installed, or the folder is not there. |
| `timed-out` | The check was still running at the proof's time limit and was stopped. |
| `killed` | The check was stopped before it answered. |
| `nothing-measured` | The check answered, and the gate runner does not believe the answer measured anything. |
| `wrong-reason` | The check said no without the declared failure text. |
| `no-failure-shape` | The check said no and the entry declares no failure text. |
| `workspace-not-restored` | An earlier change could not be taken back out, so this half was not run. |

## What is settled before anything is changed

Each question is asked in this order, and the first that settles the entry's
result is the one reported. No file is touched for an entry settled here.

| question | if not | reason |
| --- | --- | --- |
| Is the entry enforced at commit or push? | `unproved` | `pull-request-moment` when it is enforced on pull requests, else `no-proof-moment` |
| Does the declaration name both halves? | `unproved` | `half-missing` |
| Is what measures it a command? | `unknown` | `mechanism-not-a-command` |
| Does the proof stay inside the repository, or has reaching outside been agreed to? | `unknown` | `external-effects`, quoting `proof.external_effects` |
| Are both patch files there? | `unproved` when one is missing; otherwise `unknown` when one is there and is a link | `half-missing`, `patch-unreadable` |

A proof stands for one moment: the entry's first enforcement point at commit
or push. An entry enforced only on pull requests is never reported as
passing here. Whether a pull request is stopped is decided by the hosting
platform, and that is a later step's work.

## Where the changes are planted

A proof changes files, and it must never change the operator's own. The
runner therefore touches no folder itself. It is handed a workspace:

```ts
interface ProofWorkspace {
  readonly root: string;
  apply(patch: string): PatchOutcome | Promise<PatchOutcome>;
  trigger(request: ProofTrigger): ProofAnswer | Promise<ProofAnswer>;
  restore(patch: string): PatchOutcome | Promise<PatchOutcome>;
}
```

The runner calls `apply`, `trigger` and `restore` once per half, in that
order, never two at a time. The change is taken back out before the answer is
read. If it cannot be taken back out, every later half is reported
`workspace-not-restored` without being run: a check run on files nobody can
vouch for proves nothing.

There are two workspaces. Which one a run gets depends only on whether
`--workspace` was given.

### The disposable copy (no `--workspace`)

The command makes its own copy of the repository, proves each check through
a real commit or a real push in it, and removes it.

**What the copy is.** A clone of the last commit, in a temporary folder that
belongs to this run alone (`lisa-attest-<random>` in the machine's temporary
folder). The control being proved is "a change that breaks the rule is
rejected at commit, or at push", and a hook judges a change against committed
content, so the last commit is the base. Work that is not committed is not
part of what a proof says, and the command says so on standard error when the
working copy has any.

It is a clone and never a linked working copy of the repository: a linked
working copy shares refs, settings and the stash with the repository it came
from, and those are exactly what must not be touched. The folder holds a bare
repository that stands in for the remote (`remote.git`) and the working copy
the changes are planted in (`clone`), on the operator's branch.

**What it takes from the working copy.** A repository that is still being set
up has the files the proof is about uncommitted. Exactly these are made the
same in the copy as in the working copy, each by its own path:

- `.lisa.config.json`;
- `.lisa/controls/carriers.json` and every file it lists (the gate runner
  under `scripts/` and Lisa's hook scripts);
- every ordinary file under `.lisa/controls/proofs/`.

Nothing else is copied, and nothing is read or written through a link. A path
in the record that is not a plain path inside the repository stops the run.

**What it inherits.** Nothing from the machine and nothing from the
operator's own git settings. Its only remote is the stand-in, so a push
cannot leave the machine. It has no credential helper and no signing, and its
hooks folder is set only by installing the carriers there with the installer
`lisa controls install-carriers` uses. Making it only reads the operator's
repository.

**How a half is triggered.** The planted change is staged. At `commit` the
command runs `git commit`. At `push` it commits with no hook, because that
commit is set-up, and runs `git push` to the stand-in remote. So what answers
is the installed chain: git's hook, the carrier, the gate runner, the check.
Afterwards the copy is reset to its starting commit, the stand-in remote
included.

**What counts as an answer.** A hook refuses for many reasons, and only one
of them is this check finding its rule broken. An answer is judged only when
three things agree:

| | a refusal | a change let through |
| --- | --- | --- |
| git's exit status | non-zero | zero |
| what git did | no new commit; the remote's branch has not moved | a new commit; the remote's branch is that commit |
| the gate runner's line for this check | `FAILED` | `PASSED` |

Where they disagree, or the gate runner printed no line for this check (Node
is missing, the carrier cannot find the runner, another check refused the
commit first), the half is `not-started` and its sentence says which. The
declared failure text is then matched as usual.

**What is not proved this way.** A moment at which git runs no carrier in the
copy is `not-started`, quoting what the carrier installer said. That includes
a repository whose hooks belong to a hook manager that has to be switched on
per checkout, such as Husky before its own install has run. A check declared
`optional` at its moment is `not-started` too: it reports and never refuses.
Neither case falls back to starting the check's command on its own, which
would be a different proof under the same name.

**When the copy is removed.** On every way out: when the run finishes, when
it cannot finish, when the copy cannot be built, and when the process is told
to stop (`SIGINT`, `SIGTERM`, `SIGHUP`). The signal handler is listening
before the folder is created and is taken off again when the run ends. A
signal that reaches only this process is acted on when the check that is
running returns, which is no later than that half's time limit; Ctrl-C at a
terminal reaches the check as well, so the folder goes at once. A process
killed outright (`SIGKILL`) cannot remove anything.

### A folder the operator names (`--workspace`)

This workspace works in a copy somebody else made. It plants a change with
`git apply`, starts the entry's own command in the entry's own folder, and
takes the change back out with the reverse of the same patch. It makes no
commit and needs no carrier, so it shows that the check works and says
nothing about whether anything runs it. The command refuses a folder that is
the repository, is a link to it, or holds it.

**A patch cannot write outside the workspace.** `git apply` refuses a path
that climbs out of the folder, a path into `.git`, and a path through a link,
including a link the same patch creates. It applies all of a patch or none of
it. The patch is handed over on standard input, the variables git exports to
its hooks are removed, git is told not to look above the folder for a
repository, and the machine's own git settings are left out.

## What is kept

Results are plain data, so a later step can write them down as evidence
without asking the runner anything.

Per entry: `entry_id`, `gate`, `scope`, `criteria`, `moment`, `outcome`,
`failed_halves`, `reason`, `detail`, `time_limit_seconds`, `halves`.

Per half that was run: `entry_id`, `half` (`violation` or `clean`), `moment`,
`patch`,
`command` (the argument list, or `null` when no check was started),
`exit_status`, `started_at`, `completed_at`, `output_excerpt`,
`output_truncated`, `matched_lines`, `outcome`, `reason`, `detail`.

The whole run: `schema_version`, `passed`, `counts`, `entries`. `passed` is
true only when there is at least one entry and every entry passed.

## Why two runs agree

- Entries are proved one at a time, in register order.
- The only clock read is the one handed in, twice per half.
- The workspace folder is replaced by `<workspace>` in every piece of kept
  text, because it differs from run to run. In the disposable copy the
  stand-in remote's path is replaced by `<proof-remote>` for the same reason.
- Nothing in the runner, or in the gate runner it calls, imports a model
  client or anything that opens a connection.

Two runs therefore differ only in `started_at` and `completed_at`, as long as
the checks themselves print the same thing twice.

In the disposable copy the kept output is the hook's, so it also holds what
the gate runner prints around the check: a note about earlier runs on the
machine, the machine's load, and at push the name of a timing file. Those
lines differ from run to run. The outcomes, the reasons, the exit statuses
and the commands do not.

## Time limits

One half may run for `proof.timeout_seconds`. With none declared it gets
thirty minutes, the time the same command has when the gate runs it, and a
declared limit above thirty minutes is held to thirty. A half still running
at its limit is stopped with its whole process tree and reported
`timed-out`.

## Exit codes

| code | means |
| --- | --- |
| 0 | There is at least one entry and every entry passed. |
| 1 | The proofs ran and some entry did not pass, or the register has no entries. |
| 2 | There are no results: the path is not a folder, the gates declaration was refused, the disposable copy could not be made or the folder named was refused, or the run could not finish. |

The command writes no file in the repository. A run stopped by a signal ends
by that signal, as any interrupted process does, after removing its copy.
