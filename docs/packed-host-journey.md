# Packed-host journey

The packed-host journey (`tests/integration/shared-runtime-packed-hosts.test.ts`)
is Lisa's end-to-end check that a **packed, installable copy of Lisa** still
installs and applies correctly in a set of example host projects. It packs Lisa
the way npm would publish it, installs that package into fixture hosts for each
supported stack, and checks what each host ends up with.

It is slow: about 15 minutes, which was more than half of the integration job.
So it **no longer runs on pull requests** (CodySwannGT/lisa#4606, owner
decision 4 of CodySwannGT/lisa#4587). It runs only when someone starts it. This
page says when you need to, and how.

## When to run it

Run it before merging any change to **what Lisa packages or what host projects
install**. In practice, that means a change to any of these:

- `package.json` — its `files`, `exports`, or `bin` fields, or its dependencies
  (`dependencies`, `peerDependencies`, `optionalDependencies`).
- `scripts/build-plugins.sh` — how the plugin artifacts are built.
- `scripts/clean-dist.mjs` — what is cleared before a build.
- Any `tsconfig*.json` — what is compiled into `dist/`.
- The apply or postinstall code under `src/` — what runs in a host when Lisa is
  installed or applied.
- The template directories (`all/`, `typescript/`, `npm-package/`, `expo/`,
  `nestjs/`, `cdk/`, `rails/`, `phaser/`, `harper-fabric/`, and the other stack
  directories) — what gets copied into hosts.
- `tests/fixtures/shared-runtime-hosts/` — the example hosts the journey uses.

If your change touches none of these, you do not need to run it.

If you are not sure, run it. It costs about 15 minutes of runner time and
nothing else.

## How to run it

### On GitHub (recommended)

Start the **📦 Packed-host journey** workflow
(`.github/workflows/packed-host-journey.yml`). From a terminal:

```bash
gh workflow run packed-host-journey.yml -f ref=main
```

Replace `main` with your branch name to test a pull request before it merges,
for example `-f ref=my-feature-branch`. You can also start it from the
repository's **Actions** tab: pick **📦 Packed-host journey**, then **Run
workflow**, and type the branch.

A green run means the journey passed. A red run means a packaged install broke;
open the run's log to see which host failed.

#### Measuring the filesystem probe on the same runner

The same workflow can first measure how well Lisa's filesystem timing probe
(`tests/helpers/fs-latency-budget.ts`) predicts the cost of real file deletion
on a GitHub runner (CodySwannGT/lisa#4636). Add `-f probe_diagnostic=true`:

```bash
gh workflow run packed-host-journey.yml --ref my-feature-branch -f ref=my-feature-branch -f probe_diagnostic=true
```

This adds about five minutes. The run log then has one `FS_PROBE_DIAGNOSTIC`
line per sample, and the samples are also kept as a downloadable run artifact.
Use `--ref` as well as `-f ref=` when the branch itself changes this workflow,
so GitHub runs the branch's copy of it.

### On your own machine

The journey only runs under the exact Node version CI uses (24.21.0). Under any
other Node it skips itself and prints a "DEFERRED TO CI" note instead of
running. Use [mise](https://mise.jdx.dev/) to run it under the right Node:

```bash
mise exec node@24.21.0 -- bun run test:integration:packed-hosts
```

It also needs Bun 1.4.4 and, for the Rails example host, Ruby with the
`activerecord` gem — the same tools the GitHub workflow installs.

## What protects releases instead

Taking the journey off pull requests was safe because two other safeguards now
cover what it used to catch on every change:

1. **Canary-first rollout** (CodySwannGT/lisa#4604). When a new Lisa version is
   rolled out to host projects, one designated *canary* host is upgraded first.
   The rest are touched only after the canary's update pull request passes its
   checks. A bad release therefore breaks one host, not all of them. See the
   `lisa-update-projects` skill and `scripts/lisa-update-projects-plan.mjs`.
2. **One-command rollback** (CodySwannGT/lisa#4605). If a published Lisa
   version is bad, `bun run release:rollback` marks it deprecated and points
   npm's `latest` tag back at the previous good version in one step, so new
   installs stop picking up the bad one while a fix is prepared. See
   [the release runbook](release-runbook.md).

There is deliberately **no automatic run after each release** either; decision 4
ruled that out. The journey is a tool you reach for when your change is the
kind listed above.
