# The paired proof

A control is a rule and a check that enforces it. The control register says a
control exists. It does not say the control works. The paired proof does: it
plants a change that breaks the rule and a change that does not, and records
what the check did with each.

```
lisa controls attest [path]                               # a table
lisa controls attest [path] --json                        # one JSON document
lisa controls attest [path] --workspace <folder> [--json] # report only, in a copy you made
lisa controls attest ... --pull-request-canaries          # exercise pull-request controls
lisa controls attest ... --acknowledge-external-effects   # run proofs that reach outside
```

This is the only code allowed to say a control works. It asks no model
anything, so the same repository always gets the same results. It builds on
[gates and policy](gates-and-policy.md): the register it reads is described
under "The control register", and the check it starts is a part's command,
described under "How the runner runs a part".

One more mode of the command is not a proof and is described in its own note.
`lisa controls attest --before-enforce` uses the same register, patches and
disposable copy, installs nothing in the copy, and reports each check that
exists and that nothing enforces yet. It writes no evidence and no verdict.
See [before enforce](before-enforce.md).

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

One more question is asked of an entry that gets this far, after its changes
have been planted and before any check is started: does either change edit
what the check is, or put a file where git will not look? If so the entry is
`unknown` (`declaration-changed` or `ignored-path`). See "A proof never
changes what the check is" below.

A proof stands for one moment: the entry's first enforcement point at commit
or push. An entry enforced only on pull requests is not settled by the
runner. Whether a pull request is stopped is decided by the hosting platform,
and the next section says how that is asked.

A proof that declares `proof.external_effects` runs only when the operator
passes `--acknowledge-external-effects`. Without it the entry is `unknown`
and the declared effect is quoted, at commit, at push and for a canary alike.

## A proof never changes what the check is

A paired proof shows that a check turns away a change that breaks its rule.
It shows nothing when the "violating change" rewrites the check instead. A
patch that edits `.lisa.config.json` can swap a command that always passes
for one that always fails. The hook then refuses the commit, the declared
failure text is printed, the clean change goes through, and a check that
enforces nothing would read as proved.

So a pair is not run when either of its changes touches one of four things.
The entry is `unknown`, its sentence names the change and the file, and no
check is started for it.

| a change that | reason |
| --- | --- |
| edits a file that says what the checks are, or runs them | `declaration-changed` |
| edits the program the check's command starts | `declaration-changed` |
| edits the script or target the check's command runs through a package manager or task runner | `declaration-changed` |
| leaves a file at a path the repository ignores | `ignored-path` |

**The files that say what the checks are, or run them:**

- `.lisa.config.json`;
- `.lisa/controls/carriers.json` and every file it lists;
- anything under `.lisa/hooks/`;
- the gate runner and every file it loads, under `scripts/`.

**The program the command starts.** When the command names its program by a
path into the repository (`./scripts/lint.sh`, `bin/check`), that file is
the check.

**The script or target the command runs.** `npm run lint` runs whatever
`package.json` says `lint` is. A check declared that way, with a script that
lets everything through, was proved by a "violating change" that edited
`package.json` so the script printed the failure text and exited 1. So when
a command goes through one of the runners below, a change to the file that
says what it runs is a change to the check. These are the runners that are
recognised, and no others:

| the command starts | the file that says what runs | what counts as changing it |
| --- | --- | --- |
| `npm`, `pnpm`, `yarn`, `bun` (any subcommand), `node --run` | any `package.json` in the repository | its `scripts` differ, or the file is added or removed |
| `make`, `gmake` | `Makefile`, `makefile`, `GNUmakefile`, any `*.mk`, and the file named by `-f`, `--file` or `--makefile` | any change to the file |
| `just` | `justfile`, `.justfile` (in any letter case), any `*.just`, and the file named by `-f` or `--justfile` | any change to the file |

A runner is also recognised behind the three ways a command is commonly
wrapped: `env` with its options and `NAME=value` settings in front,
`corepack` in front, and a shell (`sh`, `bash`, `dash`, `zsh`, `ksh`, `ash`)
given its script with `-c`. Every word of a shell's script is looked at, so
a script that only mentions `make` is treated as running it. That errs
toward refusing a change, never toward letting one through.

Any `package.json` counts, not only the one nearest the check's folder: a
package manager can be pointed at another one by an option or a workspace
setting, and an argument list does not always say which. A change to
`package.json` that leaves its `scripts` as they were, such as a dependency
added to show a dependency check failing, is left alone.

This is decided by reading the argument list and, for a `package.json`, the
file before and after the change. Nothing is started.

**A path the repository ignores.** Git leaves an ignored file out of a
commit. A patch that drops a program at `node_modules/.bin/eslint`, or a
marker file under an ignored folder, changes what the check's command finds
on disk while the hook is shown a change that does not hold it, and no list
of changed files names it. So a change that leaves a file at an ignored path
is not a proof's change. Whether a path is ignored is asked once the change
is planted, so an ignore rule the same patch adds counts. A file that is
already tracked is not ignored, whatever an ignore file says, and a change
to it or its removal is one git shows.

**How the paths are found.** From the patch itself: git is asked to read
the patch, not to apply it, and to list every path it names, forwards and
backwards, so a renamed file is listed under both of its names and a
deleted one under the name it had. What git staged is not enough, because
git stages nothing at an ignored path, and that is the path the last rule
has to see. Both changes of a pair are looked at before either check is
started: each is planted in the disposable copy, held to the rule, and
taken back out.

**One file under two names.** The names a patch writes are not always the
names of the files it changes. On a file system that does not tell letter
cases apart, which is the default on macOS and Windows, git applies a patch
headed `.lisa.config.JSON` to `.lisa.config.json`. Held to the patch's
names alone, the first three rules found no file they knew, the "violating
change" swapped the check's command, and `attest` read a check that
enforces nothing as proved while `proof-check` said `not-ready`. So:

- The first three rules are held to the paths the patch names **and** to
  the paths git reports as changed once the patch is planted, which are the
  names the repository stores. A path the patch names that is one of those
  files is taken for it, so a dependency added through `Package.json` is
  still read as a change that leaves the scripts alone.
- A name the rule knows (a check file, the hooks folder, the command's
  program, `package.json` or a Makefile's name beside a changed file) is
  compared with a changed path by asking the file system whether the two
  are one file. That finds a new `src/Package.json` for a check run through
  npm in `src`, and a program the command names as `./Scripts/lint.sh` when
  the repository stores `scripts/lint.sh`. Letters are never folded by this
  code: two names are one file exactly when the file system says so, so
  nothing is refused on a file system that tells them apart.
- The ignored-path rule keeps to the paths the patch names. Git reports
  nothing at an ignored path.

What that does not see: a file the change removes, when the check's command
names it in another letter case than the repository stores. Nothing is left
on disk to compare with.

**A path under something that is no longer a folder.** A change can put a
file, or a link, where a folder was. Nothing is then at the paths that were
under it, whatever a link there leads to, and they are not asked about: the
file system fails for a path under a file, and git will not say whether a
path beyond a link is ignored. Either used to stop the whole run with exit
2. Such a pair is now held to the rule like any other.

This is one rule in one place (`src/controls/proof-change-rule.ts`, with the
runners in `src/controls/proof-task-runners.ts`), and
`lisa controls proof-check` holds a pair to the same one with the same
reasons.

**What it does not cover, and why:**

- **The checked tool's own configuration**: a linter's rule file, a test
  runner's settings. A change that edits one is, for all that can be read
  from an argument list, a change the tool is there to judge. A proof of a
  linter often has to plant exactly such a file's subject.
- **A file a script or a target goes on to start.** `"lint": "node
  tools/lint.js"` is covered as far as the script's own text, and
  `tools/lint.js` is not.
- **A file handed to an interpreter as an argument** (`node check.mjs`,
  `sh lint.sh`). An argument list does not say whether such a file is the
  program or the thing the program is asked to look at.
- **Any other task runner.**

A pair that gets past this rule by one of those routes still has to be
turned away by its check for the declared reason and let its clean change
through. What the rule closes is the cheap way to make a check that
enforces nothing read as proved; it is not a proof that no such way is
left.

## The pull-request moment

Nothing that runs in a checkout can say whether a pull request would be
stopped. The hosting platform says, and there are two ways to ask it. Each
result carries a `rung` that says which was used.

| rung | how the result was obtained | creates anything |
| --- | --- | --- |
| `observed` | The platform's merge-protection settings were read. | No |
| `exercised` | Two canary pull requests were opened, one per half, and the platform said whether each could be merged. | Yes, and removes it |

### By default: read the settings, create nothing

Without `--pull-request-canaries` the command sends reads only. It reads the
settings through the same functions `lisa controls protect` reads them with
(`pull-request-observe.ts`), and for each entry that is enforced on pull
requests it records whether the platform requires the entry's check on the
protected branch. Reading a setting is not a proof, so a result at this rung
is never `passed`:

| the settings say | `observed` | result | reason |
| --- | --- | --- | --- |
| Every check that proves the entry is required. | `required` | `unproved` | `observed-required` |
| A check that proves the entry is not required. | `not-required` | `failed` | `observed-not-required` |
| Nothing: they could not be read. | `unknown` | `unknown` | `merge-protection-unread` |
| Nothing certain: a ruleset whose branch conditions could not be matched requires a check of the entry, and no check of the entry is known not to be required. | `unknown` | `unknown` | `merge-protection-unread` |
| Nothing: the repository is not on github.com. | `unknown` | `unknown` | `platform-not-reached` |
| Not asked: the entry is advisory, or optional on pull requests. | `not-asked` | `unproved` | `not-asked-of-platform` |
| Not asked: the entry reports no check on a pull request. | `not-asked` | `unproved` | `no-check-derived` |

The requests, in order: `GET repos/{owner}/{name}/rulesets?per_page=100`, one
`GET .../rulesets/{id}` per branch ruleset, `GET repos/{owner}/{name}`. Each
is sent as `gh api --hostname github.com …`, so none goes to whichever host
`gh` would pick by itself. A ruleset list that comes back as a full page may
not be the whole list, so it is treated as not read. A repository that is not
on github.com is asked nothing.

### With `--pull-request-canaries`: open, read, remove

A canary is a branch and a pull request made only to be read and removed.
Only an entry that is enforced on pull requests and **not** at commit or
push, and whose check the platform already requires, gets canaries: one
carrying its violating change and one carrying its clean change. An entry
passes only when the platform would not let the violating canary through
because the entry's own required check failed on it, and the same check
passed on the clean canary.

**A canary is never merged.** Every canary request goes through one door
(`canary-door.ts`) that knows a short closed list of writes: create a blob,
a tree or a commit; create a branch under `lisa-attest/`; open a **draft** pull
request whose head is under `lisa-attest/`; change a pull request by exactly
`{"state": "closed"}`; delete a branch under `lisa-attest/`. Anything else is
refused without being sent. The door has no rule a merge could match, and no
rule that touches a branch outside the prefix.

**A canary is only ever a draft.** The platform does not merge a draft, for a
person or for automation that merges pull requests whose checks are green, and
the clean half of a proof is exactly such a pull request. Where the platform
does not offer drafts for the repository, no pull request is opened in its
place: the half is `not-started` with the platform's own reason, and the entry
is `unknown`. A pull request the platform opened as an ordinary one although a
draft was asked for is closed without being read.

**Whether a canary was merged is read, not assumed.** Before a canary's pull
request is closed the platform is asked whether it was merged, and the answer
is kept in the canary's record as `merged`: `true`, `false`, or `null` when it
could not be asked, which is never read as "no". A merged pull request is not
closed over. Once one canary of a run was merged no further canary is opened,
because whatever merged it would take the next one too.

What the platform is asked about a canary is its `mergeable` and
`mergeable_state`, and what each of the entry's checks concluded on the
canary commit. The checks are read because the platform's one word covers
everything at once: a draft is always `draft`, and a repository that requires
a review holds every pull request at `blocked`. A half is decided by the
entry's own checks:

| the platform showed | the half | reason |
| --- | --- | --- |
| One of the entry's required checks failed. | `rejected` | `rejected-as-declared` |
| ... but it reports the pull request as mergeable anyway (`clean`, `unstable`, `has_hooks`). | `accepted` | `accepted` |
| Every one of the entry's checks passed. | `accepted` | `accepted` |
| A check had not reported at the time limit. | `unknown` | `timed-out` |
| A check was cancelled. | `unknown` | `killed` |
| A check was skipped, or neither passed nor failed. | `unknown` | `nothing-measured` |
| The canary could not be built from the patch. | `unknown` | `patch-not-applied` |
| The branch or the pull request could not be created. | `unknown` | `not-started` |

**Only the required check's own result counts.** A required check is a name
and, where the platform's settings say so, the one app allowed to report it.
Where the settings pin a check to an app, only that app's check run is read
as the entry's check; a result under the same name from anything else is
ignored, exactly as the platform ignores it. A commit status does not say
which app wrote it, so it is never counted for a pinned check. A pinned check
that nothing but another source reports therefore ends `timed-out`, never
passed. The apps a check is pinned to are in `pull_request.points[].checks[]`
as `app_ids`.

The steps, each of which can only narrow what the run may do:

1. **The platform.** Canaries are opened on github.com only. Anywhere else
   nothing is asked, nothing is created, and the entry stays at the
   `observed` rung.
2. **Write access, learned by reading.** `GET repos/{owner}/{name}` says
   whether the signed-in account has the `push` permission. Unless it says
   yes, nothing is created and the entry is `unknown`
   (`canary-permission-missing`), naming the access that is needed.
3. **The sweep.** Canaries an earlier run left behind are removed; see below.
4. **The base.** The head of the protected branch is read. It is read again
   at the end, and both are kept in `pull_request.base_head`.
5. **Each half, one at a time.** The canary commit is the head of the
   protected branch with the half's patch applied, built through the
   platform's object API and never pushed from a checkout. The branch is
   created, the pull request is opened as a draft, the answer is waited for
   no longer than the half's time limit, the platform is asked whether the
   pull request was merged, and the pull request is closed and the branch
   deleted before the next half begins.

A canary branch is named `lisa-attest/<run>/<made>-<number>-<half>`: the run's
identifier, the time the canary was made in UTC to the second, its number in
the run, and `violation` or `clean`. Its pull request is titled
`[lisa-attest] <entry> <half> half (do not merge)` and says in its
description what it is and that it must not be merged.

### Canaries are removed however the run ends

| the run ends because | what removes the canary |
| --- | --- |
| A half finished or failed. | The half itself, before the next begins. |
| Something threw. | The half, and again the run, in a `finally`. |
| The process was told to stop (`SIGINT`, `SIGTERM`, `SIGHUP`). | A handler, before it lets the signal end the process. |
| The process was killed outright. | The sweep at the start of the next run that opens canaries. |

A branch is tracked for removal before the request that creates it is sent.
Deleting the branch is tried even when closing the pull request failed or
threw, because the platform closes a pull request whose branch is gone. A
canary stays tracked until the platform answers that its branch is deleted
or that the reference does not exist; any other refusal is a failed removal
and is tried again when the run ends. The stop handler tries a removal that
failed once more before it lets the process go, because a second interrupt
can kill the request that was doing the removing. What could not be removed
is in the canary's record (`closed`, `branch_removed`, `cleanup_problem`),
which says what the last try found.

**What a run could not undo is said on standard error.** The results say
whether each control works, not whether the run cleaned up, so
`lisa controls attest` prints one line for each of these, in the table and the
JSON mode alike, naming the branch or the pull request (`pull-request-notices.ts`).
They are printed on every way out of a run once its proofs are in: with the
results, and also when the results could not be written down or the run's
own copy could not be removed. Those two runs exit 2 as they always did; the
lines come before the one that says nothing was written.

| what was found | the line names | the exit code |
| --- | --- | --- |
| A canary whose pull request is still open or whose branch still exists. | The pull request and the branch. | Unchanged. |
| A canary of an earlier run that the sweep could not list or remove. | The branch, with the platform's answer. | Unchanged. |
| A canary pull request the platform says was merged. | The pull request, its branch and the protected branch. | 1, whatever the proofs showed. |
| The protected branch moved (`base_head.unchanged` is `false`) and a canary was merged, or it is not known whether one was. | Both commits, and the canaries not accounted for. | 1, whatever the proofs showed. |
| The protected branch moved and the platform said no canary was merged. | Both commits. | Unchanged: something else moved it. |
| The head of the protected branch could not be read before or after. | The branch. | Unchanged. |

**The sweep never guesses.** It removes a branch under `lisa-attest/` only
when its name says another run made it more than two hours ago
(`canary_lifetime_seconds`). No run keeps a canary open longer than one
half's time limit, which is at most thirty minutes, so a canary that old
belongs to no run that is still going. A younger one is left alone: it may
be a concurrent run's. So is a branch whose name does not say when it was
made. Before it closes a stale canary's pull request it checks that the pull
request's head is exactly that branch, whatever list the platform returned,
so it cannot close anybody's own pull request. It lists at most a thousand
branches under the prefix.

Three limits are known and accepted:

- The time in a canary's name comes from the clock of the machine that made
  it, and its age is judged by the clock of the machine that sweeps. The
  rule holds while the two agree to within an hour and a half.
- A third interrupt during the stop handler's second attempt leaves the
  canary for the next run's sweep, two hours later at the earliest.
- If the request that creates a branch is cut off and the platform creates
  the branch after the run asked for it to be deleted, the branch is left
  for the next run's sweep.

### Where the results go

A run still holds exactly one result per register entry.

- An entry enforced on pull requests and not at commit or push gets its one
  result from the platform. In `entries` it has `moment: "pull-request"` and
  a `rung`.
- An entry enforced at commit or push and also on pull requests keeps the
  result its local proof gave it, unchanged and with no `rung` of its own.
  What was read about its pull-request point is an additional result, at the
  `observed` rung, in `pull_request.points` only. It is not exercised a
  second time.

`pull_request` is added to the run whenever the register has a pull-request
entry:

| key | holds |
| --- | --- |
| `mode` | `observed` or `canaries`. |
| `platform`, `branch` | Where the repository is hosted and the protected branch that was read. |
| `points` | One per entry with a pull-request enforcement point: the entry result's keys, plus `rung` (always), `settles_entry` (whether it is the entry's one result), `observed`, `checks` (each `{ context, state, app_ids }`) and `completed_at`. |
| `run_id`, `permission`, `sweep`, `base_head` | What canary mode did; `null` otherwise. |
| `canaries` | One record per canary: its branch, pull request, commit, what the platform said, whether it was removed, and whether the platform says it was merged (`merged`, which must never be `true`). |
| `requests` | Every request, in order, each `{ method, path, sent }`. |
| `canary_lifetime_seconds` | How old a canary must be before a later run removes it. |

`rungOf(entry)` in `pull-request-types.ts` gives the rung of any entry
result: its own `rung` when it has one, `exercised` for a commit or push
result whose halves were run, and `null` when nothing was obtained.

### What is written down

What the platform said goes into `.lisa/controls/evidence.json` with the
rest of the run, as records at the `pull-request` moment
(`pull-request-evidence.ts`). Each point gives one record per requirement its
entry serves, at the `observed` rung:

| the settings say | record's `result` | `reason` |
| --- | --- | --- |
| every check of the entry is required | `held` | `observed-required` |
| a check of the entry is not required | `failed` | `observed-not-required` |
| nothing, because they were not read | `unknown` | `merge-protection-unread`, `platform-not-reached` |
| nothing, because the platform was not asked | no record | |

An entry whose canaries were run also gets one record per half per
requirement, at the `exercised` rung, with `result` decided the way a commit
or push half is. A canary half is handed to the writer from this one place:
the batch made from the run's `entries` takes commit and push halves only.

So after a default run a requirement that accepts `observed` evidence reads
conforming when the platform requires the entry's check, a requirement that
needs `exercised` evidence reads `unknown`, and a check the platform does not
require reads non-conforming. After a passing canary run both read
conforming. See [evidence and the verdict](evidence-and-verdict.md).

A run that was asked for canaries replaces everything on record for every
pull-request entry. A run that only read the settings leaves an entry's
records alone, writing nothing new about it, while the evidence file holds
an answer a canary gave for it (a half that held or failed), every record of
the entry at this moment is still within its lifetime, and the settings did
not say today that its check is not required. Reading a setting plants
nothing, so it does not take the place of a canary proof that is still
current. When the settings say the check is no longer required, the `failed`
record replaces the earlier proof.

The register's `status: "unproved"` mark is read from these records too, but
no run can clear it yet. The mark is carried only by an entry whose
pull-request check runs from a file Lisa did not write, on a platform other
than github.com, and canaries are opened on github.com only. Such an entry
gets an `unknown` observed record (`platform-not-reached`) and no half.

## Where the changes are planted

A proof changes files, and it must never change the operator's own. What the
proofs find is a different matter: when they have run, the command writes it
into the operator's repository, to three files under `.lisa/controls/` and
nothing else (see "Exit codes").

The runner therefore touches no folder itself. It is handed a workspace:

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
`--workspace` was given. Only a run in the first one is a proof and writes
its results down. A run in the second is a report.

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

### A folder the operator names (`--workspace`): a report, not a proof

This workspace works in a copy somebody else made. It plants a change with
`git apply`, starts the entry's own command in the entry's own folder, and
takes the change back out with the reverse of the same patch. It makes no
commit and needs no carrier, so it shows that the check works and says
nothing about whether anything runs it. A repository with no hook installed
at all gets the same answers.

**So a run with `--workspace` writes nothing.** It prints the same table or
JSON document, then one line on standard error that begins
`attest: REPORT ONLY.` and says that no evidence, no register and no verdict
was written. Written down, its answers would read as exercised evidence at
the commit moment and make a requirement conforming, which is the different
proof under the same name that the disposable copy refuses to fall back to.
It cannot raise the rung of any requirement, and it leaves whatever an
earlier run recorded exactly as it was. Its exit code says what the checks
did, as without the option: 0 when every entry passed, 1 when one did not,
2 when nothing was run.

What it is for: seeing what a check's own command does with the two changes
in a copy that has what the command needs, such as installed dependencies or
built output, which the disposable copy does not have (see the shared limit
under "How it is held to `attest`"). Proving a check that needs those is not
possible in this release. It is tracked as CodySwannGT/lisa#5012, and until
then such a check's requirement reads `unknown`, never conforming on the
strength of a `--workspace` run.

The command refuses a folder that is the repository, is a link to it, holds
it, or is inside it. A folder inside the repository is part of the
operator's own working tree, and so is everything planted in it.

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
`failed_halves`, `reason`, `detail`, `time_limit_seconds`, `halves`, and
`rung` on an entry the hosting platform settled.

Per half that was run: `entry_id`, `half` (`violation` or `clean`), `moment`,
`patch`,
`command` (the argument list, or `null` when no check was started),
`exit_status`, `started_at`, `completed_at`, `output_excerpt`,
`output_truncated`, `matched_lines`, `outcome`, `reason`, `detail`.

`output_excerpt` is the last 4000 characters of what the check printed, and
`matched_lines` the lines that carried the failure text. Every value shaped
like a credential is taken out of the whole output before it is cut, so a
cut cannot leave part of one behind; see
[secret values](secret-values.md).

A canary half has the same keys. Its `moment` is `pull-request`, its
`command` and `exit_status` are `null`, and its `output_excerpt` holds what
the platform said.

The whole run: `schema_version`, `passed`, `counts`, `entries`, and
`pull_request` when the register has a pull-request entry. `passed` is true
only when there is at least one entry and every entry passed.

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

That holds for commit and push. A pull-request result is what the hosting
platform said at the time, reached through the `gh` command, so it changes
when the platform's settings do. A canary run also differs in its run
identifier, its branch names and its pull-request numbers.

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

A canary half has the same limit. It is how long the command waits for the
entry's check to report on the canary, looking every fifteen seconds; at the
limit the canary is closed and the half is `timed-out`.

## Exit codes

| code | means |
| --- | --- |
| 0 | There is at least one entry and every entry passed. |
| 1 | The proofs ran and some entry did not pass, or the register has no entries. |
| 2 | There are no results: the path is not a folder, the gates declaration was refused, the disposable copy could not be made or the folder named was refused, the run could not finish, or what it found could not be written down. |

When the proofs have run (exit 0 or 1), the command writes three files in the
repository: the evidence, the control register and the verdict. What they
hold, and how `lisa controls attest --check` holds them to each other, is in
[evidence and verdict](evidence-and-verdict.md). When no proof was run
(exit 2), it writes nothing. With `--workspace` it writes nothing whatever
the exit code: that run is a report. Nothing else in the repository is
changed: the changes are planted in the disposable copy only.

A result at the `observed` rung is never `passed`, so a register with an
entry enforced only on pull requests exits 1 unless that entry was exercised
with canaries and passed.

A run stopped by a signal ends by that signal, as any interrupted process
does, after removing its copy.

## Checking a pair before anything is installed

```
lisa controls proof-check [path]
lisa controls proof-check [path] --acknowledge-external-effects
```

The two changes of a proof are patch files a repository keeps under
`.lisa/controls/proofs/`. Writing a change that breaks one tool's rule takes
knowledge of that tool, so the agent that configures a repository writes
them, in the configure step. `proof-check` is how it finds out whether what
it wrote is a pair `attest` can use. It is a feedback loop for whoever
writes the patches: it writes nothing, records nothing, and a `ready` from it
is not a proof of a control.

For each check declared as a part of a gate, it asks these questions in
order and stops at the first problem:

1. Does the part name both patch files, are both there and readable, and do
   they hold different changes?
2. Is failure text declared (`proof.failure_shape`)? Without it `attest` can
   never count a rejection.
3. Does each change apply to the last commit?
4. Does each change touch a file inside the part's own folder? A change that
   edits what the check is or leaves a file at a path the repository ignores
   (see "A proof never changes what the check is"), or that leaves nothing
   git would commit, is turned away at the same point.
5. Started on the violating change, does the part's own command fail and
   print the declared failure text? Started on the clean change, does it
   pass, without printing that text?

It works in a disposable copy built with no carriers (see "The disposable
copy"), one per run, put back to its starting commit after every change. So
it runs before any hook exists and with uncommitted work in the tree, and
the declaration and the patch files are taken from the working copy as they
are, committed or not. The repository itself is never changed.

Nothing in it is a second reading of a check's answer:

- A change is planted with `applyProofPatch` and staged the way a proof's is.
- "Inside the part's folder" is the gate runner's `touchesFolder`, asked of
  the staged names git lists with the runner's own options.
- The command is started and judged by `measureChange`
  (`src/controls/before-enforce-observe.ts`), the function the
  before-enforce run uses for the same thing: `judgePart`, then the declared
  failure text, exactly as a half of a proof is read.

### What it prints

One JSON document on standard output, and one line per part on standard
error.

```
{ schema_version: 1,
  outcome: "ready" | "not-ready" | "nothing-to-check",
  reason,                       // the same as a sentence
  copy: { commit, uncommitted_work, carried } | null,
  counts: { "ready", "not-ready", "no-proof" },
  parts: [{ entry_id, gate, scope,
            result: "ready" | "not-ready" | "no-proof",
            reason,             // a code; see below
            detail,             // one sentence: what is wrong, what to change
            note,               // why attest will still not prove it locally, or null
            proof: { violation, clean, failure_shape },
            halves: [{ half, patch, changed_paths, run }] }] }
```

`halves` holds each change that applied, in order. `run` is what the part's
command said about it: `command`, `exit_status`, `started_at`,
`completed_at`, `output_excerpt`, `output_truncated`, `matched_lines`,
`outcome`, `reason` and `detail`, or `null` when the command was not started
on that change because an earlier question settled the part. What a tool
printed is prepared the way an evidence record's excerpt is, and the whole
document is scanned for credential shapes once more before it is printed.

| `reason` of a part that is `not-ready` | the question it failed |
| --- | --- |
| `half-not-declared`, `patch-missing`, `patch-unreadable`, `patches-identical` | 1 |
| `no-failure-text` | 2 |
| `external-effects` | the proof says it reaches outside the repository and `--acknowledge-external-effects` was not given |
| `not-a-command` | what measures the part is not a command that can be started |
| `patch-not-applied` | 3 |
| `declaration-changed`, `ignored-path`, `no-change`, `outside-folder` | 4 |
| `violation-accepted`, `wrong-failure-text`, `clean-rejected`, `failure-text-on-clean` | 5 |
| `not-started`, `timed-out`, `killed`, `nothing-measured` | 5: the command gave no answer on one of the changes |

A part that names no patch file at all is `no-proof`. It is listed, it stays
unproved, and it does not fail the command. A check that comes with a
supported project type is not a part and is not listed: this release writes
no proof for those.

| exit code | means |
| --- | --- |
| 0 | Every part that declares a proof is ready, or no part declares one. |
| 1 | At least one part's proof is not ready. The document is complete. |
| 2 | Nothing could be checked: the path is not a folder, the gates declaration was refused, the copy could not be made, or the run could not finish. Nothing is printed on standard output. |

### How it is held to `attest`

`tests/integration/controls-proof-check-attest.test.ts` runs both built
commands on the same repositories. A pair `proof-check` calls `ready` is one
`attest` then passes through a real commit or push with the carriers
installed in its copy; a pair it refuses is one `attest` does not pass.

One of its cases is the pair this would otherwise be weakest against: a
check that lets everything through, with a "violating change" that edits
`.lisa.config.json` to swap its command for one that fails. `proof-check`
reads `not-ready` with `declaration-changed`; `attest` settles the entry
`unknown` with the same reason, exits 1, and the requirement the check
serves reads `unknown` in the verdict it writes. The two commands reach that
answer through the same function.

`tests/integration/controls-proof-change-rule.test.ts` does the same for the
two ways round that rule that were found afterwards: a check declared as
`npm run lint` (and as `make lint`) whose "violating change" swaps the
script, and a "violating change" that drops a file at an ignored path. Both
commands refuse each, with `declaration-changed` and `ignored-path`.

`tests/integration/controls-proof-change-rule-letter-case.test.ts` holds the
two commands to the same refusal for a "violating change" that names the
declaration as `.lisa.config.JSON`, and the manifest of a check run through
npm as `Package.json`. It has something to run only where the temporary
folder ignores letter case, and is skipped, saying so, anywhere else.
`tests/unit/controls/proof-change-letter-case.test.ts` holds the rule
itself on every machine, with a stand-in for git that reports what git
reports on such a file system.

The two differ on purpose in three places:

- `proof-check` is stricter about the failure text. A check that passes the
  clean change and still prints the declared failure text is `not-ready`
  (`failure-text-on-clean`), because text that appears either way does not
  tell a failure from a pass. `attest` would pass that pair.
- `proof-check` tries a pair whatever moment the check runs at. For a check
  that is optional at commit or push, or that runs only before a merge, a
  `ready` carries a `note` saying why `attest` will not prove it at commit or
  push.
- `proof-check` starts only the part's own command. In `attest` a commit or
  push runs every required check declared at that moment, so a clean change
  that another check at the same moment refuses reads `unknown` there. A
  clean change should be one every check accepts.

One limit is shared by both. The copy is a clone of the last commit, so
nothing git ignores is in it. A tool that only runs with installed
dependencies or built output from the working copy does not run there. In
`proof-check` such a part reads `not-started`, or `clean-rejected` without
its failure text; in `attest` its halves read `unknown`.

### How the patch files are named

The names are a convention the configure skill states; nothing reads meaning
from them. A check's two files are `<check>.violation.patch` and
`<check>.clean.patch` under `.lisa/controls/proofs/`. `<check>` is the
gate's name, then `@`, then the part's folder with every `/` written as `-`
(`code-style@api.violation.patch`); for a part that covers the whole
repository it is the gate's name alone (`code-style.clean.patch`).

The skill has the agent make each change in a scratch clone of the last
commit and let git write the patch (`git diff --cached --binary`), so a test
change is never in the operator's working copy and uncommitted work is never
mixed into a patch.
