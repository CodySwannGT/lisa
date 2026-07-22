# Dependency Decisions

<!-- lisa-dependency-decisions:v1 -->

This file is Lisa's own record of **why we keep each material dependency**.

Lisa ships the blank version of this file to every project it governs
(`all/create-only/.lisa/DEPENDENCY_DECISIONS.md`). This one is Lisa's filled-in
copy, written against Lisa's own manifests — the proof that the pattern survives
contact with a real dependency set.

A *material* dependency is one whose failure, disappearance, or bad update would
break something a user can see, or would cost real time to replace. Not every
package in the lockfile belongs here — only the ones that own a capability.

You do not need to be an engineer to read this file. Every entry starts with a
plain-language explanation of what that dependency does for us, and every entry
names what evidence would catch a bad update.

## How honest this file is

Every entry below was written from **repository evidence only** — what the
manifests, the CI workflows, the git hooks, and the test suite actually prove.
Repository evidence can show what a dependency does for us, what would catch a
bad update, and roughly what replacing it would cost. It cannot show who
maintains a package, how quickly they answer a security report, or who inside
Lisa is accountable for it.

Those fields are marked `_Not yet decided_`. That marker is not decoration: it
means nobody has checked yet, and it is deliberately preferred over a confident
guess that nobody would ever re-check.

**Every `_Not yet decided_` field in this file is tracked work: #1918.** That
ticket lists each dependency and which fields still need human ratification or
real evidence. If you close a gap here, update that ticket; if you find a new
one, add it there rather than leaving it only in this file.

## How to read an entry

Each entry is a level-3 heading under **Records** followed by nine fields, in
the fixed order the template defines. Two fields carry most of the weight:

- **Why we keep it** — the outcome it protects, in plain language.
- **What would catch a bad update (detection evidence)** — the named check that
  fails if the capability breaks. When the honest answer is "nothing would catch
  it", the entry says so, because that sentence is the most useful line in it.

Each **trust basis** field opens by naming the dependency's trust class from
`plugins/src/base/rules/reference/dependency-trust-classes.md`, then gives the
evidence behind it and the event that triggers human review.

## What counts as material here

Seventeen dependencies, split by blast radius:

- **Ships inside the published CLI** (`dist/`, runs on other people's machines
  and edits their repositories): `commander`, `fs-extra`, `js-yaml`,
  `jsonc-parser`, `smol-toml`, `@decimalturn/toml-patch`, `lodash.merge`,
  `semver`, `minimatch`, `@inquirer/prompts`.
- **Build and development only** (never leaves CI or a developer's machine, but
  several are re-exported as configuration every governed project inherits):
  `typescript`, `vitest`, `eslint`, `oxlint`, `@ast-grep/cli`, `husky`,
  `standard-version`.

Excluded on purpose: the rest of the lockfile, the individual ESLint plugins
(they are configuration carried by the `eslint` entry), and packages listed only
as security floors in `overrides`/`resolutions`.

## Attribution

Adapts the dependency-ownership thesis from Ryan Lopopolo, *Harness
Engineering*, CC BY 4.0, <https://github.com/lopopolo/harness-engineering>
(changes made).

## Records

### typescript

- **Why we keep it:** It is the compiler that turns Lisa's source into the
  program people actually install. It is also the thing that catches a whole
  class of mistakes — a renamed field, a missing argument — before anyone runs
  the code, which is why a broken build is normally a red check rather than a
  broken install.
- **What it is (dependency):** `typescript` `^6.0.3`
- **What it does for us (owned capability):** Compiling Lisa to the published
  `dist/` artifact, and type-checking every change.
- **Why we believe it's safe (trust basis):** Trust class: **build/development
  tool** — it never runs on a user's machine; its output does. Repository
  evidence: it is force-pinned in `package.lisa.json`, so every governed project
  in the fleet runs the same major and an upgrade is a deliberate fleet-wide
  decision. Maintainer, release cadence, and security-response history:
  `_Not yet decided_` (#1918). Human review is triggered if the tool gains reach
  it does not have today.
- **What breaks if this is compromised (exposure):** Build and CI only, but with
  an unusually long shadow: its output is the npm package `@codyswann/lisa` that
  other repositories install and run. It never touches customer data; it does
  run in CI, where credentials exist.
- **What it would take to replace (replacement cost):** Very high, and accepted
  as such. The entire source tree, the exported `tsconfig/*` presets other
  projects consume, and the type-checking gate would all have to be re-expressed
  in another toolchain. No realistic alternative today.
- **What would catch a bad update (detection evidence):** `bun run typecheck`
  and `bun run build:dist`, plus the `bin_smoke` job in
  `.github/workflows/ci.yml`, which builds the package and executes
  `node dist/index.js --version` and `--help`. A compiler that emitted broken
  output would fail that job rather than reach npm.
- **Who owns this and how often we recheck (owner / review cadence):**
  Repository owner (`CodySwannGT`, per `package.json`) / cadence
  `_Not yet decided_` (#1918).
- **Last reviewed:** 2026-07-21

### vitest

- **Why we keep it:** It runs the tests. Everything else in this repository —
  every guardrail, every governance rule — is only trustworthy because a test
  proves it still behaves. If the test runner is wrong, every green check is a
  lie.
- **What it is (dependency):** `vitest` `^4.1.9`
- **What it does for us (owned capability):** Executing Lisa's ~430 test files
  and reporting pass/fail, locally and in CI.
- **Why we believe it's safe (trust basis):** Trust class: **build/development
  tool** — it never runs in production. Repository evidence: Lisa re-exports
  Vitest configuration presets (`./vitest/base`, `./vitest/typescript`, and
  others in `package.json` `exports`) that governed projects inherit, so a
  breaking change propagates to the fleet, not just to us. Maintainer, cadence,
  and security history: `_Not yet decided_` (#1918).
- **What breaks if this is compromised (exposure):** Build and CI only. It runs
  with CI credentials in scope. Its worst realistic failure is quieter than a
  crash: a runner that reports success without executing tests would make every
  gate in this repository vacuous.
- **What it would take to replace (replacement cost):** High. ~430 test files
  plus the exported preset configs would need porting. A migration path exists
  (the repository still carries Jest presets for stacks that use them), so this
  is expensive rather than trapping.
- **What would catch a bad update (detection evidence):** `bun run test` in the
  shared quality workflow (`.github/workflows/quality.yml`). Warning sign: a run
  that reports success with a suspiciously low test count — a silently
  self-skipping runner looks identical to a healthy one in a green check.
- **Who owns this and how often we recheck (owner / review cadence):**
  Repository owner (`CodySwannGT`) / cadence `_Not yet decided_` (#1918).
- **Last reviewed:** 2026-07-21

### eslint

- **Why we keep it:** It is the automatic reviewer that reads every change
  before a human does and refuses the ones that break our agreed rules. Lisa's
  entire product proposition is that these rules are enforced rather than
  suggested — ESLint is where most of that enforcement physically happens, for
  this repository and for every project Lisa governs.
- **What it is (dependency):** `eslint` `^9.39.0`
- **What it does for us (owned capability):** Rule-based code-quality
  enforcement, both here and — via the exported `./eslint/*` configs — in every
  governed project.
- **Why we believe it's safe (trust basis):** Trust class: **build/development
  tool** — it never runs in production. Repository evidence: force-pinned in
  `package.lisa.json` alongside its plugin set, so the fleet moves together;
  Lisa also maintains its own ESLint plugin workspaces against this major.
  Maintainer, cadence, and security history: `_Not yet decided_` (#1918).
- **What breaks if this is compromised (exposure):** Build, pre-commit, and CI.
  It runs inside CI where credentials exist, and it runs on every developer's
  machine through the `pre-commit` hook. It never touches customer data.
- **What it would take to replace (replacement cost):** Very high, and accepted.
  Four in-repository plugin workspaces (`eslint-plugin-code-organization`,
  `-component-structure`, `-ui-standards`, `-phaser`), the exported per-stack
  configs, and the fleet's inherited configuration would all have to be
  rewritten. Oxlint covers part of the surface but is not a drop-in replacement.
- **What would catch a bad update (detection evidence):** `bun run lint` in CI
  and the `pre-commit` hook via `.lintstagedrc`. Lisa's own rule-behavior tests
  under `tests/unit/` are the stronger signal: they fail if a rule stops firing,
  which a plain lint pass would not reveal.
- **Who owns this and how often we recheck (owner / review cadence):**
  Repository owner (`CodySwannGT`) / cadence `_Not yet decided_` (#1918).
- **Last reviewed:** 2026-07-21

### oxlint

- **Why we keep it:** It is the fast first-pass linter that runs before ESLint,
  so obvious problems are caught in seconds instead of minutes. It is what keeps
  the pre-commit hook quick enough that developers do not start looking for ways
  around it.
- **What it is (dependency):** `oxlint` `^1.62.0`
- **What it does for us (owned capability):** Fast first-pass linting on every
  commit and in CI, driven by the exported `oxlint/*` rule sets.
- **Why we believe it's safe (trust basis):** Trust class: **build/development
  tool**. Repository evidence: force-pinned with its companions
  `eslint-plugin-oxlint` and `oxlint-tsgolint` in `package.lisa.json`, and Lisa
  publishes seven `oxlint/*` presets, so its rule semantics are a governed
  fleet-wide surface. Maintainer, cadence, and security history:
  `_Not yet decided_` (#1918). Known caveat recorded in project learnings: oxlint
  exits 0 on warnings, so a rule set to `warn` does not gate anything —
  severity, not presence, is what makes it enforcement.
- **What breaks if this is compromised (exposure):** Build, pre-commit, and CI
  only. Never production, never customer data.
- **What it would take to replace (replacement cost):** Moderate. ESLint already
  covers the same files more slowly, so removal costs speed rather than
  coverage; the seven exported presets would need retiring from the fleet.
- **What would catch a bad update (detection evidence):** `bun run lint` (first
  command in the script) and the `pre-commit` hook. Weak spot: because the tool
  exits 0 on warnings, a regression that downgraded errors to warnings would
  pass CI silently.
- **Who owns this and how often we recheck (owner / review cadence):**
  Repository owner (`CodySwannGT`) / cadence `_Not yet decided_` (#1918).
- **Last reviewed:** 2026-07-21

### @ast-grep/cli

- **Why we keep it:** Some rules cannot be expressed as "this word is banned" —
  they are about code *shape*, like calling a dangerous function in a particular
  position. This tool matches shapes, which is how Lisa enforces the guardrails
  a text search would miss.
- **What it is (dependency):** `@ast-grep/cli` `^0.40.4`
- **What it does for us (owned capability):** Structural (AST-level) rule
  scanning on every commit and via `bun run sg:scan`.
- **Why we believe it's safe (trust basis):** Trust class: **build/development
  tool**. Repository evidence: force-pinned in `package.lisa.json` *and* listed
  in `trustedDependencies` in `package.json` — meaning its install scripts are
  allowed to run, which is a deliberately elevated grant and the main reason
  this entry matters. Maintainer, cadence, and security history:
  `_Not yet decided_` (#1918).
- **What breaks if this is compromised (exposure):** Build, pre-commit, and CI.
  Wider than a pure-JavaScript package: it is a native binary whose install
  scripts we have explicitly trusted, so a compromised release executes code at
  install time on developer machines and CI runners.
- **What it would take to replace (replacement cost):** Moderate to high. The
  structural rules would have to be re-expressed as ESLint custom rules, which
  is possible — Lisa already maintains plugin workspaces — but slow.
- **What would catch a bad update (detection evidence):** `ast-grep scan` in
  `.lintstagedrc` (pre-commit) and `bun run sg:scan`. A rule that silently
  stopped matching would not be caught by either; only the rule-level tests
  would notice.
- **Who owns this and how often we recheck (owner / review cadence):**
  Repository owner (`CodySwannGT`) / cadence `_Not yet decided_` (#1918).
- **Last reviewed:** 2026-07-21

### husky

- **Why we keep it:** It installs the git hooks, which is what makes the quality
  checks unavoidable rather than optional. Without it, linting and commit-message
  rules only run in CI — after the mistake is already pushed.
- **What it is (dependency):** `husky` `^8.0.0`
- **What it does for us (owned capability):** Installing and running the
  `pre-commit`, `commit-msg`, `prepare-commit-msg`, and `pre-push` hooks in
  `.husky/`.
- **Why we believe it's safe (trust basis):** Trust class: **build/development
  tool** — developer machines only. Repository evidence: force-pinned in
  `package.lisa.json` and wired through the `prepare` script, so every governed
  project installs the same hook mechanism. Maintainer, cadence, and security
  history: `_Not yet decided_` (#1918).
- **What breaks if this is compromised (exposure):** Developer machines at
  install time. It runs during `prepare`/`postinstall` and can execute
  arbitrary commands on commit, which is precisely its job — so a compromised
  release runs with a developer's full local privileges.
- **What it would take to replace (replacement cost):** Low. The hooks are plain
  shell scripts in `.husky/`; another installer (or `core.hooksPath` set
  directly) would carry them.
- **What would catch a bad update (detection evidence):** Loud and immediate: if
  hook installation broke, commits would stop being linted. But that failure is
  *silent in the wrong direction* — a hook that never runs looks exactly like a
  clean commit. The CI quality workflow re-runs the same checks, which is the
  real backstop.
- **Who owns this and how often we recheck (owner / review cadence):**
  Repository owner (`CodySwannGT`) / cadence `_Not yet decided_` (#1918).
- **Last reviewed:** 2026-07-21

### standard-version

- **Why we keep it:** It decides the next version number and writes the
  changelog from the commit history, so releases are mechanical rather than
  someone's judgment call at 6pm.
- **What it is (dependency):** `standard-version` `^9.5.0`
- **What it does for us (owned capability):** Version bumping and changelog
  generation on the release path.
- **Why we believe it's safe (trust basis):** Trust class: **build/development
  tool**. Repository evidence: force-pinned in `package.lisa.json`, so the whole
  fleet releases the same way; the release path is covered by integration tests
  (`tests/integration/release-changelog-entry.test.ts` and neighbours).
  Maintainer status: `_Not yet decided_` (#1918) — and this is the entry where
  that gap matters most, because the version range has sat on a single major
  while the rest of the toolchain moved.
- **What breaks if this is compromised (exposure):** CI, on the release path,
  with publish credentials in scope. It does not run in the product, but it is
  adjacent to the step that pushes to npm.
- **What it would take to replace (replacement cost):** Moderate. Conventional-
  commit tooling is a well-populated space; the cost is re-wiring the release
  workflow and re-proving the changelog integration tests, not inventing
  anything.
- **What would catch a bad update (detection evidence):**
  `tests/integration/release-changelog-entry.test.ts`,
  `release-changelog-push-recovery.test.ts`, and
  `release-notes-expansion.test.ts` — these assert the changelog content the
  release actually produces, which is stronger than checking the tool ran.
- **Who owns this and how often we recheck (owner / review cadence):**
  Repository owner (`CodySwannGT`) / cadence `_Not yet decided_` (#1918).
- **Last reviewed:** 2026-07-21

### commander

- **Why we keep it:** It is the front door of the `lisa` command — it reads what
  the user typed and decides what to run. If it misbehaves, the product does not
  start.
- **What it is (dependency):** `commander` `^12.0.0`
- **What it does for us (owned capability):** Command-line argument parsing and
  subcommand dispatch for the published CLI (`src/index.ts`, `src/cli/`).
- **Why we believe it's safe (trust basis):** Trust class: **runtime-critical
  service client** — not because it touches money or personal data, but because
  it ships inside `dist/` and runs on other people's machines, and blast radius
  is what decides this class. Repository evidence for that classification:
  `package.json` `bin.lisa` points at `dist/index.js`, and the `bin_smoke` CI
  job asserts that entry point runs. Maintainer, cadence, and security history:
  `_Not yet decided_` (#1918). **Class requirement not currently met:** this
  class calls for exact version pinning and a named accountable person; the
  range is `^12.0.0` and the owner is a repository, not a person (#1918).
- **What breaks if this is compromised (exposure):** Runs on every machine that
  installs `@codyswann/lisa`, with that user's privileges, in a process that
  goes on to write files into their repository. No customer data, but full local
  reach.
- **What it would take to replace (replacement cost):** Moderate. Roughly five
  CLI modules define commands through it; the option and subcommand definitions
  would need re-expressing against another parser, but the command *logic* lives
  behind them and would not move.
- **What would catch a bad update (detection evidence):** The `bin_smoke` job in
  `.github/workflows/ci.yml` — it builds the package and asserts
  `node dist/index.js --version` works and that `--help` lists `setup-project`.
  Plus `tests/integration/cli-smoke.test.ts`. Honest limit: these prove the CLI
  parses and starts, not that every subcommand's flags still bind correctly.
- **Who owns this and how often we recheck (owner / review cadence):**
  Repository owner (`CodySwannGT`) / cadence `_Not yet decided_` (#1918).
- **Last reviewed:** 2026-07-21

### fs-extra

- **Why we keep it:** It is what physically writes Lisa's files into a user's
  project — copying templates, creating directories, replacing configuration. It
  is the hands of the product.
- **What it is (dependency):** `fs-extra` `^11.0.0`
- **What it does for us (owned capability):** All file-system reads, writes,
  copies, and directory operations performed against a host project (~41 source
  and script files).
- **Why we believe it's safe (trust basis):** Trust class: **runtime-critical
  service client** — it modifies other people's repositories in production.
  Repository evidence: force-pinned (with `@types/fs-extra`) in
  `package.lisa.json`; it is the single most widely imported dependency in the
  source tree. Maintainer, cadence, and security history: `_Not yet decided_`
  (#1918). **Class requirement not currently met:** exact pinning and a named
  accountable person (#1918).
- **What breaks if this is compromised (exposure):** The worst exposure in this
  file. It runs on user machines with that user's file-system privileges, and
  its whole purpose is to overwrite files in their repository. A malicious or
  merely buggy release could destroy uncommitted work across the fleet.
- **What it would take to replace (replacement cost):** Moderate, and worth
  knowing: most of what Lisa uses now exists in Node's own `node:fs/promises`.
  The cost is ~41 files of mechanical migration plus re-proving the copy and
  merge behaviours, not a redesign.
- **What would catch a bad update (detection evidence):**
  `tests/integration/lisa.test.ts`, which applies Lisa to a temporary project
  and asserts the resulting files — that is the check that actually exercises
  the capability rather than the library. The transaction and template unit
  suites under `tests/unit/` cover the rollback paths.
- **Who owns this and how often we recheck (owner / review cadence):**
  Repository owner (`CodySwannGT`) / cadence `_Not yet decided_` (#1918).
- **Last reviewed:** 2026-07-21

### js-yaml

- **Why we keep it:** Lisa reads and rewrites the YAML files that run other
  projects' automation — their CI workflows and agent configuration. This is the
  library that understands that format.
- **What it is (dependency):** `js-yaml` `^4.3.0`
- **What it does for us (owned capability):** Parsing and serializing YAML —
  governed CI workflows, agent command/skill frontmatter, and UI pipeline
  models.
- **Why we believe it's safe (trust basis):** Trust class: **runtime-critical
  service client** — it ships in `dist/` and rewrites files that decide whether
  a user's CI runs. Repository evidence: seven source and script files depend on
  it, including the transformers that generate Codex and OpenCode command
  surfaces. Maintainer, cadence, and security history: `_Not yet decided_`
  (#1918). **Class requirement not currently met:** exact pinning and a named
  accountable person (#1918).
- **What breaks if this is compromised (exposure):** Runs on user machines and
  writes their `.github/workflows/`. A parsing change that silently dropped a
  key would disable a security scan or a deploy gate in every governed
  repository, and the file would still look valid.
- **What it would take to replace (replacement cost):** Moderate. Alternatives
  exist (`yaml`), but round-trip fidelity — comments and formatting in generated
  workflow files — is the hard part and would need re-proving.
- **What would catch a bad update (detection evidence):**
  `tests/integration/quality-workflow.test.ts`,
  `failure-issue-workflows.test.ts`, and `maestro-native-workflow.test.ts`
  assert the content of generated workflow YAML, so a serialization regression
  fails a test rather than shipping.
- **Who owns this and how often we recheck (owner / review cadence):**
  Repository owner (`CodySwannGT`) / cadence `_Not yet decided_` (#1918).
- **Last reviewed:** 2026-07-21

### jsonc-parser

- **Why we keep it:** Agent settings files are JSON *with comments*. A normal
  JSON parser would either refuse them or throw the comments away; this one
  edits them in place, so a user's notes survive when Lisa updates their
  settings.
- **What it is (dependency):** `jsonc-parser` `^3.3.1`
- **What it does for us (owned capability):** Comment-preserving reads and edits
  of JSONC settings for the OpenCode harness (`src/opencode/hooks-installer.ts`,
  `mcp-installer.ts`, `settings-installer.ts`).
- **Why we believe it's safe (trust basis):** Trust class: **runtime-critical
  service client** — it edits configuration on user machines. Repository
  evidence: three installers depend on it; it is not in the fleet-wide `force`
  block, so it is a Lisa-repository choice rather than a governed fleet pin.
  Maintainer, cadence, and security history: `_Not yet decided_` (#1918).
- **What breaks if this is compromised (exposure):** Runs on user machines
  against their agent settings. A bad edit corrupts an OpenCode configuration —
  recoverable, but user-visible and confusing.
- **What it would take to replace (replacement cost):** Moderate. Standard JSON
  parsing is trivial; preserving comments and formatting on edit is the whole
  value, and hand-rolling that is not a small job.
- **What would catch a bad update (detection evidence):** The OpenCode installer
  unit suites under `tests/unit/opencode/`, which assert the resulting settings
  content.
- **Who owns this and how often we recheck (owner / review cadence):**
  Repository owner (`CodySwannGT`) / cadence `_Not yet decided_` (#1918).
- **Last reviewed:** 2026-07-21

### smol-toml

- **Why we keep it:** The Codex agent stores its configuration in TOML. This is
  what lets Lisa read that file to decide what already exists before changing
  anything.
- **What it is (dependency):** `smol-toml` `^1.6.1`
- **What it does for us (owned capability):** Reading TOML configuration for the
  Codex harness (`src/codex/agent-installer.ts`, `mcp-installer.ts`).
- **Why we believe it's safe (trust basis):** Trust class: **thin wrapper
  suitable for in-house ownership** — the surface we use is "parse a TOML file",
  and only three files use it. Repository evidence: not in the fleet `force`
  block; a Lisa-repository choice. Maintainer, cadence, adoption, and security
  history: `_Not yet decided_` (#1918). This class requires human ratification
  to *keep* rather than in-house — not yet given (#1918).
- **What breaks if this is compromised (exposure):** Runs on user machines,
  reading `~/.codex/config.toml`. Read-mostly, so its blast radius is smaller
  than the writer below it — but it is still outside CI.
- **What it would take to replace (replacement cost):** Low for reading —
  another TOML parser is a drop-in. Full in-housing of a correct TOML parser is
  not a day's work, which is what keeps this a dependency.
- **What would catch a bad update (detection evidence):** The Codex installer
  unit suites under `tests/unit/codex/`, plus
  `scripts/verify-learner-frontmatter-built.mjs` (`bun run
  verify:learner-frontmatter-built`).
- **Who owns this and how often we recheck (owner / review cadence):**
  Repository owner (`CodySwannGT`) / cadence `_Not yet decided_` (#1918).
- **Last reviewed:** 2026-07-21

### @decimalturn/toml-patch

- **Why we keep it:** When Lisa changes a Codex settings file, it must leave the
  user's own comments and formatting intact. This library edits TOML in place
  instead of rewriting it from scratch.
- **What it is (dependency):** `@decimalturn/toml-patch` `^1.1.1`
- **What it does for us (owned capability):** Comment-preserving in-place edits
  of Codex TOML settings (`src/codex/settings-installer.ts`).
- **Why we believe it's safe (trust basis):** Trust class: **thin wrapper
  suitable for in-house ownership**, and the weakest-evidenced entry in this
  file. Repository evidence: exactly one source file uses it; it is a scoped
  fork-style package with no fleet-wide governance pin. Maintainer, adoption,
  cadence, and security history: `_Not yet decided_` (#1918). Human ratification
  to keep it: not given (#1918). Of everything listed here, this is the one with
  the smallest crowd standing in front of us.
- **What breaks if this is compromised (exposure):** Runs on user machines and
  *writes* their `~/.codex/config.toml`. A corrupting update would damage a
  configuration file Lisa did not create and the user may not have backed up.
- **What it would take to replace (replacement cost):** Low to moderate. One
  call site. In-housing a narrow patcher for the specific keys Lisa sets is
  plausible; a general-purpose one is not.
- **What would catch a bad update (detection evidence):**
  `tests/unit/codex/settings-installer.test.ts` — the case *"preserves a host
  inline comment while overwriting the value via toml-patch"* feeds
  `project_doc_max_bytes = 1024  # keep this comment` (a value different from
  Lisa's 65536, which forces the toml-patch in-place update path) and asserts
  the output **both** carries Lisa's winning value **and still contains the
  host's `# keep this comment`**. A comment-dropping regression in this library
  now fails that named test instead of silently corrupting a user's config —
  the exact gap this entry used to record.
- **Who owns this and how often we recheck (owner / review cadence):**
  Repository owner (`CodySwannGT`) / cadence `_Not yet decided_` (#1918).
- **Last reviewed:** 2026-07-21

### lodash.merge

- **Why we keep it:** It combines Lisa's governed settings with a project's own
  settings, one nested level at a time. It is the mechanic behind the
  force/defaults/merge rules that decide whose value wins.
- **What it is (dependency):** `lodash.merge` `^4.6.2`
- **What it does for us (owned capability):** Deep object merging in
  `src/utils/json-utils.ts`, the shared helper behind `package.lisa.json`
  governance.
- **Why we believe it's safe (trust basis):** Trust class: **thin wrapper
  suitable for in-house ownership** — one call site, one function, and a deep
  merge is a well-understood piece of code. Repository evidence: force-pinned
  with `@types/lodash.merge` in `package.lisa.json`, so the fleet shares the
  merge semantics. Maintainer and cadence: `_Not yet decided_` (#1918) — the
  single-function lodash packages are long-stable but the release history has
  not been checked. Ratification to keep rather than in-house: not given
  (#1918).
- **What breaks if this is compromised (exposure):** Runs on user machines while
  rewriting their `package.json`. A change in merge semantics — arrays replaced
  instead of concatenated, say — would silently produce wrong manifests across
  the fleet, which is worse than a crash because it looks like a successful run.
- **What it would take to replace (replacement cost):** About a day. It is one
  function behind one helper, which is exactly why this class applies.
- **What would catch a bad update (detection evidence):**
  `tests/unit/utils/json-utils.test.ts` now pins the exact `deepMerge`
  semantics a bad `lodash.merge` update would silently break: override-wins on
  scalars, recursive merge of nested objects, and index-by-index array merging
  (`deepMerge({a:[1,2,3]},{a:[9]})` → `{a:[9,2,3]}`, which is neither array
  union nor wholesale replacement — the silent failure mode this entry warned
  about). Backed by `tests/integration/lisa.test.ts`, which asserts the merged
  `package.json` a real apply produces.
- **Who owns this and how often we recheck (owner / review cadence):**
  Repository owner (`CodySwannGT`) / cadence `_Not yet decided_` (#1918).
- **Last reviewed:** 2026-07-21

### semver

- **Why we keep it:** It compares version numbers correctly, which is how Lisa
  tells a user they are running an old release and whether an upgrade is a big
  one or a small one.
- **What it is (dependency):** `semver` `^7.8.1`
- **What it does for us (owned capability):** Version comparison for the CLI's
  update check (`src/cli/update-check.ts`).
- **Why we believe it's safe (trust basis):** Trust class: **mature ecosystem
  primitive** — it implements the published semantic-versioning specification,
  and effectively the whole npm ecosystem depends on it, so a bad release is
  found by others first. Repository evidence: one call site, `@types/semver`
  carried alongside. Maintainer, cadence, and security history:
  `_Not yet decided_` (#1918).
- **What breaks if this is compromised (exposure):** Runs on user machines, but
  only in the update-notification path. The realistic failure is a wrong or
  missing "you are out of date" message, not damage.
- **What it would take to replace (replacement cost):** Low. One call site; the
  comparison Lisa needs is narrow.
- **What would catch a bad update (detection evidence):** The update-check unit
  tests under `tests/unit/cli/`, which assert notification behaviour across
  version pairs.
- **Who owns this and how often we recheck (owner / review cadence):**
  Repository owner (`CodySwannGT`) / cadence `_Not yet decided_` (#1918).
- **Last reviewed:** 2026-07-21

### minimatch

- **Why we keep it:** It decides whether a file path matches a pattern like
  `**/*.test.ts`. Every "ignore these files" rule in Lisa runs through it.
- **What it is (dependency):** `minimatch` `^3.1.2`
- **What it does for us (owned capability):** Glob pattern matching for ignore
  rules (`src/utils/ignore-patterns.ts`).
- **Why we believe it's safe (trust basis):** Trust class: **mature ecosystem
  primitive**. Repository evidence, and this is the finding: the range is
  `^3.1.2`, a legacy major, while `package.json` `overrides`/`resolutions`
  separately pin `@isaacs/brace-expansion` and `brace-expansion` to modern
  versions — that is the security floor for this package's own dependency, set
  by hand. Whether staying on v3 is a decision or an oversight:
  `_Not yet decided_` (#1918). The class's review trigger — maintainership
  change or an unfixed advisory — should be treated as already partly fired
  here, since we are knowingly behind.
- **What breaks if this is compromised (exposure):** Runs on user machines while
  deciding which of their files Lisa touches. A matching regression means files
  are skipped, or files are modified that should have been left alone.
- **What it would take to replace (replacement cost):** Low to moderate. One
  module; Node's own `fs.glob` and `picomatch` are candidates, but the ignore
  semantics would need re-proving against the existing tests.
- **What would catch a bad update (detection evidence):** The ignore-pattern
  unit tests under `tests/unit/utils/`, plus
  `tests/integration/lisa.test.ts`, which asserts which files a real apply
  touches.
- **Who owns this and how often we recheck (owner / review cadence):**
  Repository owner (`CodySwannGT`) / cadence `_Not yet decided_` (#1918).
- **Last reviewed:** 2026-07-21

### @inquirer/prompts

- **Why we keep it:** It asks the setup questions — which stack, which tracker,
  which harness — and reads the answers. It is the only part of Lisa a person
  has a conversation with.
- **What it is (dependency):** `@inquirer/prompts` `^7.0.0`
- **What it does for us (owned capability):** Interactive terminal prompts
  during setup (`src/cli/prompts.ts`).
- **Why we believe it's safe (trust basis):** Trust class: **build/development
  tool** is tempting because it feels cosmetic, but it ships in `dist/` and runs
  on user machines, so the honest class is **runtime-critical service client**
  under the "take the lower-trust one" rule. Repository evidence: one module
  wraps every prompt, which is what keeps the coupling contained. Maintainer,
  cadence, and security history: `_Not yet decided_` (#1918).
- **What breaks if this is compromised (exposure):** Runs interactively on user
  machines and receives the answers that decide what Lisa writes. It does not
  handle secrets in Lisa's flows. A break makes setup unusable rather than
  destructive.
- **What it would take to replace (replacement cost):** Low. All prompts go
  through the single `src/cli/prompts.ts` boundary, so a swap is a rewrite of
  that file.
- **What would catch a bad update (detection evidence):**
  `tests/unit/cli/prompts.test.ts` — it mocks `@inquirer/prompts` and asserts
  that `InteractivePrompter`'s `promptOverwrite`, `confirmProjectTypes`, and
  `confirmDirtyGit` actually invoke the library's `select`/`confirm` and map
  their answers to the documented outputs (e.g. an `OverwriteDecision`), that
  `AutoAcceptPrompter` auto-accepts without ever prompting, and that
  `createPrompter` picks the interactive vs. auto-accept implementation by
  yes-mode and TTY. A break in the interactive path now fails a unit test
  instead of surfacing only when a human runs setup.
- **Who owns this and how often we recheck (owner / review cadence):**
  Repository owner (`CodySwannGT`) / cadence `_Not yet decided_` (#1918).
- **Last reviewed:** 2026-07-21
