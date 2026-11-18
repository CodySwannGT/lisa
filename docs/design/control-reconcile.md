# Reconciling the register with what is installed

The control register records what a team believes it enforces. What is
actually installed can drift away from it without anyone deciding that it
should: a hook file is deleted, a new clone is never wired, someone adds a
check to a hook and tells nobody. `lisa controls reconcile` measures that
distance in both directions and changes nothing.

```
lisa controls reconcile [path]              # local only, sends nothing anywhere
lisa controls reconcile [path] --platform   # also reads the hosting platform's required checks
```

It builds on [gates and policy](gates-and-policy.md): the register is
described under "The control register", the carriers under "Carriers for a
repository on no project type", the pipeline file under "A pull-request
executor Lisa did not write", and the platform's required checks under
"Required checks from the register".

## Direction one: a place the register names, where nothing runs the rule

Every register entry lists its enforcement points: a moment and where the
rule is enforced at it. Each one is a claim. The command asks the place that
already knows whether the claim holds, and never works the answer out a
second time.

| Where | Who answers | What can be established | What cannot |
| --- | --- | --- | --- |
| The checkout (`commit`, `push`) | `installCarriers(root, { check: true })` | Whether git starts the gate runner there in this checkout: the call is in place, the carrier script and the runner exist, and a file that was rewritten still starts the runner. Covers a new clone where `core.hooksPath` is not set and a hook manager that is not switched on. | That the declared command itself succeeds. That is the paired proof's job. |
| The coding agent (`session-start`, `pre-tool`, `post-tool`) | The same carrier check, once it reports such points | The same, for whatever kind of carrier the check reports. A point is matched by `location` and `moment` and by nothing else. | Until the check reports a point there, the point is `not-verifiable`. It is not reported as missing. |
| The hosting platform, pipeline file written by the host | The file the register names (`executor.path`) | That the file is in the checkout and one of its lines that is not a comment runs the gate runner for the pull-request moment. | That the platform runs the pipeline, or requires it before a merge. This is a reading of text, and the result says so. |
| The hosting platform, GitHub | The rulesets that govern the default branch, only with `--platform` | For an entry that is `authoritative` and `required` on a pull request: whether every check derived for it is required by a ruleset on the default branch. | Whether the pipeline that reports the check runs the rule. For an entry that is advisory or optional there is nothing to look for: `not-verifiable`. What a branch protection rule of the older kind requires: those are not read. |
| A deployment pipeline, a scheduled run | Nobody | Nothing. | Everything: `not-verifiable`, stated as such. |

A point ends in one of four states.

| state | means |
| --- | --- |
| `wired` | Something was found that runs the gate runner there. |
| `not-wired` | It was looked for and is not there. This is the only state that is a finding. |
| `not-verifiable` | This command has no way to look there. |
| `not-read` | The place that holds the answer was not asked, or was asked and did not answer. |

Not knowing is not absence. A platform that refuses the read, or that was
never asked, produces `not-read` and never a finding.

### Only rulesets are read on the hosting platform

GitHub keeps required checks in two places: rulesets, and branch protection
rules of the older kind. The read covers rulesets only (reading the older
kind is CodySwannGT/lisa#5018). So what an answer that lists no check means
depends on whether any ruleset governs the branch:

| The rulesets that govern the default branch | The point is | The reason says |
| --- | --- | --- |
| Require every check derived for the entry | `wired` | which checks are required |
| Exist, and do not require one of them | `not-wired` | which check, which rulesets were read, and that only rulesets were read |
| There are none | `not-read` | that no ruleset governs the branch, that the older rules are not read, and that whether the check is required is not known |

A repository with no ruleset on the branch may hold all its required checks
in the older rules, where this command did not look. Calling its checks
"not required" would be a finding about a place nobody read. The result's
`limits` say the same for every run.

## Direction two: a command a hook runs that the register does not list

The command reads what the commit hook and the push hook run. Which file
that is depends on who owns hooks, and the carrier installer's owner
detection has already decided it: a hook file in Husky's folder, in a folder
`core.hooksPath` names, in git's own hooks folder or in Lisa's; or the
committed configuration of Lefthook or the pre-commit framework.

**Nothing found is ever run.** A hook is text, and it is read as text.

### Why not the shell reader the tooling detector has

`lisa-detect-tooling` ships a shell reader
(`plugins/src/base/skills/lisa-detect-tooling/scripts/commands.mjs`). It is
in the package and could be imported, but it answers another question: which
programs would have to be installed. It returns program names only and drops
runtimes, package managers, paths and the usual POSIX tools. Given a hook
that runs `npm run lint`, `node scripts/check.mjs`, `./scripts/scan.sh` and
`ruff check .`, it returns `ruff`. A reconciler has to compare whole commands
with the commands the register declares and name each one to an operator, so
it reads the lines itself (`src/controls/reconcile-hook-lines.ts`).

### What is read, and what is left out

- A shell hook is read line by line. Each line is split where shell starts
  another command: `&&`, `||`, `;`, a pipe, and a lone `&`
  (`src/controls/reconcile-shell-words.ts`). From each piece the redirects
  are left out, and so is what shell writes around a command: the words in
  front of it, the bracket that opens a group and the one that closes it
  (`src/controls/reconcile-shell-command.ts`). What is left is reported
  unless it only steers the shell (`set`, `cd`, `exit`, `[`, `echo`), only
  tests for a program (`command -v`), or is Lisa's own carrier.

  | A hook line | Is read as |
  | --- | --- |
  | `{ npm test; } \|\| exit 1` | `npm test` |
  | `( npx eslint . )`, `(npx eslint .)` | `npx eslint .` |
  | `( cd api && ruff check . )` | `ruff check .` |
  | `ruff check . \| tee ruff.log` | `ruff check .` and `tee ruff.log` |
  | `npx lint-staged 2>&1`, `npm run lint > lint.log` | `npx lint-staged`, `npm run lint` |
  | `*.py\|*.pyi) ruff check . ;;` | `ruff check .` |
  | `[[ "$b" =~ ^(main\|master)$ ]] \|\| exit 0` | nothing: a test runs no program |

  A command inside a group used to be dropped with its bracket, so a hook
  could run a check the register does not declare and still be reported as
  in step. A redirect or a pipe used to stay among the command's words, so a
  declared command showed as undeclared.
- Brackets are matched within one line. A closing bracket written against
  the last word of a one-word command, on the last line of a group that spans
  several lines, is read as a `case` label and the command is missed.
- A quote that never closes is given up on once, however many command
  substitutions it holds. Each `$(…)` in it used to be tried two ways, so the
  time to read such a line doubled with every substitution, and one line with
  about thirty of them stopped the command from ever finishing.
- The lines between `# >>> lisa-carrier <moment>` and
  `# <<< lisa-carrier <moment>` are Lisa's and are left out. So is the block
  between `# BEGIN: AI GUARDRAILS` and `# END: AI GUARDRAILS` in a hook a
  Lisa project type manages.
- That managed block reads in one file the host owns, `<hook>.local` beside
  the hook. It is the host's part of the hook by design, so it is opened too.
  No other file a hook calls is opened: **a hook that calls a script is
  reported as that call.**
- A hook whose markers do not pair up is not guessed at. Its commands are
  not reported, the hooks are marked `could-not-read`, and the run fails.
- For Lefthook the configured `run`, `script` and `scripts` entries of
  `pre-commit` and `pre-push` are reported; for the pre-commit framework each
  hook at the stages it runs at, by its `entry` when it is local and by its
  `id` otherwise. A configuration another file extends is read as written.

### What "declared" means

**A command is declared when a register entry's measuring mechanism at that
moment is that command.** For an entry that names a command, that is its
argument list; for an entry that names a task, the task runner and the task
together. The comparison is word for word.

- The moment counts. A linter declared at commit and also run in the push
  hook is undeclared at push.
- Every word counts. `ruff check src` does not declare `ruff check .`.
- The folder does not count: where a hook line ends up running cannot be
  read from the line.

Everything else in a hook is an undeclared control: it runs, and nothing in
the register says what it proves. That is something for a person to look at,
not an error, and the command never removes it.

## The result

One JSON document on stdout (`src/controls/reconcile-types.ts`), byte for
byte the same for the same inputs:

| key | holds |
| --- | --- |
| `outcome`, `reason` | `in-step`, `findings` or `incomplete`, and one sentence. |
| `register` | The path, how many entries, and whether the committed file is `current`, `stale` or `absent`. The comparison always uses the register the declaration generates. |
| `surfaces` | What became of each read: `register`, `carriers`, `hooks`, `hosting-platform`. |
| `enforcement_points` | Every point the register claims, with its state, reason and what was looked at. |
| `hook_commands` | Every command the hooks run, with its file, line and the entries that declare it. |
| `findings` | `enforcement-point-not-wired` (names the entry) and `undeclared-command` (names the hook, file, line and command), each with a `message` and a `next`. |
| `audit_findings` | The same findings in the audit report's finding shape. |
| `limits` | What the command does not read. |

Lines for a person go to stderr, one per finding.

Exit codes: 0 when everything that was needed was read, whether or not there
are findings; 2 when a hook file or, under `--platform`, the hosting platform
could not be read (the document is complete for everything else and says
which); 1 when the register or the checkout's hooks could not be read at all
and there is no document.

## Why the findings are offered to the audit report and not written into it

The audit report holds exactly one finding for each requirement in each
place it is answered, and its check holds every part of it: states,
pointers, questions, the answers people typed. A reconcile finding is about
an enforcement point or a hook command, not a requirement. Writing it into
`report.json` would replace findings the audit made, behind the audit's
back.

So the command writes nothing. `audit_findings` holds findings that are
already in the report's shape and already placed the way the report places
them, each in state `exists-not-enforced`:

- one for every requirement the entry of a not-wired point serves, at `.`
  for a requirement answered once and at the entry's folder for one answered
  per part; and
- one for the requirement the register itself answers (one list of every
  rule, kept in step with what actually runs), which every finding of either
  kind bears on. A command no entry declares appears there as a mechanism
  pointed at its own line: which other requirement it serves is exactly what
  nothing declares.

A suite puts the offered findings into a complete report and runs
`lisa controls report-check` on it, so the shape is held to the report's own
rules. The step that owns the report decides whether to take them up.
