# Writing a repository's pull-request executor

Part of the enforce step. Follow this when the gates declaration checks something at the
pull-request moment and the repository needs a workflow to run it.

The pull-request executor is the file the hosting platform runs when someone proposes a change. It
runs the gates and reports a failure to the platform when a required gate fails. Lisa's supported
GitHub stacks ship a pull-request caller. A repository without that workflow can supply its own.

Lisa did not write the file you produce and has never seen it refuse a change. So the control
register marks every rule that file runs as **unproved**, and keeps it that way until the attest
step has planted a bad change and a clean change and recorded what happened to each. Writing the
file is not proof that it works.

## Who decides what

| Decided by | What |
| --- | --- |
| The gates declaration in `.lisa.config.json` | Which platform hosts the repository and where the file is. |
| `lisa controls register` | Whether that declaration is usable. Which rules read `unproved`, and when they stop. |
| This flow | Writing the file so it meets the contract. |
| The attest step | Whether the file works. Nothing in this flow may say that it does. |

Two things follow, and both are rules:

- **Never mark a rule as proved yourself.** Do not edit `.lisa/controls/register.json` and do not
  write `.lisa/controls/evidence.json`. The first is generated; the second belongs to the attest
  step.
- **Never treat one platform's syntax as the contract.** The contract is the four requirements in
  step 2. The snippets in this document are examples and nothing more. Read the platform's own
  documentation for how it writes each one.

## When this applies

Work out which platform hosts the repository from where it is pushed to and where its pull
requests are opened. If you cannot tell, do not guess: write nothing, and return `blocked` with the
question "Which platform hosts this repository's pull requests?".

- **GitHub:** read the pull-request workflow and check whether Lisa's workflow already runs these
  declared gates. If it does, leave it in place. When the repository needs a workflow, use an
  existing host-owned workflow or add `.github/workflows/lisa-declared-controls.yml`. Use the
  GitHub instructions in step 2 and record `platform: "github"` on the declarations.
- **Any other platform:** carry on.

## Step 1: find the executor the register names

A gate says where its pull-request executor is on its `pull-request` entry in the `gates` block of
`.lisa.config.json`:

```json
{
  "gates": {
    "code-style": {
      "pull-request": {
        "level": "required",
        "executor": { "platform": "gitlab", "path": ".gitlab-ci.yml" }
      },
      "parts": [
        {
          "scope": ".",
          "command": ["ruff", "check", "."],
          "evidence": { "locators": [{ "path": "ruff.toml", "line": 1 }] }
        }
      ]
    }
  }
}
```

| Key | Meaning |
| --- | --- |
| `platform` | The hosting platform's name in lower-case letters and digits, with hyphens between words, such as `github`, `gitlab`, `bitbucket` or `azure-devops`. |
| `path` | The file, written from the repository root with `/` between folders. One spelling only: no leading `./`, no trailing `/`, no `..`, no absolute path. |

`executor` is accepted on the `pull-request` entry only, and only in the entry's long form (an
object with a `level`). The short form `"pull-request": "required"` has nowhere to put it.

Every gate that is `required` or `optional` at the pull-request moment must name the **same**
executor. One command runs all of them, so they all run from one file. `lisa controls register`
refuses a declaration that names the file on some of those gates and not on others, or that names
two different files. A gate that only waits for a check another system reports (`await`) may leave
the key out, because no file of the repository runs it.

Read what is declared:

```bash
lisa controls register
```

Use `bunx @codyswann/lisa controls register` when `lisa` is not on the PATH. Then read
`.lisa/controls/register.json`. An entry's pull-request enforcement point carries the executor:

```json
{
  "level": "required",
  "location": "hosting-platform",
  "moment": "pull-request",
  "executor": { "platform": "gitlab", "path": ".gitlab-ci.yml" }
}
```

- **The register names an executor:** that `path` is the file you write in step 2.
- **It names none, and gates are checked at the pull-request moment:** add the `executor` key to
  each of those gates in `.lisa.config.json`, using the platform you worked out and the path that
  platform reads its pipeline from. Change nothing else in the declaration. Run the command again.
- **The command exits with a code other than 0:** the declaration was refused. Show the operator
  the lines from stderr, fix what they name, and run it again. Write no file until it exits 0.

## Step 2: write the file at `path`

If the file already exists, read it first and add to it. Never replace a pipeline the repository
already has.

The file must meet all four of these. Each one is a requirement on what the platform does, not on
how the file is spelled.

1. **It runs the gate runner at the pull-request moment.** From the repository root, on a checkout
   of the proposed change:

   ```bash
   node scripts/lisa-run-gates.mjs --moment=pull-request
   ```

   Write the moment with `=`. The runner refuses `--moment pull-request` with a space. Before that
   command runs, the job must have Node.js 24 or later, the runner's own files in the checkout
   (`scripts/lisa-run-gates.mjs`, `scripts/lisa-gates.mjs` and the `scripts/lib/` folder), and
   whatever the declared gates' own commands need: the project's dependencies and tools, installed
   the way the project installs them.

2. **A non-zero exit fails the pipeline.** The runner's exit code is the verdict:

   | Exit code | Meaning | The pipeline must |
   | --- | --- | --- |
   | `0` | Every required gate was proved. | Pass. |
   | `1` | A required gate failed or could not be proved. | Fail. |
   | `70` | The runner itself could not run. Nothing was proved. | Fail. |
   | `78` | No gates are declared. Nothing was proved. | Fail. |

   Nothing may turn a non-zero exit into a pass: no `|| true`, no setting that lets the job fail
   without failing the pipeline, no step that carries on after an error. A pipeline that passes
   when the runner did not exit `0` is worse than no pipeline, because it looks like a check.

3. **It runs on every change to a merge request into the protected branch.** When the request is
   opened, every time a commit is added to it, when it is reopened, and when its target branch
   changes. No condition may let some changes through without a run: no filter on which files
   changed, no exception for an author or a label, and not a schedule or a manual trigger in place
   of the events above.

4. **The author of the change cannot skip it.** The job is not manual, not optional and not allowed
   to fail. A run the author skipped, for example with a marker in a commit message, must not count
   as a pass.

   Part of this requirement is outside the file. Whether a passing run is a condition of merging,
   and whether the author can change this file in the same merge request, are settings of the
   hosting platform. The merge-protection part of the enforce step deals with those. Say in your
   result which of them you could confirm and which you could not; never report this requirement
   as met on the strength of the file alone.

### GitHub repositories with their own workflow

In each declaration the workflow runs, name its exact repository path in `executor` and set
`caller_chain` to a stable label such as `["Declared Controls"]`. Use the planner's `context`
as the GitHub job name. It comes from the same declaration that `lisa controls protect` reads,
so the reported check and the required check have the same name. Install the project's toolchain
and dependencies in the check job before running the gate.

Use the repository's real workflow path and protected branch.

Example only, using `.github/workflows/lisa-declared-controls.yml` to protect `main`.

```yaml
name: Run declared controls
on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened, edited]
permissions:
  contents: read
jobs:
  plan:
    runs-on: ubuntu-latest
    outputs:
      legs: ${{ steps.plan.outputs.legs }}
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: actions/setup-node@v6
        with:
          node-version: '24'
      - name: Plan declared pull-request checks
        id: plan
        shell: bash
        run: |
          legs=$(node scripts/lisa-gates.mjs legs --moment=pull-request --host-workflow=.github/workflows/lisa-declared-controls.yml --json)
          printf 'legs=%s\n' "$legs" >> "$GITHUB_OUTPUT"
  check:
    needs: plan
    if: needs.plan.outputs.legs != '[]'
    strategy:
      fail-fast: false
      matrix:
        include: ${{ fromJSON(needs.plan.outputs.legs) }}
    name: ${{ matrix.context }}
    runs-on: ubuntu-latest
    timeout-minutes: ${{ matrix.timeout }}
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
          fetch-depth: 0
      - uses: actions/setup-node@v6
        with:
          node-version: '24'
      - name: Run this gate's declared parts
        if: matrix.action == 'run'
        env:
          GATE_ID: ${{ matrix.gate }}
        run: node scripts/lisa-run-gates.mjs --moment=pull-request --builtins=none --parts=all --gate="$GATE_ID"
      - name: Fail when the declaration has no prover
        if: matrix.action == 'unproved'
        run: exit 1
```

Each required gate gets one job, including when it has several folder-scoped parts. All of its
parts are eligible to run and a failed required part fails that job. After GitHub reports the
jobs, verify their names against `lisa controls protect` before changing merge settings.

### Other platform examples

These show the shape of a job that meets requirements 1 and 2 and is triggered as requirement 3
asks. They are **examples only**. They are not complete pipelines, they are not the contract, and
a platform may have changed its syntax since they were written.

Example only, in the style of GitLab CI/CD:

```yaml
lisa-pull-request-gates:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - node scripts/lisa-run-gates.mjs --moment=pull-request
```

Example only, in the style of Bitbucket Pipelines:

```yaml
pipelines:
  pull-requests:
    "**":
      - step:
          script:
            - node scripts/lisa-run-gates.mjs --moment=pull-request
```

## Step 3: write the register again

```bash
lisa controls register
```

The command names the rules that read unproved, for example:

```text
register: 2 entries read unproved: code-style@api, code-style@web. The pull-request check for them runs from .gitlab-ci.yml on gitlab, a file Lisa did not write, and .lisa/controls/evidence.json holds no record that both halves of their proof held yet. They stay unproved until the attest step records that both held.
```

Each of those entries now carries `"status": "unproved"` in `.lisa/controls/register.json`. That is
the expected result of this flow, not a failure. Keep the declaration, the file and the register
together in one change.

## How a rule stops being unproved

Only one thing clears the mark: `.lisa/controls/evidence.json` holding a record of **both** halves
of that entry's proof, the change that breaks the rule (`violation`) and the change that does not
(`clean`), each saying the half held. A half that was run and did not hold leaves the mark in
place. The attest step writes those records. When it has, `lisa controls register` writes the
register again without the mark.

The register is generated from the declaration and the evidence file together. So after either one
changes, `lisa controls register --check` fails until the register is written again, and it says
when the status is what differs. The mark applies to host-written workflows on GitHub as well.
Use the verdict to see what was proved.

## Step 4: return the result

| Field | Value |
| --- | --- |
| `platform`, `path` | The executor, copied from the register. `null` for both when `blocked` before one was known. |
| `outcome` | `written` when you created or changed the file, `unchanged` when it already met the contract, `blocked` when you wrote nothing. |
| `unproved` | The ids of the entries the register marks unproved, copied from the command's output. Never worked out yourself. |
| `not_confirmed` | Each of the four requirements you could not confirm, in one plain sentence each. Empty when all four are confirmed. |
| `reason` | When `blocked`: why, in one plain sentence. Otherwise `null`. |

Then tell the operator, in plain words: which file now runs the checks on a proposed change and on
which platform; that Lisa did not write a file of that kind, so the rules it runs are marked
unproved; how many rules that is; and that they stay unproved until the attest step has seen the
file refuse a bad change and accept a good one. Name any requirement you could not confirm.

## What this flow never does

- It leaves the Lisa-shipped GitHub caller in place.
- It never says a rule is proved, and never writes or edits evidence or the register by hand.
- It never weakens the contract to get a pipeline to pass.
- It never guesses the hosting platform.
- It never replaces a pipeline file the repository already has.
