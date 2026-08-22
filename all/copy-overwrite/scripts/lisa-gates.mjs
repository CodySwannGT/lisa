#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * The gate registry: what Lisa guarantees, and where each guarantee is proved.
 *
 * A **gate is a property**, not a tool. `gitleaks` is not a gate — *credential
 * leakage* is the gate, and gitleaks is one way to prove it. Catalogued as
 * tools, one guarantee appears three times under three names and nobody can see
 * that a fourth is missing; catalogued as properties, "which guarantees rest on
 * a single mechanism" has an answer.
 *
 * **Lisa owns the vocabulary; the project owns the implementation.** Lisa says
 * "prove credential leakage"; the project says what that means by naming one of
 * its own tasks. Swapping gitleaks for trufflehog changes one line of project
 * config and nothing in Lisa.
 *
 * ## One axis: the moment
 *
 * A gate declares *when* it runs. Not *where* — the surface a session is on is
 * detected, not declared, and asking someone to restate it in config is how you
 * end up with `local`/`remote` in one subsystem and five real surfaces in
 * another. What a gate needs in order to run is expressed as `needs`, and the
 * surface falls out of wherever that moment happens to occur.
 *
 * ## Two proof modes
 *
 * `run` executes a task and reads its exit code. `await` watches for an
 * external signal — a review bot, a SAST service — and reads its verdict. Which
 * applies is the project's choice, not the gate's: Snyk can be a CLI you run or
 * an app that reports. A gate may use different modes at different moments,
 * which is the normal shape for code review: an agentic review before push, a
 * bot on the pull request.
 *
 * ## Green is not proof
 *
 * The defect this design is organised against is a check reporting satisfied
 * without having proved anything. It has two forms and both are handled here.
 *
 * A required `CodeRabbit` context posted `success` with the description
 * "Review rate limited", having reviewed nothing, on two security-relevant pull
 * requests that then merged. That is the `await` form, caught by description.
 *
 * `passWithNoTests: true` USED TO ship in five stack configs, so a unit-test
 * gate could report green having run zero tests. That is the `run` form, caught
 * by a work count. No description is involved and no vendor is at fault.
 *
 * That flag is gone as of #2603 — from the configs AND from the six
 * `--passWithNoTests` CLI arguments in four package templates, which overrode
 * the configs and were the channel most consumers actually ran. The example is
 * kept in the past tense rather than deleted: it is the clearest instance of
 * the `run` form anyone has produced, and a reader needs to know what shape to
 * look for, not merely that one instance was fixed.
 *
 * The response is configurable, with one exception. You may configure whether
 * to stop; you may not configure it into having been proved. A hollow result is
 * recorded as unproved in every mode, or `on_hollow: report` becomes a way to
 * launder an unreviewed merge.
 * @module lisa-gates
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** Enforcement levels a moment may carry. */
export const LEVELS = ["required", "optional", "off"];

/** What to do when a gate reports success without evidence of work. */
export const HOLLOW_RESPONSES = ["report", "wait", "block"];

// Moment names, named once. They appear in a dozen moment lists below; a
// literal repeated that many times is one typo away from a gate that silently
// never runs, and there is no test that can tell "gate not configured for this
// moment" from "moment misspelled".
const SESSION_START = "session-start";
const PRE_TOOL = "pre-tool";
const COMMIT = "commit";
const PUSH = "push";
const PULL_REQUEST = "pull-request";
const PRE_DEPLOY = "pre-deploy";
const POST_DEPLOY = "post-deploy";
const CONTINUOUS = "continuous";

/** Fixed moments. Two more families take an environment suffix. */
export const MOMENTS = [SESSION_START, PRE_TOOL, COMMIT, PUSH, PULL_REQUEST];

/** Moment families that take an `:<environment>` suffix. */
export const MOMENT_FAMILIES = [PRE_DEPLOY, POST_DEPLOY, CONTINUOUS];

/**
 * Moments that gate a *state* rather than a change.
 *
 * Every other moment blocks a diff: the commit, the push, the merge, the
 * deploy. A continuous gate has no diff to block — it runs on a schedule
 * against a stable target, and by the time it fails whatever it covered merged
 * hours ago. What it establishes is whether that target is healthy, and the
 * enforcement point is therefore *promotion out of it*: a red
 * `continuous:staging` means staging is not promotable, which a
 * `pre-deploy:production` gate can require.
 *
 * TASC SI9 requires this directly for generated testing — confining generation
 * to the per-change gate explores far less of the input space than generating
 * new cases against a stable one. It applies equally to a CVE published today,
 * which makes yesterday's dependency scan wrong with no change at all.
 */
export const STATE_FAMILIES = [CONTINUOUS];

/** Keys on a gate entry that are settings rather than moments. */
export const GATE_FIELDS = new Set(["run", "needs", "task"]);

/**
 * Registry flag: this gate's task may rewrite the working tree.
 *
 * It exists to order execution, because a gate that rewrites files invalidates
 * every verdict already reached about them. Measured, not theorised: gates run
 * alphabetically, so `artifact-freshness` proved a generated manifest current,
 * `code-style` then ran `lint:staged` and prettier reformatted the very sources
 * that manifest hashes, and the commit landed with a manifest describing bytes
 * that no longer existed. The freshness gate reported PASSED about a tree that
 * was not the tree committed — the organising defect in a new costume.
 *
 * So rewriters sort ahead of verifiers, and every verdict afterwards describes
 * the bytes that actually ship.
 *
 * The flag is deliberately *may*, and deliberately registry-only. A project can
 * point `format-conformance` at `format:check` (which rewrites nothing) or at
 * `format` (which rewrites everything), and Lisa cannot tell which from here.
 * Ordering a non-rewriter early costs nothing — order among independent gates
 * was already arbitrary — while missing a real rewriter costs a false pass.
 * Asking projects to declare it would put the safe answer in the hands of
 * whoever remembers to type it, which is how the defect got here.
 */

/**
 * Registry flag: this gate's task costs minutes, not seconds.
 *
 * It exists so that a run which is already blocked can keep going without
 * doubling the cost of a failing push. When a required gate failed, the runner
 * used to stop dead and print every later gate as not-run — which is how one
 * intermittent test failure took the work-item check and the type check down
 * with it, both of which finish in well under a minute and answer questions
 * that have nothing to do with a test suite. Continuing into those is nearly
 * free and tells the operator everything that is wrong in one attempt instead
 * of one thing per attempt. Continuing into a second full suite is not free,
 * and buys information about a push that cannot land regardless.
 *
 * Registry-only, for the same reason `mayRewrite` is. The safe answer must not
 * depend on whoever remembers to type it, and Lisa knows which of its own
 * canonical gates run a whole suite. A project that points `test-correctness`
 * at something fast loses nothing: the flag only ever suppresses a gate on a
 * run that is already blocked.
 */

/** Prefix marking a gate, or a config key, that this project invented. */
export const CUSTOM_PREFIX = "x-";

const COMMIT_ONWARD = [COMMIT, PUSH, PULL_REQUEST, PRE_DEPLOY, POST_DEPLOY];
const PUSH_ONWARD = [PUSH, PULL_REQUEST, PRE_DEPLOY, POST_DEPLOY];
const PR_ONWARD = [PULL_REQUEST, PRE_DEPLOY, POST_DEPLOY];
const DEPLOY_ONLY = [PRE_DEPLOY, POST_DEPLOY, CONTINUOUS];
const SESSION_ONWARD = [SESSION_START, ...COMMIT_ONWARD];

/**
 * Lisa's canonical gates.
 *
 * `label` is the CI job name and it is load-bearing: a repository ruleset names
 * required checks by exact string, so this is what a branch-protection context
 * is built from.
 *
 * `moments` is the closed set of places a gate may legally be declared. It
 * exists to make wrong configurations unrepresentable rather than merely
 * discouraged: type-aware lint at commit needs a whole-project build, and a
 * DAST scan at commit has nothing deployed to point at.
 *
 * `work` names what a nonzero count proves, for gates that can otherwise
 * succeed having done nothing.
 *
 * `task` is the default prover, and `taskAt` overrides it for one moment
 * family. Most gates need only `task`: `typecheck` is `typecheck` wherever it
 * runs. A gate needs `taskAt` when the same property is proved by a different
 * command at a different moment — the shape the design doc already calls
 * normal for a project's own `run` declarations, here as a shipped default so
 * that declaring the gate at that moment cannot silently resolve to a prover
 * that cannot run there.
 *
 * `task` names the CONCERN, never the vendor — `test:e2e`, not
 * `test:playwright`. That is deliberate and load-bearing: a project swapping
 * one tool for another must not have to edit this registry, and a gate label
 * built from it must not turn a tool swap into a branch-protection migration.
 * The cost is that the concern name is frequently NOT the name a template
 * ships, and until `declareOnly` existed nothing said so.
 *
 * Measured 2026-08-21, resolving each stack the way `PackageLisaStrategy` does
 * (parent template, then child), across all seven npm stacks: of 35 default
 * tasks **11 resolved on every stack, 1 resolved on a single stack, and 23
 * resolved on none**. Seven of those 23 have had a working prover the whole
 * time under a name of the vendor's: `test:cov`, `knip:check`, `sg:scan`,
 * `lighthouse:check`, `maestro:test`, `k6:load`, `security:zap`. Declaring any
 * of those gates fails as `Missing script` in the consumer's CI, with nothing
 * pointing at the prover sitting beside it.
 *
 * So the fix is NOT to rename the defaults to those vendor scripts — that
 * would buy one release of convenience by giving up the property above. It is
 * to make the gap first-class:
 *
 * - `declareOnly` is present exactly when `task` does not resolve on every npm
 *   stack, and says what to do about it.
 * - `shippedAs` names the script a template already ships for that concern,
 *   where one exists, so an operator can point `run:` straight at it.
 *
 * `shippedAs` is RESOLVED THROUGH, not merely documented — see `resolveMoment`.
 * Recording the alias and then never reading it (#2916) left the registry
 * knowing, in machine-readable form, that a working prover sat in the
 * consumer's own `package.json`, while every operator surface still resolved to
 * the concern name and failed as `Missing script`. The fallback fires only when
 * the concern-named script is genuinely absent and the alias is genuinely
 * present, so it can never widen what resolves: the concern name stays the
 * gate's identity, its label, and its first choice.
 *
 * The ABSENCE of `declareOnly` is therefore a claim, and
 * `tests/unit/config/gate-default-tasks-resolve.test.ts` enforces it in both
 * directions: a gate without the field must resolve on every npm stack, and a
 * gate with it must genuinely fail somewhere. The second half is what retires
 * an exception once its prover ships, instead of leaving a stale excuse.
 */
export const REGISTRY = Object.freeze({
  "code-style": {
    label: "🧹 Lint",
    summary: "Code conforms to the project's lint rules.",
    task: "lint",
    moments: COMMIT_ONWARD,
    mayRewrite: true,
  },
  "code-style-slow": {
    label: "🐢 Slow Lint Rules",
    summary: "Type-aware lint rules pass.",
    task: "lint:slow",
    moments: PUSH_ONWARD,
  },
  "format-conformance": {
    label: "📐 Check Formatting",
    summary: "Files match the project's formatter.",
    task: "format:check",
    moments: COMMIT_ONWARD,
    mayRewrite: true,
  },
  "type-correctness": {
    label: "🔍 Type Check",
    summary: "The project compiles.",
    task: "typecheck",
    moments: PUSH_ONWARD,
  },
  "build-integrity": {
    label: "🏗️ Build",
    summary: "The project builds.",
    task: "build",
    moments: PUSH_ONWARD,
  },
  "test-correctness": {
    label: "🧪 Run Unit Tests",
    summary: "The unit suite passes.",
    task: "test:unit",
    moments: PUSH_ONWARD,
    work: "tests run",
    costly: true,
  },
  "test-node-suites": {
    label: "🧪 Run .mjs Suites",
    summary: "The `*.test.mjs` suites pass.",
    task: "test:node",
    moments: PUSH_ONWARD,
    work: "suites collected",
  },
  "test-integration": {
    label: "🧪 Run Integration Tests",
    summary: "The integration suite passes.",
    task: "test:integration",
    moments: PUSH_ONWARD,
    work: "tests run",
    costly: true,
  },
  "test-meaningfulness": {
    label: "🧬 Mutation Testing Gate",
    summary: "Tests fail when the code they cover is wrong.",
    task: "test:mutation",
    moments: PR_ONWARD,
    work: "mutants generated",
    costly: true,
  },
  "coverage-adequacy": {
    label: "✅ Verification Coverage",
    summary: "What must be proved is covered by something that runs.",
    task: "test:coverage",
    shippedAs: "test:cov",
    declareOnly:
      "Every npm stack ships `test:cov`, which proves this. The default keeps the concern's name rather than that spelling, so a project without a `test:coverage` script resolves through `test:cov` automatically; add `test:coverage`, or name a `run:` of your own, to take that back.",
    moments: PUSH_ONWARD,
    work: "files measured",
    costly: true,
  },
  "e2e-browser": {
    label: "🎭 Playwright E2E Tests",
    summary: "Browser journeys pass end to end.",
    task: "test:e2e",
    declareOnly:
      "Only the phaser stack ships a browser e2e runner under this name. Elsewhere, point `run:` at your own suite.",
    moments: [...PR_ONWARD, CONTINUOUS],
    work: "specs run",
    costly: true,
  },
  "e2e-native": {
    label: "📱 Maestro Native E2E",
    summary: "Native device journeys pass end to end.",
    task: "test:e2e:native",
    shippedAs: "maestro:test",
    declareOnly:
      "Only the expo stack ships a prover, as `maestro:test`, which an expo project resolves through automatically. Elsewhere, point `run:` at your own device suite — nothing else proves this.",
    moments: [...PR_ONWARD, CONTINUOUS],
    work: "flows run",
    costly: true,
  },
  // ---------------------------------------------------------------------
  // Environment facade. Lisa defines and enforces the interface; each project
  // supplies what happens behind it. Lisa ships NO implementation, so a
  // project declaring one of these without an adapter gets a red gate rather
  // than a silent pass — measured: a required gate whose npm script is absent
  // exits 1.
  //
  // THE TASK IS THE VERIFY, NOT THE RESET, and that is a safety property
  // rather than a naming preference. `environment:reset` is a PRECONDITION a
  // workflow calls before a suite; if it were the gate's task, declaring the
  // gate `required` at pull-request would converge a shared environment on
  // every pull request. That hazard is not hypothetical — acmeorgd/frontend
  // already runs an unconditional reset job that is destructive to shared dev
  // data on every invocation.
  //
  // `environment:reset:verify` is safe to run anywhere precisely because it
  // exercises only the REFUSAL path: it calls the reset entry point directly,
  // outside the project's own client, against a target the guard must reject,
  // and fails if the call succeeds. That distinguishes a server-side guard
  // from a client-side one by behaviour alone, without Lisa knowing anything
  // about the implementation — which is what the facade requires. A guard the
  // caller can edit is not one guard location.
  "environment-reset": {
    label: "♻️ Environment Reset Guard",
    summary:
      "The environment reset exists, and its guard cannot be bypassed by calling it directly.",
    task: "environment:reset:verify",
    declareOnly:
      "The reset adapter is project-specific. The CI job reports that none is declared rather than failing, so this gate is opt-in by design.",
    moments: [...PR_ONWARD, CONTINUOUS],
    work: "refusals proved",
  },
  "environment-reseed": {
    label: "🌱 Environment Reseed Guard",
    summary:
      "The environment reseed exists, and its guard cannot be bypassed by calling it directly.",
    task: "environment:reseed:verify",
    declareOnly:
      "The reseed adapter is project-specific. The CI job reports that none is declared rather than failing, so this gate is opt-in by design.",
    moments: [...PR_ONWARD, CONTINUOUS],
    work: "refusals proved",
  },
  // ---------------------------------------------------------------------
  // Properties that were enforced before they were named. Each of the three
  // had a `quality.yml` job doing real work, a project-owned knob for HOW
  // STRICTLY to judge, and no vocabulary at all for WHETHER to judge — so the
  // only control was a `skip_jobs` token, and `lisa doctor` pushing a project
  // off `skip_jobs` onto `gates` took the control away rather than migrating
  // it. Naming them is what closes that.
  //
  // Each `label` is the exact string its job already posts. That is not a
  // formality: `contextsFor()` derives `🔍 Quality Checks / <label>`, so a
  // label that differs from the job name by one character derives a required
  // context nothing ever posts, and declaring the gate `required` blocks every
  // pull request forever. Four gates already carry that divergence and none of
  // these three may join them.
  "journey-coverage": {
    label: "🧭 E2E Route Coverage",
    summary: "Enough of the app's screens are reached by an end-to-end test.",
    task: "test:e2e:coverage",
    declareOnly:
      "The prover ships as `scripts/check-e2e-coverage.mjs` on the expo stack and no template installs a script for it. Point `run:` at a task that invokes it, or at your own route-coverage report.",
    // Deliberately independent of `e2e-browser` and `e2e-native` rather than
    // implied by them. Those answer "did the suites pass"; this answers "how
    // much of the app the suites touch", and it can fail with every suite
    // green. It is the same distinction `coverage-adequacy` already draws
    // against `test-correctness`, so declaring a runner `off` does not
    // silently switch this off with it.
    moments: PR_ONWARD,
    work: "routes measured",
  },
  "state-classification": {
    label: "🧬 State Classification",
    summary:
      "Every persistent entity carries a reset policy, and every fixture-owned entity has something that sweeps it.",
    task: "check:state-classification",
    declareOnly:
      "The prover ships as `scripts/check-state-classification.mjs` and no template installs a script for it. Point `run:` at a task that invokes it, or at your own inventory comparison.",
    // Not folded into the environment facade above, though it sits in the same
    // family. Those two prove a GUARD REFUSES; this proves an INVENTORY IS
    // COMPLETE, and it can fail while both guards are perfect. Commit-onward
    // because it is a static comparison of an inventory against a contract and
    // needs no environment to run against.
    moments: COMMIT_ONWARD,
    work: "entities classified",
  },
  "security-floor-integrity": {
    label: "🧱 Security Floor Collisions",
    summary:
      "A minimum-safe-version pin the project set for a vulnerable package has not been erased by the package manager.",
    task: "check:security-floors",
    declareOnly:
      "The prover ships as `scripts/lisa-floor-collisions.mjs` and no template installs a script for it. Point `run:` at a task that invokes it.",
    // Distinct from `dependency-vulnerability`, and the job's own comment says
    // why: that one asks the advisory database whether a version is
    // vulnerable, over the network; this asks the manifest whether a pin
    // survived the last install, offline. Staying offline is the point — a
    // structural question about the manifest cannot be allowed to go quiet
    // when a network call fails. Commit-onward: it is a manifest read, cheap
    // enough for a hook.
    moments: COMMIT_ONWARD,
    work: "overrides examined",
  },
  "generative-testing": {
    label: "🎲 Generative Testing",
    summary:
      "Invariants hold against generated inputs, not just imagined ones.",
    task: "test:property",
    declareOnly:
      "No stack ships a property-testing framework. Point `run:` at whichever one this project adopts.",
    // Continuous is the point, not an option. TASC SI9: "at equal compute,
    // re-running one suite against every change explores far less of the input
    // space than generating new cases against a stable one." A property suite
    // pinned to the per-change gate re-walks the same ground forever.
    moments: [...PR_ONWARD, CONTINUOUS],
    work: "cases generated",
    costly: true,
  },
  "structural-rules": {
    label: "🔎 AST Grep Scan",
    summary: "Structural rules lint cannot express are respected.",
    task: "lint:structural",
    shippedAs: "sg:scan",
    declareOnly:
      "Every npm stack ships `sg:scan`, which proves this and which a project without a `lint:structural` script resolves through automatically. CI's fallback runs it directly, and the pre-commit hook proves the same property through lint-staged.",
    // Commit-legal, corrected from push-onward against the evidence:
    // `.lintstagedrc.json` already runs `ast-grep scan` on staged files at
    // commit time. Declaring it push-onward made an enforcement that
    // demonstrably happens unrepresentable in config — a registry that
    // disagrees with the repository is worse than one that is merely
    // permissive, because it silently discards a real gate.
    moments: COMMIT_ONWARD,
    work: "rules loaded",
  },
  "dead-code": {
    label: "🗑️ Dead Code Detection",
    summary: "No unused exports or dependencies.",
    task: "check:dead-code",
    shippedAs: "knip:check",
    declareOnly:
      "Every npm stack ships `knip:check`, which proves this and which a project without the concern-named script resolves through automatically. CI's fallback runs it directly (and falls back again to the older `knip`), so the property is proved today whether or not the concern-named script exists.",
    moments: PUSH_ONWARD,
  },
  "credential-leakage": {
    label: "🔐 Credential Leakage",
    summary: "No secret enters the repository, an artifact, or a log.",
    task: "security:check-for-leaks",
    declareOnly:
      "Proved by the gitleaks binary in the pre-commit built-in and by a hosted scanner in CI. Neither is a package script.",
    moments: COMMIT_ONWARD,
  },
  "dependency-vulnerability": {
    label: "🔒 Security Scan",
    summary: "No known high or critical advisory in shipped dependencies.",
    task: "security:audit",
    declareOnly:
      "The prover is the package manager's own `audit`, which CI invokes natively alongside an exclusion list. There is no script form to ship.",
    // Continuous matters most here: a CVE published today makes yesterday's
    // green wrong with no change to trigger a re-scan.
    moments: [...PUSH_ONWARD, CONTINUOUS],
    work: "manifests scanned",
  },
  "static-security": {
    label: "🔍 Static Security Analysis",
    summary: "Static analysis finds no security defect.",
    task: "security:sast",
    declareOnly:
      "Proved by a hosted analyzer in CI. There is no local prover to ship.",
    moments: [...PR_ONWARD, CONTINUOUS],
    work: "files analysed",
  },
  "runtime-web-vulnerability": {
    label: "🕷️ DAST Baseline",
    summary: "The running application passes a baseline dynamic scan.",
    task: "security:dast",
    shippedAs: "security:zap",
    declareOnly:
      "Only the expo and nestjs stacks ship a prover, as `security:zap`, which those projects resolve through automatically. Elsewhere, point `run:` at whatever scans your running application — nothing else proves this.",
    moments: DEPLOY_ONLY,
    work: "URLs scanned",
  },
  "license-compliance": {
    label: "📜 Licence Check",
    summary: "Every dependency licence is permitted.",
    task: "security:licenses",
    declareOnly:
      "Proved by a hosted licence scanner in CI. There is no local prover to ship.",
    moments: PR_ONWARD,
  },
  "code-review": {
    label: "👁️ Code Review",
    summary: "The change was reviewed by something that read it.",
    task: "review:local",
    declareOnly: "The prover is an agent skill, not a package script.",
    moments: [PUSH, PULL_REQUEST],
  },
  "performance-budget": {
    label: "⚡ Performance Budget",
    summary: "Pages stay inside their performance budget.",
    task: "perf:check",
    shippedAs: "lighthouse:check",
    declareOnly:
      "Only the expo stack ships a prover, as `lighthouse:check`; an expo project resolves through it automatically and CI's fallback runs it directly. Elsewhere, point `run:` at whatever measures your pages.",
    // Widened from DEPLOY_ONLY. The measurement was already running in CI on
    // every consumer — through a standalone `lighthouse.yml`, outside the
    // registry, with no level and therefore no way to declare it `off`. A
    // check a project cannot decline is not a gate, it is a fixture.
    //
    // `push` is included so a project CAN run it pre-push, not because it
    // should by default: the suite builds a web bundle and drives a browser,
    // which is minutes, and paying that on every push is a poor trade. Ship it
    // declared `off` at push and `optional` at pull-request — present, visible,
    // declinable, and blocking nothing until a project decides otherwise.
    moments: [...PUSH_ONWARD, CONTINUOUS],
    work: "pages measured",
  },
  "load-capacity": {
    label: "📈 Load Capacity",
    summary: "The service holds up under its expected load.",
    task: "perf:load",
    shippedAs: "k6:load",
    declareOnly:
      "Only the nestjs stack ships a prover, and it ships several tiers — `k6:smoke`, `k6:load`, `k6:soak`, `k6:stress`, `k6:spike`. Which tier is the budget is a project decision: absent a `run:`, this resolves through `k6:load` because that is the tier whose name matches the concern, so point `run:` at another tier to mean a different one.",
    moments: DEPLOY_ONLY,
    work: "requests issued",
    costly: true,
  },
  accessibility: {
    label: "♿ Accessibility",
    summary: "Pages meet the declared accessibility standard.",
    task: "a11y:check",
    declareOnly:
      "No stack ships an accessibility runner. Point `run:` at whichever one this project adopts.",
    moments: DEPLOY_ONLY,
    work: "pages audited",
  },
  traceability: {
    label: "🔗 Work-Item Traceability",
    summary: "Every change is bound to a live tracker item.",
    task: "check:work-item",
    // The property is one property; the prover is not one prover. At
    // pull-request there is a pull request to read — a body, a backlink, a
    // number — and `validate-pr` reads it. At push there is often no pull
    // request at all, and the check that exists there reads the commits being
    // pushed off stdin, which `validate-pr` cannot do and refuses to fake.
    // Handing `check:work-item` to the push moment would run the pull-request
    // prover with no pull request and fail every first push of a branch.
    taskAt: { [PUSH]: "check:work-item:push" },
    // Push, because the pre-push hook has validated work items on every push
    // since long before this registry existed. It was declared PR-only, so the
    // hook could not resolve it and hardcoded the call instead: the last gate
    // in either hook that ran outside the façade, unconditional and immune to
    // its own declaration, exactly as the CI job was until #2680.
    moments: [PUSH, PULL_REQUEST],
  },
  "commit-conformance": {
    label: "📝 Commit Message",
    summary: "Commit messages follow the declared convention.",
    task: "check:commit-msg",
    declareOnly:
      "Proved by the commit-msg hook running commitlint against one message file. There is no repo-wide script form.",
    moments: COMMIT_ONWARD,
  },
  "threshold-monotonicity": {
    label: "📐 Threshold Ratchet",
    summary: "Quality thresholds may tighten, never loosen.",
    task: "check:thresholds",
    declareOnly:
      "The prover ships as a plugin hook (`threshold-ratchet.mjs`), not as a package script.",
    moments: PUSH_ONWARD,
  },
  "artifact-freshness": {
    label: "🧾 Generated Artifacts",
    summary: "Generated files match the source they describe.",
    task: "check:artifacts",
    declareOnly:
      "Which files are generated is project-specific. Lisa's own prover checks Lisa's own artifacts and would answer nothing useful elsewhere.",
    moments: COMMIT_ONWARD,
  },
  "conflict-residue": {
    label: "🩹 Conflict Markers",
    summary: "No leftover merge-conflict markers in tracked files.",
    task: "check:conflict-markers",
    moments: COMMIT_ONWARD,
  },
  "version-duplication": {
    label: "🧮 Duplicate Versions",
    summary: "One declared version per dependency.",
    task: "check:duplicate-versions",
    declareOnly:
      "A prover exists in Lisa's own `scripts/` and is not shipped to consumers. Exposing it is separate work; until then, point `run:` at your own.",
    moments: COMMIT_ONWARD,
  },
  "credential-availability": {
    label: "🔑 Credential Readiness",
    summary: "Every credential the work needs resolves before work is claimed.",
    task: "readiness:secrets",
    declareOnly: "Which credentials the work needs is project-specific.",
    moments: SESSION_ONWARD,
  },
  "tool-availability": {
    label: "🧰 Tooling Readiness",
    summary: "Every CLI the work needs is present at its required version.",
    task: "readiness:tools",
    declareOnly: "Which CLIs the work needs is project-specific.",
    moments: SESSION_ONWARD,
  },
});

/**
 * Every `quality.yml` job that resolves through the gate façade, and its gate.
 *
 * This table and the two below exist so that the answer to "which gate replaces
 * this `skip_jobs` token" can be read in a CONSUMER. It could not be, before:
 * the pairs lived in one of Lisa's own test fixtures, which no consumer
 * installs, so `lisa doctor` running in a caller repository and an agent working
 * in a caller checkout both had nothing authoritative to consult.
 *
 * Eleven of the pairs cannot be recovered by transforming the name — `lint` is
 * `code-style`, `sg_scan` is `structural-rules`, `work_item_traceability` is
 * `traceability`. An underscore-to-hyphen guess gets a minority of them right,
 * and being wrong here does not break a build: it declares the WRONG gate
 * `off`, so a check silently stops running while the configuration reads
 * deliberate. That is why this ships as data rather than as advice.
 *
 * It is STATIC on purpose. A consumer holds no copy of `quality.yml` — it calls
 * the reusable workflow by ref — so the table cannot be derived where it is
 * read. `tests/integration/quality-gate-skip-jobs-mapping.test.ts` derives it
 * from the workflow in the one repository that has the workflow and fails when
 * the two disagree, which is what keeps a static copy true.
 */
export const QUALITY_JOB_GATES = Object.freeze({
  lint: "code-style",
  lint_slow: "code-style-slow",
  typecheck: "type-correctness",
  verification_coverage: "coverage-adequacy",
  test_unit: "test-correctness",
  test_mutation: "test-meaningfulness",
  test_integration: "test-integration",
  // Declared in `playwright-e2e.yml` rather than `quality.yml` since the
  // browser suite became a workflow of its own. The job kept its id, its
  // context name and its façade, so the pairing is unchanged and stays here:
  // the question this table answers is "which gate governs this job", and the
  // answer does not depend on which file the job is written in.
  playwright_e2e_aggregate: "e2e-browser",
  format: "format-conformance",
  build: "build-integrity",
  work_item_traceability: "traceability",
  performance_budget: "performance-budget",
  test_node_suites: "test-node-suites",
  environment_reset: "environment-reset",
  environment_reseed: "environment-reseed",
  dead_code: "dead-code",
  conflict_markers: "conflict-residue",
  sg_scan: "structural-rules",
  npm_security_scan: "dependency-vulnerability",
  threshold_ratchet: "threshold-monotonicity",
  e2e_coverage: "journey-coverage",
  state_classification: "state-classification",
  floor_collisions: "security-floor-integrity",
  // These four could not be wired until their jobs were renamed onto their
  // gates' labels. `contextsFor()` derives `🔍 Quality Checks / <label>`, and
  // while each job posted a different string, declaring the gate `required`
  // derived a context nothing ever posts and blocked the pull request forever.
  // The façade was never the missing piece — adding it would have armed that.
  secret_scanning: "credential-leakage",
  license_compliance: "license-compliance",
  maestro_e2e: "e2e-native",
  sonarcloud: "static-security",
});

/**
 * Jobs a `skip_jobs` token suppresses that no registry gate governs, and why.
 *
 * The gap this closes is not that the jobs are ungoverned — it is that nothing
 * SAID SO anywhere a consumer could read. `list`, `validate`, `contextsFor`
 * and `lisa doctor` all read the registry, so a property the registry does not
 * name is reported by none of them, and a project reads as fully governed
 * while several jobs enforce beneath the floor. `gateForSkipJob` returns
 * `unmappable` for these — a correct refusal, but a refusal with nothing on
 * the other side of it.
 *
 * An entry here is an EXEMPTION WITH A REASON, not a placeholder, and it is
 * what `tests/integration/quality-ungated-jobs.test.ts` accepts in place of a
 * `QUALITY_JOB_GATES` row. A job that is in neither table fails that test, so
 * the gap cannot regrow in silence — which is the only property that survives
 * the individual entries being retired one by one.
 *
 * `owner` is the issue that decides the question, so the exemption carries its
 * own expiry rather than becoming permanent by inattention.
 */
export const UNGATED_QUALITY_JOBS = Object.freeze({
  bdd_coverage: Object.freeze({
    reason:
      "The job already has a three-state adoption control, `bdd_mode` (not-adopted / bootstrap / enforced), passed as a workflow input. The registry has three levels (off / optional / required). Whether those are the same three states — and therefore whether `bdd_mode` should collapse into the declaration, or whether `bootstrap` is a genuine fourth level the registry has to grow — is a decision that affects every gate, not this one.",
    owner: "#2930",
  }),
  learnings_budget: Object.freeze({
    reason:
      "The property is enforced in three workflows and the skip token reaches two of them. The third runs the same command inside a context that is REQUIRED on this repository's ruleset, so a gate that governed only the two would be the same defect one layer up: a declaration satisfied in one workflow and ignored in another.",
    owner: "#2932",
  }),
  skipped_required_checks: Object.freeze({
    reason:
      "A meta-gate: it governs the governance rather than the software, alongside `gate_config_validity`, which is deliberately exempt for the same reason. Declaring it `off` would mean 'I may silence a required check without anyone objecting', which is close to self-defeating, so whether it should be declarable at all is an owner ruling and not an implementation gap.",
    owner: "#2933",
  }),
  snyk: Object.freeze({
    reason:
      "Which property this job certifies is undecided. It is a dependency scanner, but `dependency-vulnerability` is already posted by `npm_security_scan` under a context that is required on this repository's ruleset, so two jobs would post one name.",
    owner: "#2830",
  }),
  zap_baseline: Object.freeze({
    reason:
      "`runtime-web-vulnerability` names the property, but its legal moments are deploy-only, so there is no declaration a caller can write at pull-request — where this job runs.",
    owner: "#2832",
  }),
});

/**
 * Every `skip_jobs` token `quality.yml` honours or advertises, and the jobs it
 * suppresses.
 *
 * Keyed by TOKEN, not by job id, because the two differ and the difference is
 * invisible from either side: the token is `test:unit` and the job is
 * `test_unit`, so a table keyed on job ids answers "no such token" for three of
 * the tokens that do have gates.
 *
 * An empty array is a real entry, not a placeholder. `github_issue` is
 * advertised by the input's own description and honoured by no job at all — it
 * suppresses nothing today, which a consumer deleting it deserves to be told
 * rather than left to infer from a check that never changed.
 */
export const SKIP_JOB_TOKENS = Object.freeze({
  lint: Object.freeze(["lint"]),
  lint_slow: Object.freeze(["lint_slow"]),
  typecheck: Object.freeze(["typecheck"]),
  e2e_coverage: Object.freeze(["e2e_coverage"]),
  state_classification: Object.freeze(["state_classification"]),
  bdd_coverage: Object.freeze(["bdd_coverage"]),
  learnings_budget: Object.freeze(["learnings_budget"]),
  "test:unit": Object.freeze(["test_unit"]),
  "test:mutation": Object.freeze(["test_mutation"]),
  "test:integration": Object.freeze(["test_integration"]),
  // Empty because `test_e2e` is no longer a job in `quality.yml`. The browser
  // suite belongs to `playwright-e2e.yml`, whose `playwright_e2e_aggregate`
  // resolves the `e2e-browser` gate; the `quality.yml` job was the leftover half
  // of that migration — ungoverned, and green on any project without the script.
  //
  // The KEY stays. Every project built from the Expo and NestJS templates passes
  // `skip_jobs: 'test:e2e,…'`, and a token with no entry here is reported as
  // `undeclared_skip_token` by check-skipped-required-checks.mjs. Deleting the
  // key would turn a working configuration into a violation as a side effect of
  // removing a hollow gate. `inert` is the honest answer and the one the
  // `playwright_e2e` entry below already gives for the same reason.
  "test:e2e": Object.freeze([]),
  maestro_e2e: Object.freeze(["maestro_e2e"]),
  // Empty because the three jobs it named are no longer in `quality.yml` — the
  // browser suite is `playwright-e2e.yml` now, which takes no `skip_jobs` at
  // all. Passing this token to `quality.yml` therefore suppresses nothing, and
  // the input's own description still advertises it, so it is `github_issue`'s
  // case exactly: advertised, honoured nowhere, and better said out loud than
  // left for an operator to infer from a check that never changed.
  //
  // Deliberately not `["playwright_e2e_aggregate"]` on the grounds that the
  // aggregator still exists somewhere. A `skip_jobs` token is an instruction
  // to ONE workflow, and naming a job that workflow does not have would report
  // a suppression that cannot happen. The suite is now selected by which
  // workflow a caller calls, and governed inside it by the `e2e-browser` gate.
  playwright_e2e: Object.freeze([]),
  format: Object.freeze(["format"]),
  build: Object.freeze(["build"]),
  skipped_required_checks: Object.freeze(["skipped_required_checks"]),
  threshold_ratchet: Object.freeze(["threshold_ratchet"]),
  work_item_traceability: Object.freeze(["work_item_traceability"]),
  test_node_suites: Object.freeze(["test_node_suites"]),
  environment_reset: Object.freeze(["environment_reset"]),
  environment_reseed: Object.freeze(["environment_reseed"]),
  dead_code: Object.freeze(["dead_code"]),
  conflict_markers: Object.freeze(["conflict_markers"]),
  sg_scan: Object.freeze(["sg_scan"]),
  floor_collisions: Object.freeze(["floor_collisions"]),
  npm_security_scan: Object.freeze(["npm_security_scan"]),
  sonarcloud: Object.freeze(["sonarcloud"]),
  snyk: Object.freeze(["snyk"]),
  secret_scanning: Object.freeze(["secret_scanning"]),
  license_compliance: Object.freeze(["license_compliance"]),
  zap_baseline: Object.freeze(["zap_baseline"]),
  github_issue: Object.freeze([]),
});

/**
 * What a `skip_jobs` token can be resolved to.
 *
 * Four of the five are refusals, which is the point. The failure this table
 * exists to prevent is a confident wrong answer, so anything short of "one gate
 * covers every job this token suppresses" has to be a distinct, nameable
 * outcome rather than a best effort.
 */
export const SKIP_JOB_STATUS = [
  "replaceable",
  "partial",
  "unmappable",
  "inert",
  "unknown",
  "moment-illegal",
];

/**
 * Resolve one `skip_jobs` token to the gate declaration that replaces it.
 * @param {string} token A `skip_jobs` token, exactly as the caller spells it.
 * @returns {{token: string, status: string, jobs: string[], gates: string[], gate: string|null, ungated: string[]}} What is known about the token.
 */
export function gateForSkipJob(token) {
  const jobs = Object.hasOwn(SKIP_JOB_TOKENS, token)
    ? [...SKIP_JOB_TOKENS[token]]
    : null;
  if (jobs === null) {
    // Not a guess declined — a token this workflow has never had. A caller can
    // reach here by typo, by whitespace (`'lint, lint_slow'` yields the token
    // `" lint_slow"`), or by carrying a token from a workflow that predates
    // this one. All three suppress nothing today, and none of them may be
    // answered with the nearest-looking gate.
    return {
      token,
      status: "unknown",
      jobs: [],
      gates: [],
      gate: null,
      ungated: [],
    };
  }

  const ungated = jobs.filter(job => !Object.hasOwn(QUALITY_JOB_GATES, job));
  const gates = [
    ...new Set(
      jobs.flatMap(job =>
        Object.hasOwn(QUALITY_JOB_GATES, job) ? [QUALITY_JOB_GATES[job]] : []
      )
    ),
  ];

  const status =
    jobs.length === 0
      ? "inert"
      : gates.length === 0
        ? "unmappable"
        : gates.length === 1 && ungated.length === 0
          ? "replaceable"
          : "partial";

  return {
    token,
    status,
    jobs,
    gates,
    // One gate or none. Two gates behind one token means no single declaration
    // replaces it, and picking either would turn off half of what the token
    // turns off while reading as a complete migration.
    gate: gates.length === 1 ? gates[0] : null,
    ungated,
  };
}

/**
 * Resolve a token to the declaration that replaces it AT ONE MOMENT.
 *
 * The moment is not decoration. `quality.yml` takes it as an input, every job
 * resolves its gate at it, and a gate's registry entry names the closed set of
 * moments it may legally be declared at — `traceability` at `push` and
 * `pull-request` and nowhere else. So a caller running the pre-deploy set has
 * no legal declaration for that token, and printing one anyway would be
 * refused by `validate` AFTER the operator had already deleted the token,
 * leaving the check running unguarded with the configuration reading migrated.
 *
 * Emitted by both `lisa doctor` and this file's `skip-jobs` command, from here,
 * so the string an operator is shown cannot differ between the two.
 * @param {string} token A `skip_jobs` token, exactly as the caller spells it.
 * @param {string} [moment] The moment the caller passes to `quality.yml`.
 * @returns {{token: string, status: string, moment: string, jobs: string[], gates: string[], gate: string|null, ungated: string[], declaration: string|null}} The migration for that token.
 */
export function skipJobMigration(token, moment = PULL_REQUEST) {
  const resolved = gateForSkipJob(token);
  if (resolved.gate === null) {
    return { ...resolved, moment, declaration: null };
  }
  const permitted =
    isMoment(moment) &&
    (REGISTRY[resolved.gate]?.moments ?? []).includes(momentFamily(moment));
  if (!permitted) {
    return { ...resolved, moment, status: "moment-illegal", declaration: null };
  }
  return {
    ...resolved,
    moment,
    declaration: `"${resolved.gate}": { "${moment}": "off" }`,
  };
}

/**
 * Guarantees the platform enforces, which no task can implement.
 *
 * These were briefly modelled as gates with `implementation: "lisa"`, which was
 * a category error: nothing runs and nothing produces a verdict. They are
 * repository *policy* — a declared state that has either drifted or not — and
 * belong in the `policy` block, where the response to a violation is to repair
 * the setting rather than to block a change.
 */
export const POLICY_ENFORCED = Object.freeze([
  "review-completion",
  "branch-protection",
  "up-to-date-before-merge",
  "linear-history",
  "signed-commits",
]);

/**
 * Gates enforced by intercepting an action before it happens.
 *
 * A task cannot implement these: by the time one could run, the thing it
 * prevents has already run. The project may say where they are enforced; it may
 * not say what implements them.
 */
export const INTERCEPTORS = Object.freeze({
  "verification-bypass": "Verification hooks cannot be disabled.",
  "destructive-safety": "Destructive commands are refused where irreversible.",
  "instruction-integrity": "Agents cannot rewrite their instruction files.",
  "orchestration-conformance": "Lifecycle flows follow required orchestration.",
  "structured-data-handling":
    "Structured formats are parsed with real parsers.",
});

/**
 * The shape every gate's implementation emits, whatever tool produced it.
 *
 * The task name alone is not an interface. If Lisa standardises only *how to
 * invoke*, the attestation records "test:cov passed" and cites nothing — true
 * of a scrupulous project as much as a careless one. Standardising what comes
 * *back* is what lets jest and vitest both satisfy `coverage-adequacy`, and
 * what lets the register quote a number instead of a verdict.
 *
 * Four fields, each earning its place:
 *
 * - `status` — three-valued. `unknown` is not a synonym for `fail`.
 * - `work` — the count that proves it RAN. `null` forces `unknown`, which is
 *   the `passWithNoTests` hole closed structurally rather than by vigilance.
 * - `measures` — what an attestation actually cites.
 * - `prover` — which implementation produced it. Vendor-neutrality means Lisa
 *   does not *mandate* a tool, not that it declines to *record* one; an auditor
 *   asking "what measured this?" deserves an answer.
 *
 * `observed_at` and `max_age_minutes` exist for continuous gates. A gate tied
 * to a change carries inherently fresh evidence — it ran on that diff. A gate
 * that runs on a schedule does not, and a green from six days ago proves
 * nothing about today. Evidence read past its bound yields `unknown`, never
 * `pass`: a scheduler that quietly died must block promotion rather than let
 * last week's result stand in for this week's.
 */
export const EVIDENCE_FIELDS = Object.freeze({
  gate: "string",
  status: "pass | fail | unknown",
  work: "number | null",
  measures: "object",
  prover: "{ tool, version }",
  observed_at: "ISO-8601",
  max_age_minutes: "number | null",
});

/** Verdict an evidence envelope can carry. */
export const EVIDENCE_STATUS = ["pass", "fail", "unknown"];

/**
 * Read a verdict from an evidence envelope, honouring work and freshness.
 *
 * Two demotions to `unknown`, both deliberate, both cases where the naive read
 * is `pass`:
 *
 * - the gate declares a work count and the implementation emitted none, so
 *   nothing shows it ran;
 * - the evidence is older than its own bound, so it describes a state that may
 *   no longer exist.
 *
 * Neither is a failure and neither is a pass. Collapsing either into `pass` is
 * the defect this whole subsystem exists to prevent; collapsing either into
 * `fail` blames a project for a gap in observation.
 * @param {object} evidence The emitted envelope.
 * @param {object} [definition] Registry entry, for whether work is expected.
 * @param {number} [nowMs] Clock, injected for tests.
 * @returns {{status: string, reason: string|null}} Effective verdict.
 */
export function readEvidence(evidence, definition = {}, nowMs = Date.now()) {
  if (!evidence || !EVIDENCE_STATUS.includes(evidence.status)) {
    return { status: "unknown", reason: "no evidence was emitted" };
  }
  if (evidence.status !== "pass") {
    return { status: evidence.status, reason: null };
  }
  if (definition.work && (evidence.work ?? null) === null) {
    return {
      status: "unknown",
      reason: `reported pass but no ${definition.work} count, so nothing shows it ran`,
    };
  }
  const bound = evidence.max_age_minutes;
  if (bound && evidence.observed_at) {
    const ageMinutes = (nowMs - Date.parse(evidence.observed_at)) / 60000;
    if (Number.isFinite(ageMinutes) && ageMinutes > bound) {
      return {
        status: "unknown",
        reason: `evidence is ${Math.round(ageMinutes)} minutes old, past its ${bound}-minute bound`,
      };
    }
  }
  return { status: "pass", reason: null };
}

/** Description phrases that grant or deny credit for an awaited signal. */
export const EVIDENCE_DEFAULTS = Object.freeze({
  // Matched strictly — whole description, case-insensitive — because a match
  // GRANTS credit and a substring would let "review skipped" satisfy "review".
  proof: Object.freeze([
    "review approved",
    "review completed",
    "changes requested",
    "comments posted",
  ]),
  // Matched loosely as substrings because a match DENIES credit, and the vendor
  // decorates its own strings: "Review rate limited (retry in 12m)".
  no_work: Object.freeze([
    "rate limited",
    "review queued",
    "review skipped",
    "skipped",
    "queued",
    "waiting",
    "in progress",
    "no review",
    "disabled",
    "quota",
    "billing",
  ]),
});

/**
 * Repository policy Lisa asserts.
 *
 * Policy differs from a gate in what failure means. A gate failing says stop
 * the change; a policy having drifted says put the setting back. That is why
 * `on_drift` defaults to repair and a gate never does.
 */
export const POLICY_SCHEMA = Object.freeze({
  merge: Object.freeze({
    squash: "boolean",
    merge_commit: "boolean",
    rebase: "boolean",
    auto_merge: "boolean",
    delete_branch_on_merge: "boolean",
    allow_update_branch: "boolean",
  }),
  history: Object.freeze({
    linear: "boolean",
    signed_commits: "boolean",
    commit_signoff: "boolean",
  }),
  protect: Object.freeze({
    force_push: "boolean",
    deletion: "boolean",
    up_to_date_before_merge: "boolean",
    conversation_resolution: "boolean",
    dismiss_stale_reviews: "boolean",
    require_last_push_approval: "boolean",
  }),
  repository: Object.freeze({
    has_issues: "boolean",
    has_wiki: "boolean",
    default_branch: "string",
  }),
});

/** How to respond when reality has drifted from declared policy. */
export const DRIFT_RESPONSES = ["repair", "report", "block"];

/** Top-level `.lisa.config.json` keys Lisa reads. */
export const KNOWN_CONFIG_KEYS = Object.freeze([
  "harness",
  "tracker",
  "source",
  "atlassian",
  "jira",
  "confluence",
  "github",
  "notion",
  "linear",
  "deploy",
  "quality",
  "gates",
  "policy",
  "intake",
  "monitor",
  "secrets",
  "remoteEnv",
  "automations",
  "usage",
  "wiki",
  "learnings",
  "health",
  "verification",
]);

/**
 * Keys Lisa used to read, with what to say about each.
 *
 * Distinguished from merely unrecognised keys because Lisa *knows* what these
 * were and can say something useful. An unrecognised key might be a typo or a
 * deliberate annotation; a retired one is neither.
 */
export const RETIRED_CONFIG_KEYS = Object.freeze({
  projectRulesFile:
    "retired — host rules now live in the fixed directory .agents/rules/. " +
    "The key is still parsed so installed projects keep applying, but nothing " +
    "serves rules from it.",
});

/**
 * The runner Lisa assumes when a project declares none.
 */
export const DEFAULT_RUNNER = "npm run";

/**
 * Commands that ignore their arguments and return a fixed status.
 *
 * `:` and `true` are the sharp ones: both are shell builtins that succeed no
 * matter what follows, so `"runner": ":"` turns every configured gate into
 * `: <task>` — exit 0, nothing run — while the workflow's `configured ==
 * 'false'` fallbacks stay skipped because resolution SUCCEEDED. `echo` and
 * `printf` do the same thing more visibly. `false` is the mirror image: it
 * cannot run a task either, and a gate that is red for a reason nobody can
 * read is not a working gate.
 */
export const NO_OP_RUNNERS = Object.freeze(
  new Set([":", "true", "false", "echo", "printf"])
);

/**
 * What a runner may be spelled with.
 *
 * Deliberately NOT the class a task is checked against, which permits `:`
 * because task names carry it (`test:cov`, `lint:staged`). A runner never
 * needs a colon and the shell's no-op builtin IS one, so admitting it made
 * the allowlist the bypass.
 */
const RUNNER_PATTERN = /^[A-Za-z0-9._@/= -]+$/;

/**
 * Whether a value can prefix a gate task and actually run it.
 *
 * Type is checked BEFORE the pattern, because `RegExp.prototype.test` coerces
 * its argument: `test(true)` examines the string "true" and passes. The
 * config is host-owned JSON, so a boolean reaches here as a boolean.
 * @param {unknown} value Candidate runner.
 * @returns {boolean} True when it is a usable runner.
 */
export function isRunner(value) {
  if (typeof value !== "string") return false;
  if (!RUNNER_PATTERN.test(value)) return false;
  const [head] = value.trim().split(" ");
  return Boolean(head) && !NO_OP_RUNNERS.has(head);
}

/**
 * Read the config, splitting the runner out of the gates block.
 *
 * Refuses a runner that cannot run a task, rather than passing it through.
 * The previous destructuring default fired only on `undefined`, so `null`,
 * `true` and `0` all became the runner, and `list --json` emitted whatever was
 * in the file for nineteen workflow facades to consume.
 * @param {string} [cwd] Directory to look in.
 * @returns {{runner: string, gates: object, policy: object, config: object}} Parsed config.
 * @throws {Error} When `gates.runner` is present but is not a runner.
 */
export function readGates(cwd = process.cwd()) {
  const path = join(cwd, ".lisa.config.json");
  if (!existsSync(path)) {
    return { runner: DEFAULT_RUNNER, gates: {}, policy: {}, config: {} };
  }
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`.lisa.config.json is not readable: ${err.message}`);
  }
  const { runner: declared, ...gates } = config.gates ?? {};
  const runner = declared === undefined ? DEFAULT_RUNNER : declared;
  if (!isRunner(runner)) {
    throw new Error(
      `gates.runner is ${JSON.stringify(declared)}, which cannot run a task. ` +
        `A runner must be a plain STRING (e.g. "npm run", "bun run", "just"), ` +
        `may not contain a colon, and may not be one of ` +
        `${[...NO_OP_RUNNERS].join(", ")} — those succeed without running ` +
        `anything, which turns every configured gate green while proving nothing.`
    );
  }
  return { runner, gates, policy: config.policy ?? {}, config };
}

/**
 * The `scripts` block of a project's `package.json`, or `null` when unknown.
 *
 * `null` is a THIRD answer, distinct from `{}`, and the distinction is the
 * whole safety of the `shippedAs` fallback. `{}` says "this project ships no
 * scripts", which is a fact the resolver may act on; `null` says "nobody
 * knows", which it may not. Collapsing the two would let an absent or
 * unparseable manifest read as "the concern-named script is missing" and send
 * every aliased gate at a vendor script that might not be there either.
 * @param {string} [cwd] Project root.
 * @returns {Record<string, string>|null} The scripts, or null when unknown.
 */
export function projectScripts(cwd = process.cwd()) {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return null;
  try {
    const scripts = JSON.parse(readFileSync(path, "utf8"))?.scripts;
    return scripts && typeof scripts === "object" ? scripts : {};
  } catch {
    return null;
  }
}

/**
 * Whether a registry default should stand aside for the script this project
 * actually ships, and which script that is.
 *
 * Three conditions, all required, and each one closes a different way of
 * resolving more than the registry knows:
 *
 * - the project declared no prover of its own, because `run:` is the project
 *   saying what proves this property here and nothing outranks it;
 * - the concern-named default is ABSENT from this project, so the alias is
 *   standing in for nothing rather than displacing a working script;
 * - the alias is PRESENT, so the substitution names a command that exists.
 *
 * With `scripts` unknown, none of the last two can be established and the
 * answer is no.
 * @param {object} options Inputs.
 * @param {string|null} options.declared The project's own `run:`, if any.
 * @param {string|null} options.registryTask The registry default for here.
 * @param {string|null} options.shippedAs The alias the registry records.
 * @param {Record<string, string>|null} options.scripts The project's scripts.
 * @returns {{from: string, to: string}|null} The substitution, or null.
 */
function aliasFor({ declared, registryTask, shippedAs, scripts }) {
  if (declared !== null && declared !== undefined) return null;
  if (!registryTask || !shippedAs) return null;
  if (scripts === null || typeof scripts !== "object") return null;
  if (Object.hasOwn(scripts, registryTask)) return null;
  if (!Object.hasOwn(scripts, shippedAs)) return null;
  return { from: registryTask, to: shippedAs };
}

/**
 * Whether a moment string is one Lisa understands.
 * @param {string} moment Candidate moment.
 * @returns {boolean} True when well-formed.
 */
export function isMoment(moment) {
  if (MOMENTS.includes(moment)) return true;
  const parts = moment.split(":");
  if (parts.length !== 2) return false;
  const [family, environment] = parts;
  return MOMENT_FAMILIES.includes(family) && Boolean(environment);
}

/**
 * The family a moment belongs to, for comparison against a gate's legal set.
 * @param {string} moment A well-formed moment.
 * @returns {string} `pre-deploy` for `pre-deploy:production`, else the moment.
 */
export function momentFamily(moment) {
  const [family] = moment.split(":");
  return MOMENT_FAMILIES.includes(family) ? family : moment;
}

/**
 * Validate the gates block, returning every problem rather than the first.
 * @param {object} gates The gates block, runner already removed.
 * @returns {string[]} Problems, empty when valid.
 */
export function validateGates(gates) {
  const problems = [];
  for (const [id, gate] of Object.entries(gates ?? {})) {
    problems.push(...validateGate(id, gate));
  }
  return problems;
}

/**
 * Fail fast when a consumer tries to use an invalid gates block.
 *
 * A resolver that only looks at `gate[moment]` can make a typo'd config key look
 * like a truthful absence at that moment. Validation is therefore part of
 * resolution, not just the standalone `validate` command.
 * @param {object} gates The gates block.
 */
function assertValidMomentKeys(gates) {
  const problems = validateGateMomentKeys(gates);
  if (!problems.length) return;
  throw new Error(
    `Invalid gates configuration:\n${problems
      .map(problem => `  ${problem}`)
      .join("\n")}`
  );
}

/**
 * Validate only gate keys that masquerade as moments.
 *
 * This narrower guard preserves `list`'s ability to explain a custom gate with
 * no prover, while still refusing a moment typo before it silently resolves to
 * "nothing configured".
 * @param {object} gates The gates block.
 * @returns {string[]} Moment-key problems.
 */
function validateGateMomentKeys(gates) {
  const problems = [];
  for (const [id, gate] of Object.entries(gates ?? {})) {
    if (!gate || typeof gate !== "object" || Array.isArray(gate)) continue;
    for (const key of Object.keys(gate)) {
      if (isMoment(key) || GATE_FIELDS.has(key)) continue;
      problems.push(
        `gates."${id}"."${key}" ${unknownMomentMessage(key)} ` +
          `Nothing runs at it, so whatever it was meant to enable is off.`
      );
    }
  }
  return problems;
}

/**
 * Validate one gate entry.
 * @param {string} id Gate id.
 * @param {object} gate The entry.
 * @returns {string[]} Problems.
 */
function validateGate(id, gate) {
  const problems = [];
  const known = Object.hasOwn(REGISTRY, id);
  const interceptor = Object.hasOwn(INTERCEPTORS, id);

  if (POLICY_ENFORCED.includes(id)) {
    return [
      `gates."${id}" is repository policy, not a gate — nothing runs and ` +
        `nothing produces a verdict. Declare it under "policy" instead, where ` +
        `drift is repaired rather than blocking a change.`,
    ];
  }
  if (!known && !interceptor && !id.startsWith(CUSTOM_PREFIX)) {
    const near = nearest(id, [
      ...Object.keys(REGISTRY),
      ...Object.keys(INTERCEPTORS),
    ]);
    return [
      `gates."${id}" is not a gate Lisa knows${
        near ? `. Did you mean "${near}"?` : ""
      } Prefix a gate of your own with "${CUSTOM_PREFIX}" — Lisa will run ` +
        `it without pretending to understand it.`,
    ];
  }
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
    return [`gates."${id}" must be an object`];
  }
  if (interceptor && gate.run) {
    problems.push(
      `gates."${id}" names a task, but this gate intercepts an action before ` +
        `it happens and cannot be delegated — by the time a task could run, ` +
        `the thing it prevents has already run.`
    );
  }
  problems.push(...validateNeeds(id, gate));

  for (const [moment, value] of Object.entries(gate)) {
    // A key that is neither a known field nor a well-formed moment is a typo,
    // and skipping it silently is the hole this validator exists to close:
    // `pull_request` with an underscore reads as a configured gate and enables
    // nothing at all. Same shape as a misspelled gate id, one level down.
    if (!isMoment(moment)) {
      if (!GATE_FIELDS.has(moment)) {
        problems.push(
          `gates."${id}"."${moment}" ${unknownMomentMessage(moment)} ` +
            `Nothing runs at it, so whatever it was meant to enable is off.`
        );
      }
      continue;
    }
    problems.push(
      ...validateMoment(id, moment, value, known, interceptor, gate.run)
    );
  }
  return problems;
}

/**
 * Validate one moment entry on a gate.
 * @param {string} id Gate id.
 * @param {string} moment The moment key.
 * @param {*} value Level string, or a prover object.
 * @param {boolean} known Whether the gate is in the registry.
 * @param {boolean} interceptor Whether the gate intercepts.
 * @param {string} [gateRun] A task declared once for the whole gate.
 * @returns {string[]} Problems.
 */
function validateMoment(id, moment, value, known, interceptor, gateRun) {
  const problems = [];
  const entry = typeof value === "string" ? { level: value } : (value ?? {});

  if (!LEVELS.includes(entry.level)) {
    problems.push(
      `gates."${id}"."${moment}" has level ${JSON.stringify(entry.level)}; ` +
        `expected ${LEVELS.join(", ")}`
    );
  }
  if (known && !REGISTRY[id].moments.includes(momentFamily(moment))) {
    problems.push(
      `gates."${id}" cannot run at "${moment}". ${REGISTRY[id].summary} ` +
        `Legal moments: ${REGISTRY[id].moments.join(", ")}.`
    );
  }
  if (entry.await) {
    if ([COMMIT, PUSH, SESSION_START, PRE_TOOL].includes(moment)) {
      problems.push(
        `gates."${id}"."${moment}" awaits "${entry.await}", but there is no ` +
          `pull request yet for a signal to post against. An awaited check ` +
          `that can never fire is a declared guarantee that never runs.`
      );
    }
    if (entry.run) {
      problems.push(
        `gates."${id}"."${moment}" declares both run and await; a moment has ` +
          `one prover.`
      );
    }
    problems.push(...validateEvidence(id, moment, entry.evidence ?? {}));
  }
  if (!known && !interceptor && !entry.await && !entry.run && !gateRun) {
    problems.push(
      `gates."${id}"."${moment}" names no prover and Lisa has no default task ` +
        `for a custom gate, so nothing would execute.`
    );
  }
  return problems;
}

/**
 * Validate an awaited signal's evidence block.
 * @param {string} id Gate id.
 * @param {string} moment Moment key.
 * @param {object} evidence The evidence block.
 * @returns {string[]} Problems.
 */
function validateEvidence(id, moment, evidence) {
  const problems = [];
  const where = `gates."${id}"."${moment}".evidence`;
  const response = evidence.on_hollow ?? "report";

  if (!HOLLOW_RESPONSES.includes(response)) {
    problems.push(
      `${where}.on_hollow is ${JSON.stringify(response)}; expected ` +
        `${HOLLOW_RESPONSES.join(", ")}`
    );
  }
  if (response === "wait") {
    // An unbounded wait is a pull request blocked with no signal, and the
    // fastest way out is deleting the requirement — which is how a gate ends
    // up removed rather than satisfied.
    if (!Number.isFinite(evidence.wait_minutes) || evidence.wait_minutes <= 0) {
      problems.push(
        `${where}.on_hollow is "wait" but wait_minutes is not a positive ` +
          `number. An unbounded wait blocks the pull request with no signal.`
      );
    }
    if (!HOLLOW_RESPONSES.includes(evidence.on_timeout ?? "block")) {
      problems.push(
        `${where}.on_timeout is ${JSON.stringify(evidence.on_timeout)}; ` +
          `expected ${HOLLOW_RESPONSES.join(", ")}`
      );
    }
  }
  for (const field of ["proof", "no_work"]) {
    if (evidence[field] !== undefined && !Array.isArray(evidence[field])) {
      problems.push(`${where}.${field} must be an array of phrases`);
    }
  }
  return problems;
}

/**
 * Validate a gate's declared needs.
 * @param {string} id Gate id.
 * @param {object} gate The entry.
 * @returns {string[]} Problems.
 */
function validateNeeds(id, gate) {
  const problems = [];
  if (gate.needs === undefined) return problems;
  if (typeof gate.needs !== "object" || Array.isArray(gate.needs)) {
    return [`gates."${id}".needs must be an object with tools and/or secrets`];
  }
  for (const field of ["tools", "secrets"]) {
    if (gate.needs[field] === undefined) continue;
    if (!Array.isArray(gate.needs[field])) {
      problems.push(`gates."${id}".needs.${field} must be an array of names`);
      continue;
    }
    if (field !== "secrets") continue;
    for (const name of gate.needs.secrets) {
      if (typeof name !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
        problems.push(
          `gates."${id}".needs.secrets entry ${JSON.stringify(name)} is not ` +
            `an exact UPPER_SNAKE_CASE variable name. Lookup is never fuzzy.`
        );
      }
    }
  }
  return problems;
}

/**
 * Validate the policy block.
 * @param {object} policy The policy block.
 * @returns {string[]} Problems.
 */
export function validatePolicy(policy) {
  const problems = [];
  if (!policy || typeof policy !== "object") return problems;

  const response = policy.on_drift ?? "repair";
  if (!DRIFT_RESPONSES.includes(response)) {
    problems.push(
      `policy.on_drift is ${JSON.stringify(response)}; expected ` +
        `${DRIFT_RESPONSES.join(", ")}`
    );
  }
  for (const [section, fields] of Object.entries(policy)) {
    if (section === "on_drift") continue;
    if (!Object.hasOwn(POLICY_SCHEMA, section)) {
      const near = nearest(section, Object.keys(POLICY_SCHEMA));
      problems.push(
        `policy."${section}" is not a policy section Lisa knows${
          near ? `. Did you mean "${near}"?` : ""
        }`
      );
      continue;
    }
    if (!fields || typeof fields !== "object") {
      problems.push(`policy."${section}" must be an object`);
      continue;
    }
    for (const [field, value] of Object.entries(fields)) {
      const expected = POLICY_SCHEMA[section][field];
      if (!expected) {
        const near = nearest(field, Object.keys(POLICY_SCHEMA[section]));
        problems.push(
          `policy.${section}."${field}" is not a setting Lisa manages${
            near ? `. Did you mean "${near}"?` : ""
          }`
        );
        continue;
      }
      if (typeof value !== expected) {
        problems.push(
          `policy.${section}.${field} must be a ${expected}, got ${typeof value}`
        );
      }
    }
  }
  return problems;
}

/**
 * Report config keys Lisa does not read.
 *
 * Unknown fields used to be preserved silently on round-trip, which meant a
 * typo looked exactly like configuration and did nothing: `"trackr": "github"`
 * produced no error, no warning, and every vendor-neutral skill failing with
 * "'tracker' is not set". Reported rather than deleted, because you cannot know
 * a key a human wrote was meaningless.
 * @param {object} config Parsed config root.
 * @returns {Array<{key: string, level: string, message: string}>} Findings.
 */
export function auditConfigKeys(config) {
  const findings = [];
  for (const key of Object.keys(config ?? {})) {
    // `_` is Lisa's own metadata namespace (`_lisaSync`); `x-` is the
    // project's. Both are deliberate, neither is a typo.
    if (key.startsWith("_") || key.startsWith(CUSTOM_PREFIX)) continue;
    if (Object.hasOwn(RETIRED_CONFIG_KEYS, key)) {
      findings.push({
        key,
        level: "warn",
        message: `${key} is ${RETIRED_CONFIG_KEYS[key]}`,
      });
      continue;
    }
    if (KNOWN_CONFIG_KEYS.includes(key)) continue;
    const near = nearest(key, KNOWN_CONFIG_KEYS);
    findings.push({
      key,
      level: "warn",
      message: `${key} is not a key Lisa reads${
        near ? `. Did you mean "${near}"?` : ""
      } Nothing consumes it, so whatever it was meant to configure is unset.`,
    });
  }
  return findings;
}

/**
 * Resolve which gates run at one moment, and how.
 * @param {object} options Resolution inputs.
 * @param {object} options.gates The gates block.
 * @param {string} options.moment The moment to resolve.
 * @param {string} [options.runner] Task-runner prefix.
 * @param {boolean} [options.includeOff] Also report gates declared `off`, as
 *   entries with `level: "off"` and no task. Default false, because every
 *   consumer that RUNS these entries must not see a gate the project turned
 *   off. Callers that need to tell "declared off" from "never declared" — the
 *   CI façade does — pass true and branch on the level themselves.
 * @param {Record<string, string>|null} [options.scripts] The project's
 *   `package.json` scripts, from `projectScripts`. Omitted or `null` means
 *   UNKNOWN, and an unknown manifest resolves exactly as it did before this
 *   option existed — a caller that has not been taught to read the manifest
 *   must not have its answers changed by silence.
 * @returns {Array<{id: string, level: string, mode: string, awaits: string|null, task: string|null, command: string|null, label: string, work: string|null, alias: {from: string, to: string}|null, evidence: {proof: string[], no_work: string[], on_hollow: string, wait_minutes: number|null, on_timeout: string}|null}>} Resolved provers, sorted by gate id.
 */
export function resolveMoment({
  gates,
  moment,
  runner = DEFAULT_RUNNER,
  includeOff = false,
  scripts = null,
}) {
  // The same guard as `readGates`, at the site that BUILDS the command. A
  // destructuring default fires only on `undefined`, so a caller passing the
  // raw config value straight through would otherwise emit `null <task>` or
  // `: <task>` as a `command` for every gate at this moment.
  if (!isRunner(runner)) {
    throw new Error(
      `gates.runner is ${JSON.stringify(runner)}, which cannot run a task.`
    );
  }
  // A moment is looked up as a KEY on each gate, so one Lisa does not know
  // matches nothing and yields `[]` — indistinguishable from a real moment at
  // which this project declares no gates. Every consumer reads that as "run
  // the unguarded fallback": the quality workflow reports `configured=false`
  // for every job, and lisa-run-gates prints a green "0 of 0 gate(s)". A typo
  // would therefore disable the whole registry while reporting success, which
  // is the defect this subsystem exists to stop. `[]` stays a truthful answer
  // for a real moment; it is refused only for one that cannot exist.
  if (!isMoment(moment)) {
    throw new Error(
      `"${moment}" ${unknownMomentMessage(moment)} ${knownMomentsMessage()}`
    );
  }
  assertValidMomentKeys(gates);

  const resolved = [];
  for (const [id, gate] of Object.entries(gates ?? {})) {
    const raw = gate?.[moment];
    if (raw === undefined) continue;
    const entry = typeof raw === "string" ? { level: raw } : raw;
    if (!entry?.level) continue;
    if (entry.level === "off") {
      // A gate declared `off` and a gate never mentioned are DIFFERENT claims,
      // and collapsing them is what let a declaration govern nothing: the CI
      // façade read both as `configured=false` and ran its built-in fallback,
      // so `off` could not turn a job off. Measured downstream — two
      // zero-suite repositories declared `test-node-suites` off, validated
      // clean locally, and still went red on a job that never consults the
      // declaration. Reported only on request, because every consumer that
      // RUNS these entries must keep seeing an off gate as absent.
      if (includeOff) {
        resolved.push({
          id,
          level: "off",
          mode: "off",
          awaits: null,
          task: null,
          command: null,
          label: REGISTRY[id]?.label ?? id,
          work: null,
          alias: null,
          evidence: null,
          mayRewrite: false,
          costly: false,
        });
      }
      continue;
    }

    const definition = REGISTRY[id];
    // Four sources, narrowest first. `taskAt` is a registry DEFAULT that varies
    // by moment, and it sits below both project declarations for the same
    // reason `task` does: a project that names its own prover has said what
    // proves the property here, and Lisa does not know better. It sits above
    // `task` because a gate whose default prover differs by moment has no
    // single default — see `traceability`, where the pull-request prover reads
    // a pull request that does not exist yet at push.
    const declared = entry.run ?? gate.run ?? null;
    const registryTask =
      definition?.taskAt?.[momentFamily(moment)] ?? definition?.task ?? null;
    // The fifth source, and the only one that reads the project's disk. It is
    // deliberately BELOW all four: `shippedAs` says what the template ships,
    // which is a weaker claim than what this project declared, and it may only
    // ever stand in for a registry default that resolves to nothing here.
    const alias = aliasFor({
      declared,
      registryTask,
      shippedAs: definition?.shippedAs ?? null,
      scripts,
    });
    const task = declared ?? alias?.to ?? registryTask;
    const intercepts = Object.hasOwn(INTERCEPTORS, id);

    resolved.push({
      id,
      level: entry.level,
      mode: entry.await ? "await" : intercepts ? "intercept" : "run",
      awaits: entry.await ?? null,
      task: entry.await || intercepts ? null : task,
      command: entry.await || intercepts || !task ? null : `${runner} ${task}`,
      label: definition?.label ?? id,
      work: definition?.work ?? null,
      alias: entry.await || intercepts ? null : alias,
      evidence: entry.await ? mergeEvidence(entry.evidence) : null,
      mayRewrite: definition?.mayRewrite === true,
      costly: definition?.costly === true,
    });
  }
  // Rewriters first, then alphabetical within each group. See `mayRewrite`:
  // a verdict reached before a formatter runs describes bytes that never ship.
  return resolved.sort(
    (left, right) =>
      Number(right.mayRewrite) - Number(left.mayRewrite) ||
      left.id.localeCompare(right.id)
  );
}

/**
 * Merge a project's evidence phrases onto the defaults.
 *
 * Extend, never replace. Removing a `no_work` phrase narrows detection with no
 * signal that it was narrowed — a green that looks reviewed and is not. A
 * shipped default that misfires for some vendor is an upstream bug to fix once,
 * not something each project suppresses locally.
 * @param {object} [evidence] Project evidence block.
 * @returns {object} Merged evidence.
 */
function mergeEvidence(evidence = {}) {
  return {
    proof: [...EVIDENCE_DEFAULTS.proof, ...(evidence.proof ?? [])],
    no_work: [...EVIDENCE_DEFAULTS.no_work, ...(evidence.no_work ?? [])],
    on_hollow: evidence.on_hollow ?? "report",
    wait_minutes: evidence.wait_minutes ?? null,
    on_timeout: evidence.on_timeout ?? "block",
  };
}

/**
 * The tools and credentials the gates at one moment require.
 *
 * This replaces guessing a floor from `tracker` and `secrets.provider`. A gate
 * states what it needs; whatever runs at this moment therefore needs the union.
 * Surface never enters into it — the requirement follows the work.
 * @param {object} options Resolution inputs.
 * @param {object} options.gates The gates block.
 * @param {string} options.moment The moment to resolve.
 * @returns {{tools: string[], secrets: string[], reasons: Record<string, string>}} Union.
 */
export function needsAt({ gates, moment }) {
  const tools = new Set();
  const secrets = new Set();
  const reasons = {};
  for (const gate of resolveMoment({ gates, moment })) {
    const declared = gates[gate.id]?.needs ?? {};
    for (const tool of declared.tools ?? []) {
      tools.add(tool);
      reasons[tool] = `the ${gate.id} gate runs at ${moment}`;
    }
    for (const secret of declared.secrets ?? []) {
      secrets.add(secret);
      reasons[secret] = `the ${gate.id} gate runs at ${moment}`;
    }
  }
  return {
    tools: [...tools].sort((a, b) => a.localeCompare(b)),
    secrets: [...secrets].sort((a, b) => a.localeCompare(b)),
    reasons,
  };
}

/**
 * The branch-protection contexts a gates block implies at one moment.
 *
 * Derived rather than transcribed. The hand-maintained snapshot this replaces
 * shipped empty, carried a 90-day expiry, and had already been measured wrong
 * in both directions — because nothing could derive the truth and nothing could
 * tell you the copy had gone stale.
 *
 * Only `required` produces a context, and that is what makes `optional` and
 * `off` safe: a skipped required check counts as satisfied on GitHub, so a gate
 * that is off must never appear here — and because the job condition and this
 * list come from one declaration, it cannot.
 * @param {object} gates The gates block.
 * @param {object} [options] Context options.
 * @returns {string[]} Sorted, de-duplicated contexts.
 */
export function contextsFor(gates, options = {}) {
  const {
    moment = PULL_REQUEST,
    workflowName = "🔍 Quality Checks",
    previousLabels = [],
  } = options;

  const contexts = resolveMoment({ gates, moment })
    .filter(gate => gate.level === "required")
    // An awaited signal posts under its own name; a run job posts under the
    // calling workflow's.
    .map(gate =>
      gate.mode === "await" ? gate.awaits : `${workflowName} / ${gate.label}`
    );

  for (const label of previousLabels) {
    contexts.push(`${workflowName} / ${label}`);
  }
  return [...new Set(contexts)].sort((a, b) => a.localeCompare(b));
}

/**
 * Format the common unknown-moment suffix.
 * @param {string} moment The rejected moment.
 * @returns {string} Human-facing explanation.
 */
function unknownMomentMessage(moment) {
  const near = nearest(moment, [...MOMENTS, ...MOMENT_FAMILIES]);
  const suggestion =
    near && near !== moment ? `. Did you mean "${near}"?` : ".";
  const [familyPrefix] = moment.split(":");
  let familyName = "";
  if (MOMENT_FAMILIES.includes(familyPrefix)) {
    familyName = familyPrefix;
  } else if (MOMENT_FAMILIES.includes(moment)) {
    familyName = moment;
  } else if (MOMENT_FAMILIES.includes(near)) {
    familyName = near;
  }
  const family = familyName
    ? ` Use "${familyName}:<environment>" for that family.`
    : "";
  return `is not a moment Lisa knows${suggestion}${family}`;
}

/**
 * Format the legal moment inventory once for every caller.
 * @returns {string} Human-facing legal moment list.
 */
function knownMomentsMessage() {
  return (
    `Known moments: ${MOMENTS.join(", ")}` +
    `; or a family with an environment: ${MOMENT_FAMILIES.map(
      family => `${family}:<environment>`
    ).join(", ")}.`
  );
}

/**
 * The closest known name, for a did-you-mean suggestion.
 * @param {string} value The unrecognised value.
 * @param {string[]} candidates Known names.
 * @returns {string|null} A near match, or null when nothing is close.
 */
function nearest(value, candidates) {
  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = distance(value, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore <= Math.max(2, Math.floor(value.length / 3)) ? best : null;
}

/**
 * Levenshtein distance.
 * @param {string} a First string.
 * @param {string} b Second string.
 * @returns {number} Edit distance.
 */
function distance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const carry = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = carry;
    }
  }
  return previous[b.length];
}

/**
 * Advisory findings about gates whose prover this project does not ship.
 *
 * The gap this closes: `validate` printed `configuration is valid`, exit 0,
 * for a gate resolving to a script the project has never had. That is the
 * declared-but-uncallable defect applied to config validation itself — the
 * operator's only remaining signal was a red CI job weeks later reading
 * `Missing script`.
 *
 * ADVISORY, deliberately. Turning an unresolvable gate into a blocking
 * validation failure would red-wall every consumer the moment they upgrade,
 * for declarations that were legal when they wrote them. Saying it out loud
 * costs nothing and is the whole ask.
 *
 * Silent when the manifest is unknown: `null` scripts means nobody read a
 * `package.json`, and reporting "this project has no such script" from a file
 * nobody read would be the same fabrication one level down.
 * @param {object} options Inputs.
 * @param {object} options.gates The gates block.
 * @param {string} options.runner The task-runner prefix.
 * @param {Record<string, string>|null} options.scripts The project's scripts.
 * @returns {string[]} Advisory messages, de-duplicated, in gate order.
 */
export function auditProvers({ gates, runner, scripts }) {
  if (scripts === null || typeof scripts !== "object") return [];
  const moments = new Set(
    Object.values(gates ?? {})
      .filter(gate => gate !== null && typeof gate === "object")
      .flatMap(gate => Object.keys(gate))
      .filter(key => isMoment(key))
  );
  const seen = new Set();
  for (const moment of [...moments].sort((a, b) => a.localeCompare(b))) {
    let resolved;
    try {
      resolved = resolveMoment({ gates, moment, runner, scripts });
    } catch {
      // An unresolvable moment is already a BLOCKING problem from
      // `validateGates`, reported with a better message than this one could
      // give. Advisory work never competes with it.
      continue;
    }
    for (const gate of resolved) {
      const message = proverAdvice(gate, moment, runner, scripts);
      if (message) seen.add(message);
    }
  }
  return [...seen];
}

/**
 * What to tell an operator about one resolved gate's prover, if anything.
 * @param {object} gate One entry from `resolveMoment`.
 * @param {string} moment The moment it was resolved at.
 * @param {string} runner The task-runner prefix.
 * @param {Record<string, string>} scripts The project's scripts.
 * @returns {string|null} The advisory, or null when there is nothing to say.
 */
function proverAdvice(gate, moment, runner, scripts) {
  if (gate.mode !== "run" || !gate.task) return null;
  const where = `gates."${gate.id}"."${moment}"`;
  if (gate.alias) {
    return (
      `${where} has no "${gate.alias.from}" script in this project, so it ` +
      `runs "${runner} ${gate.alias.to}" — the prover this project does ` +
      `ship for that property. Add "run": "${gate.alias.to}" to say so ` +
      `explicitly, or add a "${gate.alias.from}" script to take it back.`
    );
  }
  if (Object.hasOwn(scripts, gate.task)) return null;
  const shippedAs = REGISTRY[gate.id]?.shippedAs;
  const elsewhere =
    shippedAs && shippedAs !== gate.task
      ? ` A Lisa template ships a prover for this property as ` +
        `"${shippedAs}", which this project does not have either.`
      : "";
  return (
    `${where} runs "${runner} ${gate.task}", and this project has no ` +
    `"${gate.task}" script. Nothing will prove it, so declaring it here ` +
    `guarantees a red gate rather than a guarantee.${elsewhere} Point ` +
    `"run" at a prover, or declare the gate "off" to say it is not proved here.`
  );
}

/**
 * CLI entry point.
 */
function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flag = name => {
    const hit = rest.find(arg => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const { runner, gates, policy, config } = readGates();
  // Read once, here, so every subcommand answers about the same project. The
  // resolver is handed the result rather than reading the disk itself, which
  // keeps it a pure function of its inputs.
  const scripts = projectScripts();

  if (command === "validate") {
    const blocking = [...validateGates(gates), ...validatePolicy(policy)];
    const advisory = [
      ...auditConfigKeys(config).map(finding => finding.message),
      ...auditProvers({ gates, runner, scripts }),
    ];
    for (const problem of [...blocking, ...advisory]) {
      console.error(`  ${problem}`);
    }
    if (blocking.length) {
      console.error(`\n${blocking.length} blocking configuration problem(s).`);
      process.exit(1);
    }
    if (advisory.length) {
      console.log(
        `\n${advisory.length} advisory finding(s); nothing blocking.`
      );
      return;
    }
    console.log("gates and policy: configuration is valid");
    return;
  }

  if (command === "list") {
    const moment = flag("moment");
    if (!moment)
      throw new Error("usage: lisa-gates.mjs list --moment=<moment>");
    const resolved = resolveMoment({
      gates,
      moment,
      runner,
      includeOff: rest.includes("--include-off"),
      scripts,
    });
    if (rest.includes("--json")) {
      console.log(JSON.stringify(resolved, null, 2));
      return;
    }
    for (const gate of resolved) {
      // "Lisa runs this internally" and "nothing will run this" printed
      // identically until this was split: an unresolvable gate has a null
      // command, and so does an intercepted one, so a typo'd gate id rendered
      // as `(intercepted by Lisa)` — a line that reads like success to the
      // person running `list` to check their config. Interception is a
      // property of the gate id, so ask the mode, not the command.
      const how =
        gate.mode === "await"
          ? `await ${gate.awaits}`
          : gate.mode === "intercept"
            ? "(intercepted by Lisa)"
            : (gate.command ?? "(NO PROVER — nothing runs this gate)");
      // Two scripts can back one gate once `shippedAs` resolves, so a listing
      // that printed only the winner would leave the reader unable to tell a
      // project that declared this prover from one that inherited it.
      const alias = gate.alias
        ? ` (no "${gate.alias.from}" script here; using "${gate.alias.to}")`
        : "";
      console.log(
        `${gate.level.padEnd(9)} ${gate.id.padEnd(28)} ${how}${alias}`
      );
    }
    return;
  }

  if (command === "needs") {
    const moment = flag("moment") ?? SESSION_START;
    console.log(JSON.stringify(needsAt({ gates, moment }), null, 2));
    return;
  }

  if (command === "contexts") {
    const previousLabels = (flag("previous") ?? "")
      .split(",")
      .map(entry => entry.trim())
      .filter(Boolean);
    console.log(
      JSON.stringify(
        contextsFor(gates, {
          moment: flag("moment") ?? PULL_REQUEST,
          workflowName: flag("workflow") ?? "🔍 Quality Checks",
          previousLabels,
        }),
        null,
        2
      )
    );
    return;
  }

  if (command === "skip-jobs") {
    // Deliberately not gated on reading .lisa.config.json: this answers "what
    // would replace this token", which a repository that has not migrated yet
    // must be able to ask. It is the surface an agent in a consumer checkout
    // uses, so it must work before anything has been declared.
    const requested = (flag("tokens") ?? "")
      .split(",")
      .filter(entry => entry !== "");
    const moment = flag("moment") ?? PULL_REQUEST;
    const resolved = (
      requested.length ? requested : Object.keys(SKIP_JOB_TOKENS)
    ).map(token => skipJobMigration(token, moment));
    if (rest.includes("--json")) {
      console.log(JSON.stringify(resolved, null, 2));
      return;
    }
    for (const entry of resolved) {
      console.log(
        `${entry.token.padEnd(24)} ${entry.status.padEnd(15)} ${
          entry.declaration ?? "(no declaration — see status)"
        }`
      );
    }
    return;
  }

  if (command === "audit-config") {
    const findings = auditConfigKeys(config);
    for (const finding of findings) console.error(`  ${finding.message}`);
    console.log(`${findings.length} config key finding(s).`);
    return;
  }

  throw new Error(
    "usage: lisa-gates.mjs validate|list|needs|contexts|skip-jobs|audit-config"
  );
}

// Realpath both sides rather than comparing URL strings. A raw comparison
// answers "no" through a symlinked checkout, a git worktree, or a /tmp path on
// macOS — all three of which this fleet runs in — so the module would load, run
// nothing, and exit 0. For THIS file that is the worst possible silence: the
// quality workflow pipes its output into a resolver that reads empty input as
// `[]`, reports `configured=false` for every job, and runs the fallback. The
// whole gate registry would be bypassed with nothing reporting it.
if (invokedAsScript(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
