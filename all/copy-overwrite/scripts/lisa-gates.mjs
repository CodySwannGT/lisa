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
 * `needs` is TWO fields wearing one name, split by who can honestly know the
 * answer. A project declares `tools` and `secrets`, because those describe the
 * prover IT named and Lisa has never seen it. The registry declares `deps`,
 * because that describes the prover LISA wrote — see the field's own comment
 * below. For as long as this sentence was written and no registry entry had a
 * `needs`, the promise was true of one half only; the split is what makes it
 * true of both.
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

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, parse, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * The npm manifest filename, named once.
 *
 * Three call sites read one: two resolve a project's own scripts, and the
 * third walks up from a resolved package entry to find the manifest that owns
 * it. A literal repeated across all three is a typo away from a lookup that
 * silently answers "no manifest" — which every one of those readers is written
 * to treat as an ordinary absence.
 */
const PACKAGE_MANIFEST = "package.json";

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
const POST_TOOL = "post-tool";
const COMMIT = "commit";
const PUSH = "push";
/**
 * The moment a pull request's awaited signals post against.
 *
 * Exported because `check-third-party-review-evidence.mjs` resolves reviewers at
 * this moment and nowhere else: a review evidence question only has an answer
 * where there is a pull request head for a status to attach to. Spelling the
 * string a second time over there is how the two drift apart in a rename.
 */
export const PULL_REQUEST = "pull-request";
const PRE_DEPLOY = "pre-deploy";
const POST_DEPLOY = "post-deploy";
const CONTINUOUS = "continuous";

/**
 * The agent tool boundary is TWO moments, and the difference is what a gate
 * declared there is able to do.
 *
 * `pre-tool` runs BEFORE the write and can refuse it: the hook exits non-zero
 * and the tool call never happens, so the file on disk is never touched. Only a
 * check that can decide from the PROPOSED text belongs here — the shipped
 * examples inspect the new content the tool is about to introduce.
 *
 * `post-tool` runs AFTER the write, against the file as it now exists. It
 * cannot un-write anything; what it can do is fail loudly enough that the agent
 * fixes it before moving on, which is why the shipped on-edit hooks exit 2.
 *
 * They are separated because collapsing them silently mis-declares every check
 * on the larger side. Measured on `origin/main`: of the seven Lisa-shipped
 * scripts on the `Write|Edit` boundary, five are registered `PostToolUse` and
 * two `PreToolUse`. Calling all seven `pre-tool` would put five post-write
 * checks behind a contract that promises the write can still be refused — the
 * registry disagreeing with the repository, which the `structural-rules`
 * correction below already establishes is worse than being merely permissive.
 */
const TOOL_MOMENTS = [PRE_TOOL, POST_TOOL];

/** Fixed moments. Two more families take an environment suffix. */
export const MOMENTS = [
  SESSION_START,
  ...TOOL_MOMENTS,
  COMMIT,
  PUSH,
  PULL_REQUEST,
];

/** Moment families that take an `:<environment>` suffix. */
export const MOMENT_FAMILIES = [PRE_DEPLOY, POST_DEPLOY, CONTINUOUS];

/**
 * Moments where nothing posts a status a pull request can be held on.
 *
 * These run on the developer's machine or on the agent's, before there is a
 * pull request for a signal to attach to. Two declarations are refused at them
 * for the same reason — `await`, which names a signal that could never fire,
 * and `caller_chain`, which names the shape of a check-run name that is never
 * posted.
 */
const NO_STATUS_MOMENTS = Object.freeze([
  COMMIT,
  PUSH,
  SESSION_START,
  ...TOOL_MOMENTS,
]);

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
export const GATE_FIELDS = new Set(["run", "needs", "task", "reuse"]);

/**
 * The per-moment field saying how this gate's prover prints a MEASURED failure.
 *
 * `gate-failure-diagnosis.mjs` recognises a fixed set of transcript forms, and
 * every content signature among them is a vitest or `tsc` form. A prover that
 * prints anything else lands in the residual bucket wearing `UNPROVABLE` — the
 * word this fleet reads as "the box, re-run it" — so a run that measured a
 * property and found it wanting is routed into the re-run path
 * (CodySwannGT/lisa#3974).
 *
 * Enumerating other tools' output in the shipped module cannot converge: every
 * project points its gates at provers Lisa has never seen. So the project that
 * OWNS the prover declares how its failure reads, beside the `run:` that names
 * the prover.
 *
 * ## Why per MOMENT and not per gate
 *
 * The first draft put it on the gate, reasoning that output shape is a
 * property of the prover. Two facts overruled that, and the second is the one
 * with consequences.
 *
 * **A gate's prover already varies by moment.** `code-style` runs `lint:staged`
 * at commit and `lint` at pull-request here; the first prints lint-staged's
 * `✖ <task>` banner and the second does not. A gate-level shape would assert
 * one prover's vocabulary for both.
 *
 * **The gate level is a CLOSED allowlist and the moment level is open.**
 * `GATE_FIELDS` is exhaustive, so an older Lisa refuses any gate-level key it
 * does not know — and refuses the WHOLE gates block with it. Measured against
 * the packaged resolver this repository's own quality facade resolves first:
 *
 * ```
 * Invalid gates configuration:
 *   gates."code-style"."failure_shape" is not a moment Lisa knows.
 * ```
 *
 * Every facade then reads `configured=false` and falls through to built-in
 * behaviour, so declaring a shape would silently un-configure every job in the
 * repository until the pin caught up. A moment entry's extra keys are ignored
 * by an older validator instead, which makes the declaration inert there
 * rather than destructive. Inert-until-upgraded is the safe direction; every
 * other per-moment field (`await`, `posted_by`, `evidence`, `caller_chain`)
 * already lives with the same property.
 *
 * The value is a list of literal substrings, not patterns. A regular
 * expression from configuration would be an operator-authored ReDoS run
 * against a multi-megabyte transcript inside a git hook, and a literal is what
 * somebody copying a line out of a failed transcript writes anyway.
 */
export const FAILURE_SHAPE_FIELD = "failure_shape";

/**
 * The per-declaration field naming the job chain this gate's prover sits under.
 *
 * A gate whose prover lives OUTSIDE the quality facade cannot state its own
 * context without it. The facade's contexts are derived by prefixing a gate's
 * label with the chain of jobs that reach the facade, and that chain is a fact
 * about the CALLER, not about the gate. When a project proves one property
 * from a workflow of its own, the caller-wide chain describes a route that
 * never reaches that gate's prover, and the derived name is one nothing posts.
 *
 * Declared per MOMENT, never once for the whole gate, because the chain is a
 * property of one moment's wiring: the same job posts
 * `<facade> / <label>` on the pull-request path and
 * `Release / <facade> / <label>` on the release path. A gate-level value would
 * assert one chain for every moment, which is the depth error this field
 * exists to let a project correct.
 */
export const CALLER_CHAIN_FIELD = "caller_chain";

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

/**
 * Registry field: what a gate needs in order to run.
 *
 * The module doc comment above has promised this field since the registry was
 * written — *"What a gate needs in order to run is expressed as `needs`"* — and
 * until now no registry entry had one. Prose promising a mechanism that does
 * not exist is the same shape as a check reporting satisfied without proving
 * anything, in miniature, and it is closed here rather than filed separately
 * because a generic runner cannot be built without it.
 *
 * Three keys, all optional:
 *
 * - `tools` and `secrets` are the union `needsAt` reports, and a project may
 *   declare its own on top. What Lisa knows and what the project knows are
 *   both true, so they add rather than override.
 * - `deps` is REGISTRY-ONLY, and it is a claim about **Lisa's default prover
 *   for this gate**, not about the gate. `deps: false` says that prover runs
 *   with nothing installed — a shipped `.mjs` importing only `node:` builtins
 *   and its own siblings. Absent means the prover needs the project's
 *   dependencies, which is the safe answer and therefore the default.
 *
 * `deps` is registry-only because it is only ever safe as a claim about a
 * command Lisa wrote. The moment a project names a prover of its own, Lisa has
 * no idea what it imports — so `momentLegs` honours `deps: false` ONLY while
 * the resolved task is still the registry default, and installs otherwise.
 * Skipping an install a prover needed fails as `Cannot find module`, which
 * reads as a broken gate rather than a wrong declaration; the asymmetry is why
 * the unsafe direction is unreachable rather than merely discouraged.
 */

/** Prefix marking a gate, or a config key, that this project invented. */
export const CUSTOM_PREFIX = "x-";

/**
 * `needs.deps: false`, named once.
 *
 * Written as a shared constant rather than repeated inline so that the set of
 * gates making this claim is greppable, and so a reader who wants to know what
 * the claim means has one place to look rather than six identical literals.
 */
const NO_INSTALL = Object.freeze({ deps: false });

const COMMIT_ONWARD = [COMMIT, PUSH, PULL_REQUEST, PRE_DEPLOY, POST_DEPLOY];
const PUSH_ONWARD = [PUSH, PULL_REQUEST, PRE_DEPLOY, POST_DEPLOY];
const PR_ONWARD = [PULL_REQUEST, PRE_DEPLOY, POST_DEPLOY];
const DEPLOY_ONLY = [PRE_DEPLOY, POST_DEPLOY, CONTINUOUS];
const SESSION_ONWARD = [SESSION_START, ...COMMIT_ONWARD];
/**
 * Legal from the moment an agent finishes writing a file, onward.
 *
 * Deliberately starts at `post-tool` and not at `pre-tool`: every gate that
 * uses this list is proved by reading a file, and there is no file to read
 * until the write has happened. A `pre-tool` check has only the proposed text.
 */
const EDIT_ONWARD = [POST_TOOL, ...COMMIT_ONWARD];
/**
 * Legal from the moment a write is PROPOSED, onward.
 *
 * For properties provable from the text alone, which is what makes them
 * refusable: the hook reads what the tool is about to introduce and can decline
 * it. They stay legal at the later moments because the same property is
 * provable against a diff once the write has landed — a project that would
 * rather be told at commit than blocked mid-edit declares it there instead.
 */
const PRE_TOOL_ONWARD = [PRE_TOOL, ...COMMIT_ONWARD];

/**
 * The two gate ids named in more than one shipped table, and the task that
 * takes the dependency audit over.
 *
 * Written as identifiers only where the id is REPEATED — the registry's own
 * keys and the rest of `QUALITY_JOB_GATES` stay literal, because those tables
 * are read as data by a consumer and an identifier is one indirection more than
 * a reader of them needs.
 */
const CODE_STYLE = "code-style";
const DEPENDENCY_VULNERABILITY = "dependency-vulnerability";
const STRUCTURAL_RULES = "structural-rules";
const FORMAT_CONFORMANCE = "format-conformance";
/** The gate id the verification-coverage provers all prove. */
const COVERAGE_ADEQUACY = "coverage-adequacy";

/** The scan the structural-rules provers all run. */
const AST_GREP_ON_EDIT = "ast-grep scan <edited-file>";

/** The one pre-commit invocation that proves three properties at once. */
const LINT_STAGED_COMMAND = "<runner> lint-staged --config .lintstagedrc.json";

/** The task a project names to reproduce that invocation. */
const LINT_STAGED_TASK = Object.freeze(["lint:staged"]);

/** The task a project would name to take the dependency audit over. */
const SECURITY_AUDIT_TASK = "security:audit";

/** The script every npm stack ships for dead-code detection. */
const KNIP_CHECK_TASK = "knip:check";

/** The older, unnamespaced fallback the same stacks still carry. */
const KNIP = "knip";

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
    // Edit-legal on the same evidence that moved `structural-rules` to
    // commit-onward: `lint-on-edit.sh` (TypeScript) and `rubocop-on-edit.sh`
    // (Ruby) already lint every agent write, and both exit 2 on a finding.
    // That enforcement happens on the highest-frequency surface Lisa owns, and
    // until now no declaration could reach it.
    moments: EDIT_ONWARD,
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
    // Edit-legal: `format-on-edit.sh` runs the formatter on every agent write.
    // `rubocop-on-edit.sh` proves this property too — its own header says
    // "RuboCop serves as both formatter and linter" — so one Ruby invocation
    // stands for both this gate and `code-style`, and may stand down only when
    // BOTH are covered.
    moments: EDIT_ONWARD,
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
    label: "🎭 Browser Journeys",
    // The label used to name the vendor. `contextsFor` emits the union of the
    // current label and everything here, so a ruleset generated during the
    // migration requires both strings and neither side has to remember the
    // rename happened.
    previousLabels: ["🎭 Playwright E2E Tests"],
    summary: "Browser journeys pass end to end.",
    task: "test:e2e",
    declareOnly:
      "Only the phaser stack ships a browser e2e runner under this name. Elsewhere, point `run:` at your own suite.",
    moments: [...PR_ONWARD, CONTINUOUS],
    work: "specs run",
    costly: true,
  },
  "e2e-native": {
    label: "📱 Native Device Journeys",
    previousLabels: ["📱 Maestro Native E2E"],
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
  "behavior-contract": {
    label: "🧾 BDD Behavior Contract",
    summary:
      "Every declared behavior is mapped to an automated test, or waived on the record.",
    task: "check:behavior-contract",
    shippedAs: "bdd:coverage",
    declareOnly:
      "The prover ships as `scripts/check-bdd-coverage.mjs`, and the expo stack ships the task that invokes it as `bdd:coverage`, which an expo project resolves through automatically. Elsewhere, point `run:` at your own behavior-contract check.",
    // THE gate for this property, and the only one. The job used to answer to a
    // `bdd_mode` workflow input carrying its own three states, one of which —
    // `bootstrap` — was a time-boxed grace period: a visible, non-blocking check
    // with a named owner and an expiry date. That is `optional` plus paperwork,
    // and it hid red while calling itself adoption. The owner retired it, and
    // the private axis went with it, so the three levels here are the whole
    // vocabulary: `required` to make the context a merge condition, `optional`
    // to see the red without being blocked by it, `off` to say on the record
    // that this project does not govern the property.
    moments: PR_ONWARD,
    work: "scenarios declared",
  },
  "state-classification": {
    label: "🧬 State Classification",
    summary:
      "Every persistent entity carries a reset policy, and every fixture-owned entity has something that sweeps it.",
    task: "check:state-classification",
    // `check-state-classification.mjs` imports `node:fs`, `node:path`,
    // `node:url` and two shipped siblings. Nothing from `node_modules`.
    needs: NO_INSTALL,
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
    label: "🔎 Structural Rules",
    // Registry history proves this context is retired. It feeds doctor and the
    // live ruleset sweep; it must never be added to a newly generated ruleset,
    // because no current workflow can post it.
    previousLabels: ["🔎 AST Grep Scan"],
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
    //
    // Corrected once more, one moment earlier, on the identical argument:
    // `sg-scan-on-edit.sh` runs `ast-grep scan` on every agent write, in both
    // the TypeScript and Ruby stacks, and exits 2 on a finding. The same gate,
    // the same reasoning, the same repository-versus-registry disagreement.
    moments: EDIT_ONWARD,
    work: "rules loaded",
  },
  "suppression-residue": {
    label: "🚫 Suppression Residue",
    summary:
      "No new directive silencing the linter, type checker, or formatter.",
    task: "check:suppressions",
    // The one shipped prover is a genuine `PreToolUse` hook — it inspects the
    // text the tool is about to write and exits 2, so the suppression never
    // reaches the file. Named for the residue rather than for any single
    // directive: the linter, type-checker and formatter each spell theirs
    // differently, in every language Lisa supports, and a gate id naming one
    // spelling would be a vendor id in the sense the registry header forbids.
    declareOnly:
      "No npm stack ships a script for this, and the exception is not a gap waiting on one. The prover Lisa ships is an agent hook that reads the text the tool is about to write and refuses it, which no `npm run` invocation can do — a script can only report on a suppression already in the file. Declaring this gate at a later moment means pointing `run:` at your own check.",
    moments: PRE_TOOL_ONWARD,
    work: "files inspected",
  },
  "migration-provenance": {
    label: "🗃️ Migration Provenance",
    summary:
      "Schema migrations are generated from the model, not hand-written.",
    task: "check:migrations",
    // Also a `PreToolUse` refusal: the shipped hook blocks a write to a
    // migration file outright, because a hand-edited migration drifts from the
    // entity metadata it is supposed to describe and the drift is not visible
    // until a deploy applies it. Stack-flavoured but registry-resident, the
    // same way `e2e-native` is — the property is "this migration came from the
    // model", which is true of any ORM that generates them.
    declareOnly:
      "No npm stack ships a prover. One stack ships `migration:generate`, but that is the generator this gate assumes was used, not a check that it was — and what a migration must be generated FROM is ORM-specific, so there is no one script to ship. The shipped prover is an agent hook that refuses the hand-edit outright; declaring this gate at a later moment means pointing `run:` at your own check.",
    moments: PRE_TOOL_ONWARD,
    work: "migrations checked",
  },
  "dead-code": {
    label: "🗑️ Dead Code Detection",
    summary: "No unused exports or dependencies.",
    task: "check:dead-code",
    shippedAs: KNIP_CHECK_TASK,
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
    task: SECURITY_AUDIT_TASK,
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
    // Both provers are `lisa-work-item.mjs`, which imports `node:fs`,
    // `node:path`, Node's own process-spawning builtin, and one shipped
    // sibling. It shells out to `gh`, which the runner image carries.
    needs: NO_INSTALL,
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
    // The commit-msg prover is commitlint, which is a dependency — but the
    // `declareOnly` below says there is no repo-wide script form, so any
    // project declaring this gate names a `run:` of its own and the
    // registry claim is never the one that decides. Left absent rather
    // than guessed: absent means install, which is the safe answer.
    declareOnly:
      "Proved by the commit-msg hook running commitlint against one message file. There is no repo-wide script form.",
    moments: COMMIT_ONWARD,
  },
  "threshold-monotonicity": {
    label: "📐 Threshold Ratchet",
    summary: "Quality thresholds may tighten, never loosen.",
    task: "check:thresholds",
    // `threshold-ratchet.mjs` imports `node:fs`, `node:path`, `node:url`,
    // Node's own process-spawning builtin, and two siblings beside it.
    needs: NO_INSTALL,
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
  "learnings-budget": {
    label: "📚 Learnings Budget",
    summary: "The project learnings ledger stays inside its hard budget.",
    task: "check:learnings-budget",
    declareOnly:
      "Lisa ships the prover as the `lisa check-learnings-budget` CLI subcommand, not as an npm script, so no stack template ships this task. The `📚 Learnings Budget` job runs the CLI itself when nothing is declared; declare `run:` only to point at your own prover.",
    // CORPUS HEALTH, not change correctness: this can fail on a commit that
    // touched nothing near the ledger, because the ledger is a shared document
    // that grows. `artifact-freshness` has the same shape and the same moments,
    // and the reasoning is the same in both — a document that must stay
    // serveable is worth checking at every moment a change is offered, not only
    // at the one where the change happened to touch it.
    moments: COMMIT_ONWARD,
  },
  "conflict-residue": {
    label: "🩹 Conflict Markers",
    summary: "No leftover merge-conflict markers in tracked files.",
    task: "check:conflict-markers",
    // `check-conflict-markers.mjs` imports `node:fs`, `node:path`,
    // `node:process`, Node's own process-spawning builtin, and one shipped
    // sibling; it enumerates tracked files through `git ls-files`. Nothing
    // from `node_modules`.
    needs: NO_INSTALL,
    moments: COMMIT_ONWARD,
  },
  "version-duplication": {
    label: "🧮 Duplicate Versions",
    summary: "One declared version per dependency.",
    task: "check:duplicate-versions",
    // `check-duplicate-versions.mjs` imports `node:fs`, `node:path`,
    // `node:process`, `node:url` and one sibling.
    needs: NO_INSTALL,
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
  lint: CODE_STYLE,
  lint_slow: "code-style-slow",
  typecheck: "type-correctness",
  verification_coverage: COVERAGE_ADEQUACY,
  test_unit: "test-correctness",
  test_mutation: "test-meaningfulness",
  test_integration: "test-integration",
  // Declared in `playwright-e2e.yml` rather than `quality.yml` since the
  // browser suite became a workflow of its own. The job kept its id, its
  // context name and its façade, so the pairing is unchanged and stays here:
  // the question this table answers is "which gate governs this job", and the
  // answer does not depend on which file the job is written in.
  playwright_e2e_aggregate: "e2e-browser",
  format: FORMAT_CONFORMANCE,
  build: "build-integrity",
  work_item_traceability: "traceability",
  performance_budget: "performance-budget",
  test_node_suites: "test-node-suites",
  environment_reset: "environment-reset",
  environment_reseed: "environment-reseed",
  dead_code: "dead-code",
  // Governs the property in EVERY workflow that enforces it, which is what
  // #2932 turned on. `quality.yml` and `quality-rails.yml` both run the check
  // in a job named `📚 Learnings Budget`; `plugins-sync.yml` used to run the
  // same command as one step among fifteen inside `🧩 Plugin artifacts match
  // source` — a REQUIRED context the `learnings_budget` skip token could not
  // reach, so the property stayed enforced here no matter what a project
  // declared. That step moved into this job, so one declaration now decides
  // every place the property is proved.
  learnings_budget: "learnings-budget",
  conflict_markers: "conflict-residue",
  sg_scan: STRUCTURAL_RULES,
  npm_security_scan: DEPENDENCY_VULNERABILITY,
  threshold_ratchet: "threshold-monotonicity",
  e2e_coverage: "journey-coverage",
  bdd_coverage: "behavior-contract",
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
  // A SECOND prover of a gate `npm_security_scan` already carries. The table
  // is keyed by job precisely so this is expressible: the question it answers
  // is "which gate governs this job", and two jobs may honestly answer the
  // same gate when they prove one property at different depths. What must
  // stay singular is the LABEL — only the context-carrying job may be named
  // it, or two jobs post one branch-protection context.
  snyk: "dependency-vulnerability",
});

/**
 * Decide which mapped quality jobs may stand down before runner allocation.
 *
 * This is intentionally much narrower than `resolveMoment`. The in-job gate
 * facade remains the execution authority and still resolves the runner, task,
 * aliases, interceptors and fallbacks. Preallocation has exactly one safe
 * negative answer: a declaration that resolves to `off`, because the current
 * facade already runs zero proving steps in that state. Everything else runs
 * the existing job.
 *
 * Returning every mapped job is the fail-safe shape. A consumer using an
 * older resolver has no `quality-plan` command, and the workflow treats that
 * command failure as an empty plan — also run everything. Neither absence nor
 * ambiguity can manufacture a green required context.
 * @param {object} options Planning inputs.
 * @param {object} [options.gates] The project gates block.
 * @param {string} options.moment The workflow moment.
 * @returns {Readonly<Record<string, "run"|"skip">>} One action per mapped job.
 */
export function qualityJobPlan({ gates = {}, moment }) {
  const off = new Set(
    resolveMoment({ gates, moment, includeOff: true })
      .filter(gate => gate.level === "off")
      .map(gate => gate.id)
  );
  return Object.freeze(
    Object.fromEntries(
      Object.entries(QUALITY_JOB_GATES).map(([job, gate]) => [
        job,
        off.has(gate) ? "skip" : "run",
      ])
    )
  );
}

/**
 * The gates a hand-written job already posts a branch-protection context for.
 *
 * Exactly one job may be named a gate's `label`, or two jobs post one context
 * and branch protection matches whichever reported last. So the generic runner
 * emits no leg for anything in here — not because those gates are unimportant,
 * but because their context is spoken for.
 *
 * THIS IS THE MIGRATION, and it is one act rather than two. There is no
 * separate ledger of "gates that moved onto the runner", because a ledger
 * nothing depends on is a comment wearing code's clothes:
 * `tests/integration/quality-gate-skip-jobs-mapping.test.ts` derives
 * `QUALITY_JOB_GATES` from the jobs the shipped workflows actually define and
 * asserts equality, so a deleted job MUST lose its row in the same commit —
 * and losing the row is exactly what hands the gate to the runner. Forgetting
 * a ledger entry could have been silent; forgetting the row cannot be.
 *
 * The deletion order still matters and is still a safety property: a block
 * deleted before its leg has reported green turns a proving check into a
 * silently absent one. What enforces it is the sequence, not a list — the leg
 * cannot exist until the block is gone, so the block is deleted only once the
 * gate's declaration has been observed running through some other leg.
 * @returns {readonly string[]} Sorted gate ids, deduplicated.
 */
export function jobBackedGates() {
  return Object.freeze(
    [...new Set(Object.values(QUALITY_JOB_GATES))].sort((left, right) =>
      left.localeCompare(right)
    )
  );
}

/** What a leg does when it runs. */
export const LEG_ACTIONS = Object.freeze(["run", "report", "unproved"]);

/** Minutes a leg gets when its gate is not marked `costly`. */
export const LEG_TIMEOUT_MINUTES = 15;

/** Minutes a leg gets when its gate IS marked `costly`. */
export const COSTLY_LEG_TIMEOUT_MINUTES = 60;

/**
 * What a task may be spelled with before it reaches a leg's shell.
 *
 * The same class `quality.yml`'s in-job resolver applies, and it must be
 * applied HERE as well rather than instead: a leg receives an already-resolved
 * task through the matrix, so the workflow has no second chance to refuse it.
 * `.lisa.config.json` is a file a pull request can edit, and the resolved value
 * reaches `run: $GATE_RUNNER $GATE_TASK` as a deliberate word split. A colon is
 * admitted because task names carry one (`test:cov`, `lint:staged`); `$( )`,
 * backticks, `;`, `&&` and quotes are not.
 */
const TASK_PATTERN = /^[A-Za-z0-9:._@/= -]+$/;

/**
 * Whether a resolved prover is owned outside the generic task runner.
 *
 * Keep this classification shared by every consumer. A new integrated mode
 * must not become an unproved matrix leg in one path and an orphaned package
 * script in another.
 * @param {string} mode The canonical mode from `resolveMoment`.
 * @returns {boolean} True when the governing surface owns the proof.
 */
function isNonRunnerProverMode(mode) {
  return mode === "await" || mode === "intercept" || mode === "builtin";
}

/**
 * The matrix legs a moment's declarations imply, one leg per posted context.
 *
 * This is the pull-request moment's answer to `lisa-run-gates.mjs`. The commit
 * and push moments have had a generic executor since the hooks stopped
 * hardcoding their step lists; the pull-request moment did not, so a gate
 * outside the hand-written set was unreachable from a declaration no matter
 * what a project wrote. That asymmetry is the root cause behind several filed
 * symptoms, and it closes by making the workflow ask the registry too.
 *
 * ## Which gates get a leg, and why `off` is included
 *
 * Every gate the project DECLARES at this moment, including the ones declared
 * `off`, minus the ones a hand-written job already posts a context for.
 *
 * Including `off` is the half that is easy to get wrong and expensive to get
 * wrong. A required context that never reports does not read as skipped — it
 * holds the pull request at "Expected — Waiting for status to be reported",
 * forever. `contextsFor` will not emit a context for an `off` gate, so the two
 * agree for a project whose ruleset is generated from the same declaration; a
 * ruleset that still names it must still see it report. So an `off` leg runs,
 * says out loud that the project turned this gate off, and succeeds.
 *
 * ## What a leg cannot do, and says instead
 *
 * A leg's body is `$runner $task`. Where nothing resolves to a task — a custom
 * `x-` gate the project declared without a `run:`, say — the leg reports
 * `unproved` and FAILS. That is deliberate and it is the distinction between
 * this and the defect it replaces: a job that skips its proving step when the
 * prover is missing reports green having measured nothing. Absent is not a
 * skip, and a leg that measured nothing must be loud rather than absent.
 *
 * `await`, `intercept`, and `builtin` gates get no leg at all, which is a
 * different statement: those are proved by a vendor, by Lisa internally, or
 * by the governing facade, and a leg would be a second reporter for one
 * property.
 * @param {object} options Resolution inputs.
 * @param {object} options.gates The project gates block.
 * @param {string} options.moment The moment to resolve.
 * @param {string} [options.runner] The task runner.
 * @param {object|null} [options.scripts] The project's package scripts.
 * @returns {object[]} One leg per context this moment must post.
 */
export function momentLegs({
  gates,
  moment,
  runner = DEFAULT_RUNNER,
  scripts = null,
}) {
  const spokenFor = new Set(jobBackedGates());
  const legs = [];
  for (const gate of resolveMoment({
    gates,
    moment,
    runner,
    includeOff: true,
    scripts,
  })) {
    if (spokenFor.has(gate.id)) continue;
    if (isNonRunnerProverMode(gate.mode)) continue;

    const definition = REGISTRY[gate.id];
    const action =
      gate.level === "off" ? "report" : gate.task ? "run" : "unproved";
    if (action === "run" && !TASK_PATTERN.test(gate.task)) {
      throw new Error(
        `gates."${gate.id}"."${moment}" resolves to task ` +
          `${JSON.stringify(gate.task)}, which is not a plain word.`
      );
    }
    // `deps: false` is a claim about LISA'S prover, so it may only be honoured
    // while Lisa's prover is what resolved. A project `run:`, or a `shippedAs`
    // alias standing in for a default that does not exist here, both mean the
    // command is one Lisa did not write and cannot make claims about.
    //
    // PROVENANCE, not spelling. Comparing only the resolved task string made
    // the first of those two cases unreachable whenever the project's `run:`
    // named the same script as the registry default — `run: check:duplicate-versions`
    // is a project prover that happens to be spelled like Lisa's, and Lisa knows
    // nothing about what it imports. The install was skipped for it anyway, and
    // a prover that needed the project's dependencies died with `Cannot find
    // module`, which reads as a broken gate rather than as a declaration Lisa
    // was not entitled to trust. `gate.declared` answers "did the project name
    // this" directly, so the answer no longer depends on the two commands
    // having different names.
    const registryTask =
      definition?.taskAt?.[momentFamily(moment)] ?? definition?.task ?? null;
    const lisasOwnProver =
      gate.declared === null &&
      gate.alias === null &&
      gate.task !== null &&
      gate.task === registryTask;
    legs.push({
      gate: gate.id,
      label: gate.label,
      level: gate.level,
      action,
      // Emitted empty rather than omitted for a leg that runs nothing. A
      // matrix `include:` entry with a missing key leaves `matrix.task`
      // unset, and `run: $GATE_RUNNER $GATE_TASK` with an unset task runs the
      // runner bare — which for `npm run` prints the script list and exits 0.
      runner: action === "run" ? runner : "",
      task: action === "run" ? gate.task : "",
      install:
        action === "run" &&
        !(definition?.needs?.deps === false && lisasOwnProver),
      timeout:
        definition?.costly === true
          ? COSTLY_LEG_TIMEOUT_MINUTES
          : LEG_TIMEOUT_MINUTES,
      summary: definition?.summary ?? "",
    });
  }
  return legs;
}

/**
 * Jobs that prove a gate some OTHER job carries the label for.
 *
 * A gate may have several provers; it has exactly one job whose `name:` is its
 * `label`, because that name is the branch-protection context. Anything that
 * has to answer "which job represents this gate" — the gate report, a ruleset
 * comparison, an agent reading a consumer checkout — needs to pick that one,
 * and needs to pick it for a reason.
 *
 * Before this the reason was POSITION: `invertJobTable` reversed the entries so
 * the first declaration of a gate won. That produced the right answer and was
 * a trap, because reordering the table above would silently change which job a
 * gate reports as its own, with nothing to notice. The distinction is a
 * property of the jobs, so it is written down as one.
 *
 * Membership is the narrow claim it looks like: this job proves the property,
 * and it is not the one a ruleset matches. It does NOT mean the job is
 * optional — `snyk` covers dev-dependency and supply-chain depth that the
 * ship-scope audit does not, which is why both run.
 */
export const SECONDARY_PROVER_JOBS = Object.freeze(["snyk"]);

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
export const UNGATED_QUALITY_JOBS = Object.freeze({});

/**
 * Gated jobs that ALSO read an adoption input, and why that is not yet fixed.
 *
 * A job with a `QUALITY_JOB_GATES` row has a declaration that decides whether
 * it runs. A job whose `if:` additionally reads a workflow input has a SECOND
 * control, and the two can disagree — which is worse than one control in the
 * wrong place, because the losing one fails silently.
 *
 * This table exists for the same reason `UNGATED_QUALITY_JOBS` does: the defect
 * is not that the second control exists, it is that nothing SAID SO anywhere a
 * consumer could read. `tests/integration/quality-dual-adoption-controls.test.ts`
 * derives the set from the shipped workflows and refuses a job that is in
 * neither table, so a second one cannot appear in silence — which is the
 * property that survives the individual entries being retired.
 *
 * `owner` is the issue that resolves the entry, so it carries its own expiry.
 *
 * EMPTY, as of #3021. The last entry was `verification_coverage`, which carried
 * the `coverage-adequacy` row and also gated on `verify_enforced` (default
 * `false`), so a project declaring the gate `required` at pull-request got no
 * job at all. Both halves of that collapse are now done: #3016 retired
 * `bdd_mode`, #3021 retired `verify_enforced`.
 *
 * Retiring an entry was never a matter of deleting the input, and recording how
 * it was actually done matters more than the empty object. Measured on
 * `verify_enforced` across every caller of `quality.yml` on its own default
 * branch: 22 callers, 2 setting it `true`, 20 relying on the default. With the
 * input simply gone the job runs for all 22 and the façade's `configured=false`
 * fallback runs a bespoke check most of them fail, because an undeclared gate
 * falls back rather than standing down. The collapse was survivable only
 * because the job was ALSO made to stand down when nothing declares its gate —
 * see `DECLARATION_REQUIRED_JOBS`, which is where that debt now lives.
 */
export const DUAL_ADOPTION_CONTROLS = Object.freeze({});

/**
 * Façade jobs whose built-in does NOT run for a project that declared nothing.
 *
 * **This inverts the registry's central rule, so it is written down.** Every
 * other façade job treats an absent declaration as "prove it my way": the
 * built-in runs, and only an explicit `off` stands the job down. That is what
 * keeps a property enforced for the projects that never adopted the registry,
 * and it is why `unconfiguredAt` reports rather than fails.
 *
 * A job in here does the opposite. Undeclared means zero proving steps and a
 * green required context, with a `::warning::` saying so. That is a control
 * reporting success while proving nothing — normally the exact defect this
 * repository hunts — so membership is never a convenience. It is legitimate
 * only where the built-in was ALREADY not running for the population in
 * question, and turning it on would be a new enforcement delivered by a version
 * bump rather than a preserved one.
 *
 * `verification_coverage` is the one case that qualifies, and the numbers are
 * the argument (#3021). Its second control, the `verify_enforced` input,
 * defaulted to `false`, so the job did not start at all for 20 of the 22
 * callers of `quality.yml`. Retiring the input without this stand-down would
 * have started a bespoke spec-delta check on all 20 — a fleet reddened by a
 * refactor. Standing down instead reproduces, byte for byte, the green skipped
 * job those callers already had.
 *
 * `owner` is the issue that RETIRES the entry, so the inversion carries its own
 * expiry rather than becoming permanent by inattention. Retiring it is a fleet
 * migration and not an edit: every caller has to declare the gate explicitly —
 * `off` for the ones that never ran it, `required` with `run: check:verification`
 * for the ones that did — and only then can an absent declaration be made fatal.
 *
 * `tests/integration/hardcoded-invocation-inventory.test.ts` refuses a façade
 * job that reports green having run nothing UNLESS it is recorded here, and
 * checks that a recorded job's proving step really is gated on the declaration.
 * So a second such job cannot appear in silence, and an entry cannot outlive
 * the wiring it describes.
 */
export const DECLARATION_REQUIRED_JOBS = Object.freeze({
  verification_coverage: Object.freeze({
    gate: COVERAGE_ADEQUACY,
    reason:
      "The job proves a per-change property with a bespoke spec-delta check that no project declared and 20 of 22 callers never ran, because its retired `verify_enforced` input defaulted to false. Falling back to that built-in for an undeclared project would start enforcing it on all 20 the moment the input was retired — enforcement delivered by a version bump rather than by a decision. Standing down reproduces exactly the green skipped job they already had, and says so in a warning rather than in silence.",
    owner: "#3147",
  }),
});

/**
 * Jobs that are NOT DECLARABLE, and why that is a rule rather than an omission.
 *
 * **A gate whose job is to detect silencing cannot itself be silenceable.**
 *
 * Every other job in `quality.yml` answers to the project's declaration: set
 * its gate `off` and it stands down, or name its token in `skip_jobs` and it
 * never starts. The jobs listed here judge that declaration, or judge whether
 * the merge rules it feeds are being satisfied by anything real. Giving them an
 * off-switch lets a project say "do not check whether I switched checks off",
 * which is not a weaker version of the same claim — it is the claim that makes
 * every other declaration unverifiable.
 *
 * So membership means three things at once, and the invariant is worth stating
 * as three because two of them were true of `skipped_required_checks` while the
 * third was not, and the missing one was the whole defect (#2933):
 *
 *  1. no `QUALITY_JOB_GATES` row — nothing to declare `off`;
 *  2. no entry in `SKIP_JOB_TOKENS`, and no `skip_jobs` token in the job's
 *     `if:` — nothing to name in a caller;
 *  3. no `UNGATED_QUALITY_JOBS` exemption — this table is the reason, and a
 *     second record of the same job in the "no gate yet" table would say the
 *     opposite: that a gate is still owed.
 *
 * `skipped_required_checks` was exempt from the registry as a meta-gate and
 * carried a skip token anyway, so the exemption bought it nothing: the
 * off-switch it was exempted from acquiring already existed one layer down.
 * #2846 read the missing row as an oversight and proposed a declarable gate.
 * The owner's ruling was to remove the token instead and match
 * `gate_config_validity`, which is exempt AND has no token, which is why
 * nothing can silence it.
 *
 * This is NOT a licence to make a gate unskippable because it is important.
 * The test is circularity, not severity: would the off-switch disable the
 * checking of off-switches? `test_unit` is far more important than either of
 * these and is fully declarable, because declaring it `off` removes its
 * required context too — one declaration drives both sides, and the result is
 * visible rather than vacuous.
 *
 * `tests/integration/quality-non-declarable-jobs.test.ts` enforces all three
 * clauses against the shipped workflow, so a token added back fails there
 * rather than shipping.
 */
export const NON_DECLARABLE_JOBS = Object.freeze({
  gate_config_validity: Object.freeze({
    reason:
      "Runs `lisa-gates.mjs validate` against the project's own `gates` block. A project able to declare this `off` — or to name it in `skip_jobs` — could switch off validation OF ITS OWN gate declarations. Everything else in the workflow answers to the config; this is the one job that judges it.",
  }),
  skipped_required_checks: Object.freeze({
    reason:
      "Detects a `skip_jobs` token that silences a context the ruleset still requires, which GitHub counts as SATISFIED. An off-switch here means 'I may silence a required check without anyone objecting' — the declaration that switches off the check on declarations that switch off checks.",
  }),
});

/**
 * How a hardcoded invocation relates to the gate façade.
 *
 * Two classes, because they fail differently and are fixed differently. A
 * `consults-then-falls-back` step resolves the declaration FIRST and runs a
 * written-in command only when nothing resolves, so a project can take it over
 * by declaring the gate. A `never-consults` step has no config branch at all:
 * the tool is written into the script, and there is nothing a project could
 * declare that would replace it.
 */
export const CONSULTS_THEN_FALLS_BACK = "consults-then-falls-back";

/** A step with no config branch: the tool is written into the script. */
export const NEVER_CONSULTS = "never-consults";

/** Both classes, for validation and for reporting. */
export const FACADE_CLASSES = Object.freeze([
  CONSULTS_THEN_FALLS_BACK,
  NEVER_CONSULTS,
]);

/** The reusable workflow most façade jobs live in. */
const QUALITY_WORKFLOW = ".github/workflows/quality.yml";

/** The reusable workflow the browser suite moved to. */
const PLAYWRIGHT_WORKFLOW = ".github/workflows/playwright-e2e.yml";

/**
 * The shipped pre-push hook, as the template that installs it.
 *
 * The repository's own `.husky/pre-push` is a copy of this with the resolver
 * paths localised; naming the TEMPLATE is what makes the entry mean the same
 * thing in a consumer, which has the installed copy and not this one.
 */
const PRE_PUSH_HOOK = "typescript/copy-contents/.husky/pre-push";

/**
 * The shipped pre-commit hook, as the template that installs it.
 *
 * Sibling of `PRE_PUSH_HOOK` and absent from this table until #2955: four
 * `lisa_gate_covers` sites guarding five properties, every one with a
 * written-in else branch, and not one `commit`-moment entry to describe them.
 * The inventory's own header warns about exactly this — "a `lisa_gate_covers`
 * call with no entry is a gap the inventory silently omits" — and the sweep
 * that enforced it was pinned to two plugin hook directories, so this file was
 * outside the scope the control chose.
 */
const PRE_COMMIT_HOOK = "typescript/copy-contents/.husky/pre-commit";

/**
 * The shipped verification-coverage extension to the pre-push hook.
 *
 * Sourced by `.husky/pre-push` through its managed verification slot, and it
 * consults nothing: no `lisa_gate_covers`, no `lisa-run-gates`, no
 * `lisa-gates`. A project that declares `coverage-adequacy` at push still has
 * this run its own written-in command.
 */
const PRE_PUSH_VERIFY = "phaser/copy-overwrite/.husky/pre-push.verify";

/**
 * Where the Codex agent surface keeps its own copies of the on-edit scripts.
 *
 * The fifteen generated per-agent copies are byte-identical to their
 * `plugins/src` originals and are therefore fairly represented by them. These
 * four are NOT: they differ, and all four match zero of `lisa_gate_covers`,
 * `lisa-run-gates` and `lisa-gates`. Representing them by the originals would
 * describe a file that is not the one that runs.
 */
const CODEX_SCRIPTS = "src/codex/scripts";

/** A façade branch that reports a missing adapter and proves no property. */
const NO_FALLBACK_PROVER = "(none — the fallback announces the absent adapter)";

/**
 * What each façade job runs when nothing resolves, and under which step names.
 *
 * Keyed by job id so the gate comes from `QUALITY_JOB_GATES` rather than being
 * written twice. `steps` are the exact step names carrying
 * `if: steps.gate.outputs.configured == 'false'` — named rather than counted,
 * because a report that cannot say WHICH built-in ran is not much better than
 * no report, and because the inventory test can then fail on a renamed step
 * instead of silently checking nothing.
 */
const QUALITY_FALLBACKS = Object.freeze({
  lint: {
    command: "<package-manager> run lint",
    steps: ["🦀 Verify oxlint is installed", "🧹 Run linter (oxlint + eslint)"],
  },
  lint_slow: {
    command: "<package-manager> run lint:slow",
    steps: ["🐢 Run slow lint rules"],
  },
  typecheck: {
    command: "<package-manager> run typecheck",
    steps: ["🔍 Run type check"],
  },
  build: {
    command: "<package-manager> run build",
    steps: ["🏗️ Build project"],
  },
  format: {
    command: "<package-manager> run format:check",
    steps: ["📐 Check formatting"],
  },
  test_unit: {
    // `test:cov`, not `test:unit`: the CI fallback proves the suite AND the
    // coverage thresholds in one run, so seeding the registry default would
    // stop enforcing coverage here without changing a single line of config.
    command: "<package-manager> run test:cov",
    seedRun: ["test:cov"],
    steps: [
      "🧪 Run unit tests with coverage",
      "⏭️ Skip unit tests (no test:unit script)",
    ],
  },
  test_integration: {
    command: "<package-manager> run test:integration",
    steps: [
      "🧪 Run integration tests",
      "⏭️ Skip integration tests (no test:integration script)",
    ],
  },
  test_mutation: {
    command: "<package-manager> run test:mutation",
    steps: [
      "🧬 Run mutation-testing gate (diff-only, self-skips when disabled)",
    ],
  },
  performance_budget: {
    command: "<package-manager> run lighthouse:check",
    seedRun: ["lighthouse:check"],
    steps: [
      "⚡ Run the performance budget (lighthouse:check)",
      "⏭️ Skip the performance budget (no export:web script)",
    ],
  },
  test_node_suites: {
    command:
      "lisa-test-run --profile <stack-or-node> --adapter direct -- node <lisa>/scripts/lisa-test-node.mjs",
    seedRun: ["test:node"],
    steps: ["🧪 Run .mjs suites (lisa-test-node)"],
  },
  environment_reset: {
    // Lisa ships no implementation behind the environment façade, so the
    // fallback announces the absence rather than substituting for it. Nothing
    // to seed: the declaration IS the adapter, and there is no task to name.
    command: NO_FALLBACK_PROVER,
    seedRun: [],
    steps: ["♻️ No environment reset adapter declared"],
  },
  environment_reseed: {
    command: NO_FALLBACK_PROVER,
    seedRun: [],
    steps: ["🌱 No environment reseed adapter declared"],
  },
  npm_security_scan: {
    command: "<package-manager> audit, filtered through audit.ignore*.json",
    seedRun: [SECURITY_AUDIT_TASK],
    steps: ["📋 Load audit exclusions", "🔒 Run security audit"],
  },
  dead_code: {
    command: "<package-manager> run knip:check",
    seedRun: [KNIP_CHECK_TASK, KNIP],
    steps: ["🗑️ Run dead code detection (knip)"],
  },
  learnings_budget: {
    // The built-in runs Lisa's own in-tree checker on the Lisa source repo and
    // the published CLI everywhere else, AT THE PROJECT'S OWN VERSION — read
    // from its `@codyswann/lisa` dependency range, because the literal that
    // used to be written here drifted sixty releases behind (#2932). Nothing is
    // seeded: no npm stack ships a task for this, and a project naming one
    // would replace a branch that also decides WHICH prover to run.
    command:
      "bun scripts/check-learnings-budget.ts (Lisa source) or bunx @codyswann/lisa@<project version> check-learnings-budget",
    seedRun: [],
    steps: ["📚 Check learnings budget"],
  },
  conflict_markers: {
    // The built-in resolves the shipped `check-conflict-markers.mjs` from
    // whichever of three locations the project has it in, so the command is a
    // resolution rather than a task. Nothing is seeded: a project naming one
    // task would replace a probe that also decides WHICH copy to run.
    command: "node <lisa>/scripts/check-conflict-markers.mjs",
    seedRun: [],
    steps: ["🩹 Check for leftover conflict markers"],
  },
  sg_scan: {
    // Measured, not assumed: the whole ast-grep pipeline hangs off the
    // `🔍 Check for sgconfig.yml` discovery step, so declaring the gate takes
    // the scan AND the rule tests with it. A one-task declaration would
    // therefore narrow what is proved while reading like a takeover, so
    // nothing is seeded here — the gap stays reported instead.
    command: "ast-grep scan --config sgconfig.yml, plus the rule tests",
    seedRun: [],
    steps: ["🔍 Check for sgconfig.yml", "⏭️ AST Grep Skipped (no config)"],
  },
  verification_coverage: {
    // Reachable only BEHIND a declaration since #3021: this job stands down
    // when nothing declares `coverage-adequacy`, so the built-in runs only for
    // a project that DID declare it and whose declaration resolves to no
    // runnable task. See `DECLARATION_REQUIRED_JOBS` for why that inversion is
    // legitimate for this one job.
    //
    // `seedRun` stays EMPTY, and now for a stronger reason than "no task
    // reproduces it". Seeding declares what a built-in is proving today so the
    // fallback can be retired; for an undeclared project this built-in proves
    // nothing at all, so a seeded `required` would not take a built-in over —
    // it would switch a check ON, which is the reddening #3021 exists to
    // prevent. Turning it on is a decision, made per repository under #3147,
    // and `check:verification` is the task that reproduces it when it is.
    command: "(bespoke — requires a verification spec delta on feat/fix)",
    seedRun: [],
    steps: ["✅ Require a verification (e2e) spec delta on feat/fix"],
  },
  work_item_traceability: {
    command: "node <lisa>/scripts/lisa-work-item.mjs validate-pr",
    seedRun: ["check:work-item"],
    steps: ["🔗 Validate Work-Item traceability"],
  },
  threshold_ratchet: {
    // The built-in resolves the shipped `check-threshold-ratchet.mjs` and
    // diffs against the merge-base, branching on whether the head ref exists
    // on the remote. Nothing is seeded: the pair of invocations is the check,
    // and a one-task declaration would silently drop the head-ref arm, so the
    // gap stays reported rather than declared away.
    command:
      "node <lisa>/scripts/check-threshold-ratchet.mjs --base origin/<base> [--head origin/<head>]",
    seedRun: [],
    steps: ["📐 Compare thresholds against merge-base"],
  },
  e2e_coverage: {
    // A repository-local script the job PROBES for before running, and the
    // absent branch is a warning rather than a failure. A one-task declaration
    // would drop the probe, so nothing is seeded and the gap stays reported.
    command: "node scripts/check-e2e-coverage.mjs (when the script exists)",
    seedRun: [],
    steps: [
      "🧭 Require e2e route/screen coverage thresholds",
      "⏭️ Skip e2e coverage (no check-e2e-coverage.mjs script)",
    ],
  },
  bdd_coverage: {
    // The one façade job with NO written-in command. Every other entry here
    // records what runs when nothing declares the gate; this job runs nothing,
    // because its prover ships to every project on the stack and a fallback
    // would enforce a behavior contract on every consumer that never adopted
    // one. Recorded anyway, and with the same shape as the environment façade
    // above: an inventory that omitted it would read as an oversight, and the
    // stand-down step is what an operator needs pointed at.
    command: "(none — the job stands down when the gate is undeclared)",
    // The expo stack ships the prover as , which is what a
    // declaration should point  at; the registry default names the
    // concern and resolves nowhere.
    seedRun: ["bdd:coverage"],
    steps: ["⏭️ Stand down (behavior-contract is not declared)"],
  },
  state_classification: {
    command:
      "node scripts/check-state-classification.mjs (when the script exists)",
    seedRun: [],
    steps: [
      "🧬 Require every persistent entity to carry a reset policy",
      "⏭️ Skip state classification (no check-state-classification.mjs script)",
    ],
  },
  floor_collisions: {
    // Two candidate paths, and Lisa's own repository ships the script as a
    // template rather than installing it — so the built-in chooses between
    // them at run time and a single named task cannot reproduce the choice.
    command: "node <lisa>/scripts/lisa-floor-collisions.mjs",
    seedRun: [],
    steps: ["🧱 Check for collapsible security floors"],
  },
  secret_scanning: {
    // A third-party scanner behind a secret, not a task: with no
    // `GITGUARDIAN_API_KEY` the job takes its skip branch and reports success
    // having scanned nothing. That is precisely the shape this inventory
    // exists to make visible, and nothing a project could declare replaces it.
    command: "ggshield secret scan ci (when GITGUARDIAN_API_KEY is set)",
    seedRun: [],
    steps: [
      "🔍 Check for GitGuardian API key",
      "🔐 GitGuardian scan",
      "🔐 GitGuardian Scan Skipped",
    ],
  },
  license_compliance: {
    command: "fossas/fossa-action (when FOSSA_API_KEY is set)",
    seedRun: [],
    steps: [
      "🔍 Check for FOSSA API key",
      "📜 Run FOSSA license scan",
      "📜 FOSSA Scan Skipped",
    ],
  },
  maestro_e2e: {
    // Three secrets and inputs gate this one, each with its own skip branch,
    // so the job has four ways to report green having run no test at all.
    command:
      "mobile-dev-inc/action-maestro-cloud (when the key, project id and app file are all present)",
    seedRun: [],
    steps: [
      "🔍 Check for Maestro API key",
      "🔍 Check for project ID",
      "🔍 Check for app file",
      "📱 Run Maestro Cloud tests",
      "📱 Maestro Tests Skipped (no API key)",
      "📱 Maestro Tests Skipped (no project ID)",
      "📱 Maestro Tests Skipped (no app file)",
    ],
  },
  snyk: {
    // The SECOND prover of `dependency-vulnerability`. Its entry exists for
    // the same reason as every other: a consumer holds no copy of
    // `quality.yml`, so the only place this invocation can be reported is
    // here. `seedRun` is empty because seeding a task for this job would point
    // the DECLARATION at the supply-chain scanner, and the declaration is
    // shared with `npm_security_scan` — the job that carries the gate's label
    // and runs the declared task. One task, run once, in the job a ruleset
    // matches.
    command:
      "snyk/actions/node --severity-threshold=high --all-projects (when SNYK_TOKEN is set)",
    seedRun: [],
    steps: [
      "\u{1F50D} Check for Snyk token",
      "\u{1F6E1}\uFE0F Run Snyk to check for vulnerabilities",
      "\u{1F6E1}\uFE0F Snyk Scan Skipped",
    ],
  },
  sonarcloud: {
    // The scan and the verdict step are a pair — the action's own outcome is
    // read by a separate step that decides whether to fail — so one declared
    // task would silently drop the half that can redden the job.
    command:
      "SonarSource/sonarqube-scan-action plus its result check (when SONAR_TOKEN is set)",
    seedRun: [],
    steps: [
      "🔍 Check for SonarCloud token",
      "📊 SonarCloud Scan",
      "🔍 Validate SonarCloud results",
      "📊 SonarCloud Scan Skipped",
    ],
  },
  playwright_e2e_aggregate: {
    file: PLAYWRIGHT_WORKFLOW,
    // Not seedable for the same reason as `sg_scan`, and with more at stake:
    // Lisa's implementation of this gate is a sharded matrix, a blob merge AND
    // the verdict step that stops the merge reporting green over failing
    // shards. One task replaces all three.
    command: "(bespoke — a sharded Playwright matrix plus its blob merge)",
    seedRun: [],
    steps: [
      "📥 Download all shard blob reports",
      "🎭 Merge blob reports into HTML",
      "📤 Upload merged Playwright report",
      "🎭 Playwright aggregator skipped (no config)",
      "🚨 Fail if any Playwright shard failed",
    ],
  },
});

/**
 * The façade jobs, as inventory entries.
 *
 * A function rather than a literal so the gate id comes from
 * `QUALITY_JOB_GATES` — the same table `lisa doctor` and a consumer migrating
 * off `skip_jobs` read — instead of being spelled out a second time here where
 * the two copies could disagree.
 * @returns {object[]} One frozen entry per façade job.
 */
function qualityInvocations() {
  return Object.entries(QUALITY_FALLBACKS).map(([job, entry]) => {
    const gate = QUALITY_JOB_GATES[job];
    if (gate === undefined) {
      throw new Error(
        `${job} has a fallback recorded but no gate in QUALITY_JOB_GATES.`
      );
    }
    const artifact = entry.file ?? QUALITY_WORKFLOW;
    return Object.freeze({
      gate,
      // The workflow's own default. A caller passing `moment:` runs the same
      // jobs against a different declaration set; the entry names where the
      // fallback lives by default, which is what a report at that moment needs.
      moment: PULL_REQUEST,
      surface:
        artifact === PLAYWRIGHT_WORKFLOW
          ? "playwright-workflow"
          : "quality-workflow",
      artifact,
      job,
      command: entry.command,
      steps: Object.freeze([...entry.steps]),
      seedRun:
        entry.seedRun === undefined ? null : Object.freeze([...entry.seedRun]),
      facade: CONSULTS_THEN_FALLS_BACK,
    });
  });
}

/**
 * One pre-push entry, with the fields every inventory entry carries.
 * @param {string} gate Registry gate id.
 * @param {string} command What the built-in else-branch runs.
 * @param {string[]|null} seedRun Candidate task names, or null for the registry default.
 * @returns {object} A frozen inventory entry.
 */
function prePushInvocation(gate, command, seedRun) {
  return Object.freeze({
    gate,
    moment: PUSH,
    surface: "pre-push-hook",
    artifact: PRE_PUSH_HOOK,
    job: null,
    command,
    steps: Object.freeze([]),
    seedRun: seedRun === null ? null : Object.freeze([...seedRun]),
    facade: CONSULTS_THEN_FALLS_BACK,
  });
}

/**
 * One pre-commit entry.
 *
 * A separate surface from `pre-push-hook` rather than a moment variant of it,
 * because a report has to be able to ask "what did the COMMIT hook just run
 * ungoverned" without being answered about push.
 * @param {string} gate Registry gate id.
 * @param {string} command What the built-in else-branch runs.
 * @param {string[]|null} seedRun Candidate task names, or null for the registry default.
 * @returns {object} A frozen inventory entry.
 */
function preCommitInvocation(gate, command, seedRun) {
  return Object.freeze({
    gate,
    moment: COMMIT,
    surface: "pre-commit-hook",
    artifact: PRE_COMMIT_HOOK,
    job: null,
    command,
    steps: Object.freeze([]),
    seedRun: seedRun === null ? null : Object.freeze([...seedRun]),
    facade: CONSULTS_THEN_FALLS_BACK,
  });
}

/**
 * One on-edit hook entry.
 * @param {string} gate Registry gate id the tool proves.
 * @param {string} artifact Repository-relative path to the source hook.
 * @param {string} command The tool written into the script.
 * @returns {object} A frozen inventory entry.
 */
function onEditInvocation(gate, artifact, command) {
  return Object.freeze({
    gate,
    // MEASURED, no longer a placeholder. This read `pre-tool` for as long as
    // the registry had no `post-tool` moment to record the truth with, above a
    // comment naming its own unblocking condition. That condition arrived when
    // the edit moments landed, and the placeholder is retired here rather than
    // left to rot — `tests/unit/scripts/placeholder-expiry` is what now watches
    // conditions like it, because a comment naming its own expiry is only as
    // good as something that checks the expiry.
    //
    // Leaving it would have been WORSE than it was before, not merely stale.
    // While neither moment was declarable the wrong label cost nothing; once
    // `code-style`, `format-conformance` and `structural-rules` became legal at
    // `post-tool`, a `pre-tool` label made the shipped `inventory` command
    // print "NOT DECLARABLE AT THIS MOMENT" about a moment that IS declarable,
    // and made `unconfigured --moment=post-tool` silent about the moment these
    // scripts actually fire at, while speaking at one they never run at. A
    // report that is confidently wrong is the defect this table exists to
    // remove.
    moment: POST_TOOL,
    // The event the shipped manifest registers, kept ALONGSIDE `moment` rather
    // than folded into it: `moment` is the registry's vocabulary and
    // `hookEvent` is the harness's. The inventory test derives this one from
    // the manifests, so the pair cannot drift apart the way `moment` did.
    hookEvent: "PostToolUse",
    surface: "on-edit-hook",
    artifact,
    job: null,
    command,
    steps: Object.freeze([]),
    // Nothing to seed, and the reason has changed TWICE now, which is why it
    // is written down rather than implied. It was "no gate lists this moment";
    // then it was "the scripts read no declaration at all"; it is now neither.
    // A declaration IS read and IS honoured — what nothing reproduces is the
    // built-in itself, a per-file tool invocation (`oxlint <edited-file>`) that
    // no package task ships an equivalent of. Seeding the registry default
    // would declare a whole-project run in place of a per-file one, which is a
    // different command wearing the same name.
    seedRun: Object.freeze([]),
    // CONSULTS, since the façade landed. These scripts resolve the project's
    // declaration before touching their own tool, and fall back to it when
    // nothing is declared — the same shape as the pre-push and workflow
    // fallbacks, on the surface that had no configurability at all.
    facade: CONSULTS_THEN_FALLS_BACK,
  });
}

/**
 * One `PreToolUse` refusal hook entry.
 *
 * Separate from `onEditInvocation` because the difference is not cosmetic: this
 * surface runs BEFORE the write and its written-in check decides whether the
 * write happens. An on-edit hook that cannot run costs a report; one of these
 * that cannot run either blocks every agent write or permits the exact text it
 * exists to stop.
 *
 * They were absent from this table entirely until #3007 — the population it was
 * kept true against was globbed as `-on-edit.sh`, which is a naming convention
 * and not a moment, so two shipped hooks on the same boundary were invisible to
 * an inventory whose whole job is to make ungoverned invocations visible.
 * @param {string} gate Registry gate id the built-in proves.
 * @param {string} artifact Repository-relative path to the source hook.
 * @param {string} command The check written into the script.
 * @returns {object} A frozen inventory entry.
 */
function preToolRefusalInvocation(gate, artifact, command) {
  return Object.freeze({
    gate,
    moment: PRE_TOOL,
    hookEvent: "PreToolUse",
    surface: "pre-tool-refusal-hook",
    artifact,
    job: null,
    command,
    steps: Object.freeze([]),
    // Nothing to seed, and for a sharper reason than the on-edit entries have.
    // Both gates are `declareOnly` in the registry above: no npm stack ships a
    // script for either, because the shipped prover reads the text a tool is
    // ABOUT to write and refuses it, which no `npm run` invocation can do — a
    // task can only report on what is already in the file. Seeding a default
    // would declare a check that proves something weaker at a moment where the
    // stronger one is available.
    seedRun: Object.freeze([]),
    facade: CONSULTS_THEN_FALLS_BACK,
  });
}

/**
 * Every invocation Lisa ships with a command written into the artifact rather
 * than resolved from the project's declaration, and the gate that should
 * govern it.
 *
 * WHY THIS IS DATA AND NOT PROSE. "Which properties is this repository proving
 * with a command nothing declared" has to be answerable inside a CONSUMER, at
 * the moment the unconfigured step runs — and a consumer holds no copy of
 * `quality.yml` (it calls the reusable workflow by ref) and no copy of Lisa's
 * tests. Written as documentation the answer would be readable only here;
 * written as a table beside the registry it is readable by
 * `lisa-gates.mjs unconfigured`, which is what the pre-push hook and every
 * gated CI job call to say what they just ran ungoverned.
 *
 * `command` is DESCRIPTIVE, not executable. It names what the artifact runs so
 * a report can print it; `<runner>` stands for the project's task runner,
 * `<package-manager>` for the caller's, `<lisa>` for wherever the installed
 * package resolved — all three are decided at run time.
 *
 * `seedRun` is what makes seeding safe. A seeded declaration must reproduce
 * today's invocation, and for several of these the registry's default task is
 * NOT what the artifact runs: the pre-push unit step runs `test:cov:unit`,
 * which proves the suite and the coverage thresholds together, where
 * `test-correctness` defaults to `test:unit`. Seeding the default there would
 * silently stop enforcing coverage at push while the configuration read
 * deliberate. Where `seedRun` is a non-empty array it lists candidate task
 * names in preference order; where it is `null` the registry default already
 * matches; where it is an EMPTY array nothing a project could name reproduces
 * the built-in, so `seedGates` declares nothing for it.
 *
 * Kept true by `tests/integration/hardcoded-invocation-inventory.test.ts`,
 * which derives the population from the shipped artifacts in BOTH directions:
 * an entry naming a step that is gone fails, and a façade job, a
 * `lisa_gate_covers` call, or an `-on-edit.sh` source script with no entry
 * fails too.
 */
export const HARDCODED_INVOCATIONS = Object.freeze([
  // ── Class A: the pre-push hook. Nine gated steps, nine written-in else
  // branches. Each resolves through `lisa-run-gates.mjs --moment=push` first
  // and stands down only against its own property.
  prePushInvocation(
    "traceability",
    "node <lisa>/scripts/lisa-work-item.mjs validate-push <remote>",
    ["check:work-item:push"]
  ),
  prePushInvocation("type-correctness", "<runner> typecheck", null),
  // Three transports behind one property — `bun audit --production --json`,
  // `npm audit --production --json`, `yarn audit --groups dependencies --json`
  // — chosen by which lockfile is present. None of them is a task the project
  // named, and `gates.runner` has no say in any of them.
  prePushInvocation(
    DEPENDENCY_VULNERABILITY,
    "bun|npm|yarn audit --json, filtered through audit.ignore*.json",
    [SECURITY_AUDIT_TASK]
  ),
  prePushInvocation("code-style-slow", "<runner> lint:slow", null),
  prePushInvocation("dead-code", "<runner> knip:check", [
    KNIP_CHECK_TASK,
    KNIP,
  ]),
  prePushInvocation("test-correctness", "<runner> test:cov:unit", [
    "test:cov:unit",
    "test:cov",
  ]),
  // The SAME run proves both properties, which is why that step stands down
  // only when both are declared. Seeding one without the other leaves the
  // built-in running and proves the pair twice.
  prePushInvocation("coverage-adequacy", "<runner> test:cov:unit", [
    "test:cov:unit",
    "test:cov",
  ]),
  prePushInvocation("test-integration", "<runner> test:integration", null),
  // The worst Class-A case, and the reason `declarable` is COMPUTED rather
  // than assumed: `test-meaningfulness` is PR-onward, so `push` is not a legal
  // moment to declare it at and `validate` refuses the declaration. There is
  // therefore no gates configuration that governs mutation testing at push;
  // the only lever is deleting the `test:mutation` script. Fixing that is not
  // this table's job — being unable to see it was.
  prePushInvocation("test-meaningfulness", "<runner> test:mutation", []),
  // ── Class A: the reusable workflows. One façade job per gate.
  ...qualityInvocations(),
  // ── Class B: the agent tool hooks. No config branch of any kind — measured,
  // and pinned by the inventory test: none of these scripts mentions
  // `lisa_gate_covers`, `lisa-run-gates` or `lisa-gates`. What they resolve is
  // the RUNNER (`./node_modules/.bin/oxlint`, else `bunx`/`npx`), never the
  // TOOL. They also exit 2 — blocking the edit — when their written-in tool is
  // absent, so a project that lints correctly with something else has every
  // agent edit refused until it installs Lisa's choice.
  //
  // Edit time is the highest-frequency enforcement surface Lisa owns and the
  // one surface with no configurability at all. It is also the one where
  // standing down is safe: an on-edit hook is not a branch-protection context,
  // so a hook that declines to run manufactures no green required check.
  onEditInvocation(
    CODE_STYLE,
    "plugins/src/typescript/hooks/lint-on-edit.sh",
    "oxlint <edited-file>"
  ),
  onEditInvocation(
    FORMAT_CONFORMANCE,
    "plugins/src/typescript/hooks/format-on-edit.sh",
    "prettier --write <edited-file>"
  ),
  onEditInvocation(
    STRUCTURAL_RULES,
    "plugins/src/typescript/hooks/sg-scan-on-edit.sh",
    AST_GREP_ON_EDIT
  ),
  // RuboCop is BOTH halves, which is why this artifact appears twice. Its own
  // header calls it the "Lint-and-Format-on-Edit Hook" and it runs
  // `rubocop -a` — safe autocorrect — before checking for what is left. An
  // inventory recording only the lint half would report a formatter that runs
  // on every agent edit as not running at all.
  onEditInvocation(
    CODE_STYLE,
    "plugins/src/rails/hooks/rubocop-on-edit.sh",
    "rubocop -a --fail-level E <edited-file>"
  ),
  onEditInvocation(
    FORMAT_CONFORMANCE,
    "plugins/src/rails/hooks/rubocop-on-edit.sh",
    "rubocop -a (safe autocorrect) <edited-file>"
  ),
  onEditInvocation(
    STRUCTURAL_RULES,
    "plugins/src/rails/hooks/sg-scan-on-edit.sh",
    AST_GREP_ON_EDIT
  ),
  // ── Class B: the Codex copies of the same scripts. NOT represented by the
  // `plugins/src` originals above, because unlike the fifteen generated
  // per-agent copies these four DIFFER from their originals — and all four
  // match zero of `lisa_gate_covers`, `lisa-run-gates` and `lisa-gates`, so
  // the property they prove is governed by nothing on this surface either.
  onEditInvocation(
    CODE_STYLE,
    `${CODEX_SCRIPTS}/lint-on-edit.sh`,
    "oxlint <edited-file>"
  ),
  onEditInvocation(
    FORMAT_CONFORMANCE,
    `${CODEX_SCRIPTS}/format-on-edit.sh`,
    "prettier --write <edited-file>"
  ),
  onEditInvocation(
    STRUCTURAL_RULES,
    `${CODEX_SCRIPTS}/sg-scan-on-edit.sh`,
    AST_GREP_ON_EDIT
  ),
  // Both halves again, for the same reason the Rails original appears twice.
  onEditInvocation(
    CODE_STYLE,
    `${CODEX_SCRIPTS}/rubocop-on-edit.sh`,
    "rubocop -a --fail-level E <edited-file>"
  ),
  onEditInvocation(
    FORMAT_CONFORMANCE,
    `${CODEX_SCRIPTS}/rubocop-on-edit.sh`,
    "rubocop -a (safe autocorrect) <edited-file>"
  ),
  // ── Class B: the two `PreToolUse` refusal hooks, on both agent surfaces.
  // Same boundary as the on-edit scripts and the opposite consequence: these
  // decide whether the write happens at all. Recorded here from #3007, which
  // also wired them through the façade — before that they read no declaration
  // of any kind AND had no entry, so `unconfigured --moment=pre-tool` was
  // silent about two shipped enforcements rather than reporting them as
  // ungoverned. Silence and "nothing to report" are indistinguishable, which
  // is the failure mode this table exists to remove.
  preToolRefusalInvocation(
    "suppression-residue",
    "plugins/src/typescript/hooks/block-suppress-directives.sh",
    "grep -E '(//|/\\*) *(@ts-ignore|@ts-nocheck|eslint-disable|biome-ignore|prettier-ignore)' <proposed-text>"
  ),
  preToolRefusalInvocation(
    "migration-provenance",
    "plugins/src/nestjs/hooks/block-migration-edits.sh",
    "refuse any write matching */migrations/*.ts|*/migrations/*.js"
  ),
  // The Codex copies, recorded separately for the same reason the Codex
  // on-edit copies are: they DIFFER from the originals — a shared path
  // extractor, multi-file apply_patch envelopes, and no `cd` — so representing
  // them by the originals would describe a file that is not the one that runs.
  preToolRefusalInvocation(
    "suppression-residue",
    `${CODEX_SCRIPTS}/block-suppress-directives.sh`,
    "grep -E '(//|/\\*) *(@ts-ignore|@ts-nocheck|eslint-disable|biome-ignore|prettier-ignore)' <added-lines>"
  ),
  preToolRefusalInvocation(
    "migration-provenance",
    `${CODEX_SCRIPTS}/block-migration-edits.sh`,
    "refuse any write matching */migrations/*[0-9]*-*.ts"
  ),
  // ── Class A: the pre-commit hook. Three `lisa_gate_covers` sites guarding
  // five properties, each with a written-in else branch, and no report step —
  // so a project could not see what its commit hook proved ungoverned.
  preCommitInvocation(
    "credential-leakage",
    "gitleaks protect --staged --redact -v",
    // Nothing a project could name reproduces this: the built-in also builds
    // a combined ignore file out of .gitleaksignore and .gitleaksignore.local
    // before scanning, and degrades to a warning when gitleaks is absent.
    []
  ),
  // ONE invocation, THREE properties — `lint-staged` runs oxlint/eslint,
  // prettier and `ast-grep scan` in a single pass, which is why the hook
  // stands down only when all three are declared. Recorded three times for
  // the same reason the Rails on-edit hook is recorded twice: an inventory
  // naming one of them would report the other two as not running.
  preCommitInvocation(CODE_STYLE, LINT_STAGED_COMMAND, LINT_STAGED_TASK),
  preCommitInvocation(
    FORMAT_CONFORMANCE,
    LINT_STAGED_COMMAND,
    LINT_STAGED_TASK
  ),
  preCommitInvocation(STRUCTURAL_RULES, LINT_STAGED_COMMAND, LINT_STAGED_TASK),
  preCommitInvocation(
    "artifact-freshness",
    "node scripts/check-derived-artifacts.mjs --staged",
    ["check:artifacts"]
  ),
  // ── Class B: the verification-coverage extension sourced by the pre-push
  // hook. It consults nothing at all, so a project declaring
  // `coverage-adequacy` at push still has this run its own command.
  Object.freeze({
    gate: COVERAGE_ADEQUACY,
    moment: PUSH,
    surface: "pre-push-hook",
    artifact: PRE_PUSH_VERIFY,
    job: null,
    command: "node scripts/check-verification-coverage.mjs",
    steps: Object.freeze([]),
    seedRun: Object.freeze([]),
    facade: NEVER_CONSULTS,
  }),
]);

/**
 * Whether a gate may legally be declared at a moment.
 *
 * Computed from the registry rather than recorded on the entry, because the two
 * answers must never be able to disagree: an entry that claimed a moment was
 * declarable after the registry stopped listing it would send an operator to
 * write a declaration `validate` then refuses.
 * @param {string} gate Registry gate id.
 * @param {string} moment The moment in question.
 * @returns {boolean} True when a declaration at that moment is legal.
 */
export function isDeclarableAt(gate, moment) {
  const definition = REGISTRY[gate];
  if (definition === undefined) return false;
  return definition.moments.includes(momentFamily(moment));
}

/**
 * The hardcoded invocations at one moment, optionally on one surface.
 * @param {object} options Filter.
 * @param {string} [options.moment] Only invocations at this moment.
 * @param {string} [options.surface] Only invocations on this surface.
 * @param {string} [options.gate] Only invocations for this gate.
 * @returns {object[]} Matching entries, in table order.
 */
export function hardcodedAt({ moment, surface, gate } = {}) {
  return HARDCODED_INVOCATIONS.filter(
    entry =>
      (moment === undefined || entry.moment === moment) &&
      (surface === undefined || entry.surface === surface) &&
      (gate === undefined || entry.gate === gate)
  );
}

/**
 * The properties proved at a moment by a command the project did not declare.
 *
 * A gate declared `off` is NOT reported: `off` is a declaration, and reporting
 * it as ungoverned would train an operator to ignore the report. A gate
 * declared `await` at this moment is also a declaration, but the built-in still
 * runs, so it IS reported — the project said "something else proves this" and
 * the written-in command ran anyway.
 * @param {object} options Resolution inputs.
 * @param {object} options.gates The gates block.
 * @param {string} options.moment The moment being proved.
 * @param {string} [options.surface] Restrict to one surface.
 * @param {string} [options.gate] Restrict to one gate id.
 * @returns {Array<{gate: string, label: string, command: string, surface: string, artifact: string, job: string|null, steps: string[], declarable: boolean, declaration: string|null, reason: string}>} One finding per ungoverned invocation.
 */
export function unconfiguredAt({ gates, moment, surface, gate }) {
  const declared = new Map(
    resolveMoment({ gates: gates ?? {}, moment, includeOff: true }).map(
      entry => [entry.id, entry]
    )
  );
  // The moment filters the INVENTORY only when the caller has not named a
  // gate. A workflow's cadence and the moment an entry records are different
  // facts — the browser suite's workflow defaults to `continuous:development`
  // while its entry records `pull-request` — and a caller asking about ONE gate
  // on ONE surface is asking "what does the built-in here run", which does not
  // depend on the cadence. Filtering by moment there produced no entry, hence
  // no finding, hence a report step that printed nothing at all: this control's
  // own failure mode, inside the control built to expose it.
  const scoped = hardcodedAt({
    moment: gate === undefined ? moment : undefined,
    surface,
    gate,
  });
  const findings = [];
  for (const entry of scoped) {
    const hit = declared.get(entry.gate);
    // WHICH DECLARATIONS ACTUALLY GOVERN. Three kinds do not, and treating any
    // of them as governance makes this report go quiet while the written-in
    // command still runs — a control reporting success having proved nothing,
    // which is the defect this whole subsystem exists to remove. Measured on
    // this branch before the guard: an ILLEGAL `code-style` declaration at the
    // on-edit moment silenced 2 of 5 findings, and an illegal
    // `test-meaningfulness` at push silenced 1 of 9 — both declarations that
    // `validate` refuses outright.
    //
    //   * `await` proves nothing here, and the built-in ran anyway.
    //   * A declaration at a moment the gate may not legally be declared at is
    //     not a configuration, it is a config error. `validate` rejects it, so
    //     it must not buy silence from a report either.
    //   * A `never-consults` artifact reads no declaration at all, so NOTHING a
    //     project writes takes it over. Suppressing on a declaration there
    //     would report a takeover that cannot happen.
    if (
      hit &&
      hit.mode !== "await" &&
      entry.facade !== NEVER_CONSULTS &&
      isDeclarableAt(entry.gate, moment)
    ) {
      continue;
    }
    const declarable = isDeclarableAt(entry.gate, moment);
    findings.push({
      gate: entry.gate,
      label: REGISTRY[entry.gate]?.label ?? entry.gate,
      command: entry.command,
      surface: entry.surface,
      artifact: entry.artifact,
      job: entry.job,
      steps: [...entry.steps],
      facade: entry.facade,
      declarable,
      declaration: declarable
        ? `"gates": { "${entry.gate}": { "${moment}": "required" } }`
        : null,
      reason: reasonFor(entry, hit, declarable, moment),
    });
  }
  return findings;
}

/**
 * Every property a built-in proves that nothing in the config governs.
 *
 * The validate-time surface `unconfiguredAt` never had. `unconfiguredAt`
 * answers about ONE moment because its callers — the pre-push hook and a CI
 * job — each run at one. Validation is asked about the project, not about a
 * run, so it has to sweep every moment the inventory records and report the
 * union.
 *
 * ADVISORY BY CONSTRUCTION, and that is a decision rather than timidity. Every
 * installed project would be reported here — nothing seeds a `gates` block
 * into a consumer — so a blocking report would fail `validate` fleet-wide on
 * the next bump. Making an absent declaration fatal is the LAST step of
 * #2838's ordering and it lands behind an opt-in, not here.
 * @param {object} options Resolution inputs.
 * @param {object} options.gates The gates block.
 * @returns {Array<{gate: string, moment: string, artifact: string, job: string|null, command: string, reason: string, declarable: boolean, declaration: string|null}>} One finding per ungoverned invocation, moment by moment.
 */
export function ungovernedProperties({ gates }) {
  // The moments come from the TABLE, not from `MOMENTS`. A moment no
  // invocation records has nothing to report, and sweeping the registry's
  // whole axis instead would emit a finding per legal moment per gate — a
  // report so long nobody reads it, which is how a control goes quiet without
  // ever going green.
  const moments = [
    ...new Set(HARDCODED_INVOCATIONS.map(entry => entry.moment)),
  ];
  return moments.flatMap(moment =>
    unconfiguredAt({ gates: gates ?? {}, moment }).map(finding => ({
      ...finding,
      moment,
    }))
  );
}

/**
 * Why one invocation is ungoverned, in one operator-readable sentence.
 * @param {object} entry The inventory entry.
 * @param {object|undefined} hit The resolved declaration, if any.
 * @param {boolean} declarable Whether a declaration at this moment is legal.
 * @param {string} moment The moment being proved.
 * @returns {string} The reason.
 */
function reasonFor(entry, hit, declarable, moment) {
  if (entry.facade === NEVER_CONSULTS) {
    return `${entry.artifact} contains no gate lookup at all, so no declaration can replace it.`;
  }
  if (!declarable) {
    return `${entry.gate} cannot legally be declared at "${moment}" (legal moments: ${(REGISTRY[entry.gate]?.moments ?? []).join(", ")}), so no configuration governs this.`;
  }
  if (hit?.mode === "await") {
    return `${entry.gate} is declared "await" at "${moment}", which proves nothing here, so the built-in runs.`;
  }
  return `${entry.gate} is not declared at "${moment}", so the built-in runs.`;
}

/**
 * A `gates` block that declares what the built-ins are proving today.
 *
 * SEEDING IS THE MECHANISM THAT RETIRES A FALLBACK, and it is only safe if the
 * seeded declaration runs the same thing the fallback did. Two rules enforce
 * that, and they are why this returns less than the full registry:
 *
 *   * A gate is seeded only when the task that reproduces the built-in is a
 *     script the project ACTUALLY HAS. Twenty of the registry's default tasks
 *     are shipped by no template, so seeding by default would declare gates
 *     whose prover does not exist — a red fleet, delivered by a version bump.
 *   * A gate is seeded only at a moment the registry says it may be declared
 *     at. `test-meaningfulness` runs at push and cannot be declared there;
 *     seeding it would produce a config `validate` refuses.
 *
 * What is NOT seeded stays ungoverned, and stays reported by `unconfiguredAt`.
 * That is the honest outcome: this closes the gap it can prove it closes, and
 * leaves the rest visible rather than declaring it away.
 * @param {object} options Inputs.
 * @param {object} [options.gates] The existing gates block; its declarations win.
 * @param {Record<string, string>} [options.scripts] The project's package.json scripts.
 * @param {string} [options.runner] Task runner to record, when none is declared.
 * @returns {{gates: object, seeded: Array<{gate: string, moment: string, run: string|null}>, skipped: Array<{gate: string, moment: string, reason: string}>}} The merged block and what it did.
 */
export function seedGates({ gates = {}, scripts = {}, runner } = {}) {
  const seeded = [];
  const skipped = [];
  const next = { ...gates };
  if (runner !== undefined && next.runner === undefined) next.runner = runner;

  for (const entry of HARDCODED_INVOCATIONS) {
    const { gate, moment } = entry;
    if (entry.facade === NEVER_CONSULTS) {
      skipped.push({
        gate,
        moment,
        reason: `${entry.artifact} consults no declaration, so a declaration would not take it over.`,
      });
      continue;
    }
    if (next[gate]?.[moment] !== undefined) {
      skipped.push({ gate, moment, reason: "already declared." });
      continue;
    }
    if (!isDeclarableAt(gate, moment)) {
      skipped.push({
        gate,
        moment,
        reason: `"${moment}" is not a legal moment for ${gate}.`,
      });
      continue;
    }
    const run = seedTask(entry, scripts);
    if (run === null) {
      skipped.push({
        gate,
        moment,
        reason:
          entry.seedRun !== null && entry.seedRun.length === 0
            ? "no task reproduces the built-in, so declaring it would change what runs."
            : `no script in package.json reproduces the built-in (looked for ${candidatesFor(entry).join(", ")}).`,
      });
      continue;
    }
    // The registry default is left IMPLICIT. Writing `run` when it already
    // matches would freeze a default the registry is allowed to improve, and a
    // project that never chose the task should not be recorded as having.
    const useDefault =
      run === REGISTRY[gate]?.taskAt?.[momentFamily(moment)] ||
      (REGISTRY[gate]?.taskAt?.[momentFamily(moment)] === undefined &&
        run === REGISTRY[gate]?.task);
    next[gate] = {
      ...next[gate],
      [moment]: useDefault ? "required" : { level: "required", run },
    };
    seeded.push({ gate, moment, run: useDefault ? null : run });
  }
  return { gates: next, seeded, skipped };
}

/**
 * The task names a seeded declaration would consider for one entry.
 * @param {object} entry An inventory entry.
 * @returns {string[]} Candidate task names, in preference order.
 */
function candidatesFor(entry) {
  if (entry.seedRun !== null) return [...entry.seedRun];
  const definition = REGISTRY[entry.gate];
  const preferred =
    definition?.taskAt?.[momentFamily(entry.moment)] ?? definition?.task;
  return preferred === undefined || preferred === null ? [] : [preferred];
}

/**
 * The task a seeded declaration would name, or null when none is available.
 * @param {object} entry An inventory entry.
 * @param {Record<string, string>} scripts The project's package.json scripts.
 * @returns {string|null} The task, or null.
 */
function seedTask(entry, scripts) {
  for (const candidate of candidatesFor(entry)) {
    if (Object.hasOwn(scripts, candidate)) return candidate;
  }
  return null;
}

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
  github_issue: Object.freeze([]),
});

/**
 * Tokens this workflow HAD and deliberately deleted, and what to do about one.
 *
 * The distinction this draws is the one an operator needs and `unknown` erases.
 * `unknown` says "no job matches it — check for a space after a comma", which
 * sends someone hunting a typo in a token they spelled correctly and which this
 * workflow really used to honour. Retired is a different fact with a different
 * remedy: the token worked, it was removed on purpose, and the edit is to delete
 * it rather than to fix it.
 *
 * `reason` is written for the caller's `ci.yml`, because that is the file the
 * token is in and the only file the operator can change.
 */
export const RETIRED_SKIP_JOB_TOKENS = Object.freeze({
  zap_baseline: Object.freeze({
    retiredIn: "#2938",
    reason:
      "The pull-request `🕷️ OWASP ZAP Baseline` job was DELETED rather than named, because it never proved anything. It ran only when `zap_target_url` was set, which no shipped template sets, so it posted `skipped` on every run it ever had; and it carried `fail_action: false`, so even a run that found something could not fail. Deleting a job that has never once executed is not a reduction in security posture. DAST is a property of a RUNNING application, which a pull request does not have and a deployed environment does — and `runtime-web-vulnerability` is legal at exactly `pre-deploy`, `post-deploy` and `continuous`, where #2832 shipped a runner that executes it. Declare it there. The alternative considered and rejected was mapping this job to `runtime-web-vulnerability` anyway: `gateForSkipJob` reads only `QUALITY_JOB_GATES` membership and never checks moment legality, so the row would have turned this table empty and the tests green while `validate` still refused the declaration it advertised — a control reporting success while proving nothing.",
  }),
  skipped_required_checks: Object.freeze({
    retiredIn: "#2933",
    reason:
      "The `🔒 Skipped Required Checks` job is no longer skippable, by rule rather than by omission: a gate whose job is to detect silencing cannot itself be silenceable (see NON_DECLARABLE_JOBS). Delete the token — leaving it changes nothing, and it reads as an off-switch that still works.",
  }),
});

/**
 * What a `skip_jobs` token can be resolved to.
 *
 * Five of the six are refusals, which is the point. The failure this table
 * exists to prevent is a confident wrong answer, so anything short of "one gate
 * covers every job this token suppresses" has to be a distinct, nameable
 * outcome rather than a best effort.
 */
export const SKIP_JOB_STATUS = [
  "replaceable",
  "partial",
  "unmappable",
  "inert",
  "retired",
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
    // A token this workflow deliberately deleted is not a token it never had.
    // Both suppress nothing today, and reporting the first as `unknown` sends
    // an operator hunting a typo in a token they spelled correctly — so the
    // retired case is answered first, with its own remedy.
    if (Object.hasOwn(RETIRED_SKIP_JOB_TOKENS, token)) {
      return {
        token,
        status: "retired",
        jobs: [],
        gates: [],
        gate: null,
        ungated: [],
      };
    }
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
  if (bound) {
    const observedAtMs = Date.parse(evidence.observed_at ?? "");
    if (!Number.isFinite(observedAtMs)) {
      return {
        status: "unknown",
        reason:
          "freshness is bounded but observed_at is missing or invalid, so its age cannot be proved",
      };
    }
    const ageMinutes = (nowMs - observedAtMs) / 60000;
    if (ageMinutes > bound) {
      return {
        status: "unknown",
        reason: `evidence is ${Math.round(ageMinutes)} minutes old, past its ${bound}-minute bound`,
      };
    }
  }
  return { status: "pass", reason: null };
}

// ─── Release evidence reuse (CodySwannGT/lisa#3013) ─────────────────────────
//
// Release calls the full quality workflow again after merge, on a tree that
// already passed the same contract on its pull request. Reuse is allowed only
// when a VERIFIED `lisa.gate-evidence/v1` envelope proves the same tree under
// the same-or-stricter contract, and every unproved dimension makes the gate
// RUN. The design, including the permission wall that shaped it, is in
// `docs/design/release-evidence-reuse.md`.

/**
 * The schema token, spelled here as well as in the producer.
 *
 * This is a deliberate SECOND ADDRESS for one string, and it is forced rather
 * than sloppy: `.github/workflows/gates.yml` tells an old runner apart from a
 * current one by grepping the runner file for this literal, so the literal
 * cannot move out of `lisa-run-gates.mjs`. A verifier that imported it from
 * there would make this module depend on the runner, inverting the dependency.
 * `tests/unit/scripts/lisa-gates-reuse-plan.test.ts` pins the two together, so
 * they cannot drift even though they are written twice.
 */
export const EVIDENCE_SCHEMA_TOKEN = "lisa.gate-evidence/v1";

/**
 * Compare strings by UTF-16 code units, independent of the host locale.
 *
 * Evidence digests cross machines. `localeCompare` answers a human collation
 * question using the process locale and installed ICU data, so it can order the
 * same keys differently on two runners. Relational string comparison is the
 * ECMAScript code-unit order and is therefore the contract we can reuse.
 * @param {string} left Left value.
 * @param {string} right Right value.
 * @returns {number} Negative, zero, or positive.
 */
export function compareCodeUnits(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * The same value with every object key in a stable order.
 *
 * A digest over `JSON.stringify` of the raw block would change when an editor
 * reordered two keys, which would make every prior observation read as produced
 * under a different contract. Ordering is normalised so the digest answers "is
 * this the same declaration?" and nothing else.
 *
 * This lives HERE rather than beside the producer that first needed it, because
 * a verifier that recomputed the digest with a second implementation would be
 * comparing two answers to the same question. One implementation, two callers.
 * @param {unknown} value Any JSON value.
 * @returns {unknown} The same value, key-ordered.
 */
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      // An explicit comparator, never a bare `.sort()`: the default sorts by
      // UTF-16 code unit through `String()`, and a lint rule in this tree
      // rejects the bare form for exactly that reason.
      .sort(compareCodeUnits)
      .map(key => [key, canonical(value[key])])
  );
}

/**
 * A sha256 over canonical JSON, spelled once.
 * @param {unknown} value Any JSON value.
 * @returns {string} `sha256:<hex>`.
 */
export function digest(value) {
  const canonicalised = JSON.stringify(canonical(value));
  return `sha256:${createHash("sha256").update(canonicalised).digest("hex")}`;
}

/**
 * Digest of the RESOLVED PLAN at a moment — not the config file's bytes.
 *
 * Evidence is only reusable while the contract that produced it still holds,
 * and three things make the plan the right subject rather than the file:
 *
 * - an unrelated key elsewhere in `.lisa.config.json` being edited would force
 *   spurious reruns against a file digest, while proving nothing changed here;
 * - the raw file does not capture `shippedAs` alias resolution, which reads
 *   `package.json` scripts and genuinely changes WHICH COMMAND proved the
 *   gate — a file digest would call two different provers the same contract;
 * - `includeOff: true` is what makes "this project declared the gate off" a
 *   RECORDED fact rather than an absence indistinguishable from a registry that
 *   never knew the gate existed.
 *
 * It is also what refuses a result recorded while a gate was `optional` from
 * satisfying a moment that now declares it `required` — a stale-evidence hole
 * no timestamp closes.
 * @param {object} options Inputs.
 * @param {object|null} options.gates The gates block.
 * @param {string} options.moment The moment being run.
 * @param {string} [options.runner] The task-runner prefix.
 * @param {Record<string,string>|null} [options.scripts] Project scripts.
 * @returns {string|null} `sha256:<hex>`, or null when no plan could resolve.
 */
export function planDigest({ gates, moment, runner, scripts = null }) {
  if (!gates) return null;
  try {
    // The runner is forwarded verbatim when stated, INCLUDING a value
    // `resolveMoment` refuses. A truthiness guard here would let an invalid
    // runner fall through to the default, and the envelope would then record
    // `contract.runner` as one thing while digesting a plan built from another
    // — two facts about the same run, in one document.
    const options = { gates, includeOff: true, moment, scripts };
    const plan = resolveMoment(
      runner === undefined ? options : { ...options, runner }
    ).map(gate => ({
      awaits: gate.awaits,
      command: gate.command,
      id: gate.id,
      level: gate.level,
      mode: gate.mode,
      task: gate.task,
      work: gate.work,
    }));
    return digest({
      gates: [...plan].sort((left, right) =>
        compareCodeUnits(left.id, right.id)
      ),
      runner: runner ?? null,
    });
  } catch {
    // An unresolvable plan — an invalid runner, a refused configuration — has
    // no contract to digest. Null says so; it does not guess one.
    return null;
  }
}

/**
 * What kind of thing a gate's verdict is, which decides whether it may be
 * reused and for how long.
 *
 * Three values, and the default for anything not named is `never`. That
 * asymmetry is the whole safety posture: a gate becomes reusable only when
 * someone wrote down why it is, and a gate added tomorrow is not reusable by
 * accident.
 */
export const REUSE_CLASS = Object.freeze({
  /** Same tree + same contract ⇒ same verdict. No external state consulted. */
  DETERMINISTIC: "deterministic",
  /** Never satisfiable by evidence from another run. */
  NEVER: "never",
  /** Depends on external state that changes without the tree. Needs a window. */
  TIME_SENSITIVE: "time-sensitive",
});

/** Every legal class, for validation. */
export const REUSE_CLASSES = Object.freeze(Object.values(REUSE_CLASS));

/**
 * The built-in classification, one row per registry gate.
 *
 * `tests/unit/scripts/lisa-gates-reuse-plan.test.ts` derives the key set from
 * `REGISTRY` and fails when they disagree, so a gate cannot be added without a
 * stated class. Deriving the table itself is not possible — whether a verdict
 * depends on external state is a fact about the prover, not about the registry
 * entry — but requiring the row is, and that is what stops a silent default.
 *
 * A project overrides a row with `gates.<id>.reuse` in `.lisa.config.json`.
 */
export const GATE_REUSE_CLASS = Object.freeze({
  accessibility: { class: REUSE_CLASS.NEVER },
  // A guard whose job is to detect a stale generated artifact must not itself
  // be satisfied by a record of a previous run, and it costs seconds.
  "artifact-freshness": { class: REUSE_CLASS.NEVER },
  "behavior-contract": { class: REUSE_CLASS.DETERMINISTIC, diff: true },
  "build-integrity": { class: REUSE_CLASS.DETERMINISTIC },
  "code-review": { class: REUSE_CLASS.NEVER },
  "code-style": { class: REUSE_CLASS.DETERMINISTIC },
  "code-style-slow": { class: REUSE_CLASS.DETERMINISTIC },
  "commit-conformance": { class: REUSE_CLASS.DETERMINISTIC, diff: true },
  "conflict-residue": { class: REUSE_CLASS.DETERMINISTIC },
  "coverage-adequacy": { class: REUSE_CLASS.DETERMINISTIC },
  "credential-availability": { class: REUSE_CLASS.NEVER },
  // ── Time-sensitive. 60 minutes throughout, stated rather than inferred: it
  // sits well above the observed merge→release latency (minutes) and well below
  // the interval over which a GIVEN lockfile's answer meaningfully changes.
  // Re-proving these is cheap, so a narrow window costs little.
  "credential-leakage": {
    class: REUSE_CLASS.TIME_SENSITIVE,
    maxAgeMinutes: 60,
  },
  "dead-code": { class: REUSE_CLASS.DETERMINISTIC },
  "dependency-vulnerability": {
    class: REUSE_CLASS.TIME_SENSITIVE,
    maxAgeMinutes: 60,
  },
  "e2e-browser": { class: REUSE_CLASS.NEVER },
  "e2e-native": { class: REUSE_CLASS.NEVER },
  "environment-reseed": { class: REUSE_CLASS.NEVER },
  "environment-reset": { class: REUSE_CLASS.NEVER },
  "format-conformance": { class: REUSE_CLASS.DETERMINISTIC },
  "generative-testing": { class: REUSE_CLASS.DETERMINISTIC },
  "journey-coverage": { class: REUSE_CLASS.DETERMINISTIC },
  "learnings-budget": { class: REUSE_CLASS.DETERMINISTIC },
  "license-compliance": {
    class: REUSE_CLASS.TIME_SENSITIVE,
    maxAgeMinutes: 60,
  },
  "load-capacity": { class: REUSE_CLASS.NEVER },
  "migration-provenance": { class: REUSE_CLASS.DETERMINISTIC },
  // Its measurement varies with runner speed, so it is not a pure function of
  // the tree. But the property it gates is a property of the CODE, and runner
  // variance is noise in both directions: rerunning it adds a second sample of
  // the same noise, not a second proof. A project that disagrees declares
  // `"reuse": { "class": "time-sensitive", "max_age_minutes": N }`.
  "performance-budget": { class: REUSE_CLASS.DETERMINISTIC },
  "runtime-web-vulnerability": { class: REUSE_CLASS.NEVER },
  "security-floor-integrity": { class: REUSE_CLASS.DETERMINISTIC },
  "state-classification": { class: REUSE_CLASS.DETERMINISTIC },
  // The main-branch analysis is a PUBLISHING action — it updates the
  // server-side baseline every later pull request is measured against — not
  // only a proof. Skipping it would silently stop maintaining that baseline.
  "static-security": { class: REUSE_CLASS.NEVER },
  "structural-rules": { class: REUSE_CLASS.DETERMINISTIC },
  "suppression-residue": { class: REUSE_CLASS.DETERMINISTIC },
  "test-correctness": { class: REUSE_CLASS.DETERMINISTIC },
  // Hermetic in this repository. A project whose integration suite reaches a
  // live service MUST override this — the built-in cannot know, and the cost of
  // being wrong is reusing a proof about a system that has since changed.
  "test-integration": { class: REUSE_CLASS.DETERMINISTIC },
  "test-meaningfulness": { class: REUSE_CLASS.DETERMINISTIC },
  "test-node-suites": { class: REUSE_CLASS.DETERMINISTIC },
  "threshold-monotonicity": { class: REUSE_CLASS.DETERMINISTIC },
  "tool-availability": { class: REUSE_CLASS.NEVER },
  // `pull_request`-only by its job condition, so there is nothing to reuse and
  // nothing to save; declaring it `never` says that rather than implying it.
  traceability: { class: REUSE_CLASS.NEVER },
  "type-correctness": { class: REUSE_CLASS.DETERMINISTIC },
  "version-duplication": { class: REUSE_CLASS.DETERMINISTIC },
});

/**
 * Why a gate is running rather than reusing, as a stable token.
 *
 * Tokens rather than prose because the ledger is read by a job that must
 * compare two sets, and by an operator who needs the same phrase to mean the
 * same thing across runs.
 */
export const REUSE_REASON = Object.freeze({
  CONTRACT_MISMATCH: "contract-mismatch",
  DERIVATIVE: "derivative",
  LEVEL_DOWNGRADE: "level-downgrade",
  MALFORMED: "malformed",
  NEVER_REUSABLE: "never-reusable",
  NOT_PROVED: "not-proved",
  REUSED: "reused",
  STALE: "stale",
  SUBJECT_MISMATCH: "subject-mismatch",
  UNATTRIBUTABLE: "unattributable",
  UNAVAILABLE: "unavailable",
  UNCLASSIFIED: "unclassified",
  UNCOVERED: "uncovered",
});

/** The largest envelope the verifier will read, in bytes. */
export const EVIDENCE_BYTE_BUDGET = 1024 * 1024;

/** How deep a caller chain may be and still be primary pull-request proof. */
const PRIMARY_CALLER_CHAIN_DEPTH = 1;

/** How strong each level is, so evidence can never satisfy a stricter one. */
const LEVEL_RANK = Object.freeze({ off: 0, optional: 1, required: 2 });

/**
 * The reuse policy for one gate: built-in row, overridden by the project.
 *
 * An unknown gate id resolves to `never`. That is the fail-closed default and
 * it is why the built-in table does not need to anticipate a consumer's own
 * gate: a gate nobody classified is a gate nobody argued was reusable.
 * @param {string} id Gate id.
 * @param {object|null} [gates] The project gates block.
 * @returns {{class: string, diff: boolean, known: boolean, maxAgeMinutes: number|null}} Policy.
 */
export function reusePolicyFor(id, gates = null) {
  const builtIn = GATE_REUSE_CLASS[id] ?? null;
  const declared = gates?.[id]?.reuse ?? null;
  const known = Boolean(builtIn || declared);
  const merged = {
    class: declared?.class ?? builtIn?.class ?? REUSE_CLASS.NEVER,
    diff: declared?.diff ?? builtIn?.diff ?? false,
    known,
    maxAgeMinutes: declared?.max_age_minutes ?? builtIn?.maxAgeMinutes ?? null,
  };
  // An unrecognised class is not a licence to guess. `validate` refuses it at
  // declaration time; this is the runtime arm of the same refusal.
  return REUSE_CLASSES.includes(merged.class)
    ? merged
    : { class: REUSE_CLASS.NEVER, diff: false, known, maxAgeMinutes: null };
}

/**
 * The tree this evidence is about must be the tree being released.
 *
 * `tree` rather than `commit` is the identity: two commits legitimately share a
 * tree after a rebase or a merge of an up-to-date branch, and that is exactly
 * the case where reuse is sound. A null on either side is a mismatch, not a
 * pass — an unknown tree is not the same tree.
 * @param {object} subject The envelope's subject block.
 * @param {object} observed Locally observed facts.
 * @returns {string|null} A problem, or null.
 */
function verifySubject(subject, observed) {
  if (!subject.repository || subject.repository !== observed.repository) {
    return `evidence is about ${JSON.stringify(subject.repository ?? null)}, not ${JSON.stringify(observed.repository ?? null)}`;
  }
  if (!subject.tree || !observed.tree || subject.tree !== observed.tree) {
    return `evidence is about tree ${JSON.stringify(subject.tree ?? null)}, not ${JSON.stringify(observed.tree ?? null)}`;
  }
  return null;
}

/**
 * Compare two dotted versions numerically, ignoring any pre-release suffix.
 *
 * Deliberately small: the only question asked of it is "is the producer's
 * registry at least as new as mine", and a full semver implementation would be
 * a second answer to a question nothing else asks.
 * @param {string} left Version.
 * @param {string} right Version.
 * @returns {number} Negative, zero or positive.
 */
function compareVersions(left, right) {
  const parts = value =>
    String(value)
      .split("-")[0]
      .split(".")
      .map(part => Number.parseInt(part, 10) || 0);
  const a = parts(left);
  const b = parts(right);
  const width = Math.max(a.length, b.length);
  for (let index = 0; index < width; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The contract that produced this evidence must be the one being planned.
 *
 * `workflow_ref` and `workflow_sha` are not redundant with the tree: consumers
 * call the reusable workflow at `@main`, so its contents can change with NO
 * change to the caller's tree, and tree identity alone would let an older,
 * weaker workflow's proof satisfy a stricter one. `registry_version` may be
 * NEWER than the local one — a stricter producer is acceptable, which is what
 * "same or stricter" means — but never older.
 * @param {object} contract The envelope's contract block.
 * @param {string} moment The moment being planned.
 * @param {object} observed Locally observed facts.
 * @returns {string|null} A problem, or null.
 */
function verifyContract(contract, moment, observed) {
  if (contract.moment !== moment) {
    return `evidence is for moment ${JSON.stringify(contract.moment ?? null)}, not ${JSON.stringify(moment)}`;
  }
  const pairs = [
    ["gates_digest", observed.gatesDigest],
    ["inputs_digest", observed.inputsDigest],
    ["workflow_ref", observed.workflowRef],
    ["workflow_sha", observed.workflowSha],
  ];
  for (const [field, expected] of pairs) {
    if (!contract[field] || !expected || contract[field] !== expected) {
      return `${field} is ${JSON.stringify(contract[field] ?? null)}, not ${JSON.stringify(expected ?? null)}`;
    }
  }
  if (!contract.registry_version || !observed.registryVersion) {
    return `registry_version is ${JSON.stringify(contract.registry_version ?? null)}, and an unknown producer version cannot be shown to be same-or-stricter`;
  }
  if (
    compareVersions(contract.registry_version, observed.registryVersion) < 0
  ) {
    return `registry_version ${contract.registry_version} is older than this run's ${observed.registryVersion}, so it may declare less or declare it more weakly`;
  }
  return null;
}

/**
 * The evidence must be PRIMARY and attributable.
 *
 * `reused_gates` closes circular reuse: a run that reused evidence and then
 * emitted its own could otherwise be reused in turn, and the chain of proof
 * bottoms out on nothing. `caller_chain` closes it a second time from a
 * different direction — a release-path envelope is nested one level deeper than
 * a pull-request one — and a null chain is ineligible rather than assumed
 * shallow. `run_url` is what makes the ledger auditable: evidence nobody can go
 * and read is not evidence anyone checked.
 * @param {object} producer The envelope's producer block.
 * @returns {{detail: string, reason: string}|null} A refusal, or null.
 */
function verifyProducer(producer) {
  const reused = producer.reused_gates;
  if (!Array.isArray(reused)) {
    return {
      detail:
        "producer.reused_gates is absent or not an array, so this run cannot be shown to be primary proof",
      reason: REUSE_REASON.DERIVATIVE,
    };
  }
  if (reused.length) {
    return {
      detail: `producer reused ${reused.length} gate(s), so this is not primary proof`,
      reason: REUSE_REASON.DERIVATIVE,
    };
  }
  const chain = producer.caller_chain;
  if (!Array.isArray(chain) || chain.length !== PRIMARY_CALLER_CHAIN_DEPTH) {
    return {
      detail: `producer.caller_chain is ${JSON.stringify(chain ?? null)}; only a chain of depth ${PRIMARY_CALLER_CHAIN_DEPTH} is a primary pull-request path`,
      reason: REUSE_REASON.UNATTRIBUTABLE,
    };
  }
  if (!producer.run_id || !producer.run_url) {
    return {
      detail:
        "producer.run_id or producer.run_url is absent, so the proof cannot be read back",
      reason: REUSE_REASON.UNATTRIBUTABLE,
    };
  }
  return null;
}

/**
 * Whether the envelope as a WHOLE may be used as a source of proof.
 *
 * Every check here discards the entire document, because each one says the
 * evidence is about a different subject, a different contract, or is not
 * primary. A per-gate check cannot rescue any of them.
 * @param {object} options Inputs.
 * @param {unknown} options.envelope The parsed envelope, or null.
 * @param {string} options.moment The moment being planned.
 * @param {object} options.observed Locally observed facts.
 * @returns {{detail: string|null, ok: boolean, reason: string|null}} Verdict.
 */
function verifyEnvelope({ envelope, moment, observed }) {
  const refuse = (reason, detail) => ({ detail, ok: false, reason });
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return refuse(REUSE_REASON.MALFORMED, "the envelope is not a JSON object");
  }
  if (envelope.schema !== EVIDENCE_SCHEMA_TOKEN) {
    return refuse(
      REUSE_REASON.MALFORMED,
      `schema is ${JSON.stringify(envelope.schema ?? null)}, not ${JSON.stringify(EVIDENCE_SCHEMA_TOKEN)}`
    );
  }
  if (!Array.isArray(envelope.gates)) {
    return refuse(REUSE_REASON.MALFORMED, "gates is not an array");
  }
  if (envelope.verdict !== "proved") {
    return refuse(
      REUSE_REASON.NOT_PROVED,
      `verdict is ${JSON.stringify(envelope.verdict ?? null)}, not "proved"`
    );
  }
  const subjectProblem = verifySubject(envelope.subject ?? {}, observed);
  if (subjectProblem) {
    return refuse(REUSE_REASON.SUBJECT_MISMATCH, subjectProblem);
  }
  const contractProblem = verifyContract(
    envelope.contract ?? {},
    moment,
    observed
  );
  if (contractProblem) {
    return refuse(REUSE_REASON.CONTRACT_MISMATCH, contractProblem);
  }
  const producerProblem = verifyProducer(envelope.producer ?? {});
  if (producerProblem) {
    return refuse(producerProblem.reason, producerProblem.detail);
  }
  return { detail: null, ok: true, reason: null };
}

/**
 * The freshness bound to judge a row by: the tighter of the two, never the
 * looser.
 *
 * A producer that stamped its own bound and a policy that declares one are two
 * claims about the same question, and taking the maximum would let a generous
 * producer widen a window the project narrowed.
 * @param {object} row The evidence row.
 * @param {object} policy The gate's reuse policy.
 * @returns {number|null} The bound in minutes, or null for unbounded.
 */
function effectiveBound(row, policy) {
  const bounds = [row.max_age_minutes, policy.maxAgeMinutes].filter(
    value => typeof value === "number" && value > 0
  );
  return bounds.length ? Math.min(...bounds) : null;
}

/**
 * Whether ONE gate's row proves what this moment requires of it.
 *
 * Row-level failures affect one gate and never leak into another's decision —
 * the fixtures assert exactly that, because a verifier whose failures
 * cross-contaminate is one nobody can reason about one dimension at a time.
 * @param {object} options Inputs.
 * @param {object} options.gate The resolved gate at this moment.
 * @param {number} options.nowMs Clock.
 * @param {object} options.observed Locally observed facts.
 * @param {object} options.policy Its reuse policy.
 * @param {object} [options.row] Its evidence row, if any.
 * @returns {{decision: string, detail: string|null, reason: string}} Verdict.
 */
function verifyRow({ gate, nowMs, observed, policy, row }) {
  const run = (reason, detail = null) => ({ decision: "run", detail, reason });
  if (policy.class === REUSE_CLASS.NEVER) {
    return policy.known
      ? run(REUSE_REASON.NEVER_REUSABLE, "declared never reusable")
      : run(
          REUSE_REASON.UNCLASSIFIED,
          "no reuse class is declared for this gate, and the default is never"
        );
  }
  if (!row) {
    return run(REUSE_REASON.UNCOVERED, "the envelope carries no row for it");
  }
  const bound = effectiveBound(row, policy);
  const effective = readEvidence(
    { ...row, max_age_minutes: bound },
    gate,
    nowMs
  );
  if (effective.status !== "pass") {
    const reason = effective.reason ?? "";
    const stale = reason.includes("past its") || reason.includes("observed_at");
    return run(
      stale ? REUSE_REASON.STALE : REUSE_REASON.NOT_PROVED,
      effective.reason
    );
  }
  if (policy.class === REUSE_CLASS.TIME_SENSITIVE) {
    if (!bound) {
      return run(
        REUSE_REASON.STALE,
        "time-sensitive with no declared window, so freshness was never bounded"
      );
    }
    if (!row.prover?.version) {
      return run(
        REUSE_REASON.UNATTRIBUTABLE,
        "time-sensitive and prover.version is absent, so the scanner that produced it is unknown"
      );
    }
  }
  const rank = LEVEL_RANK[row.level];
  const requiredRank = LEVEL_RANK[gate.level];
  if (rank === undefined || requiredRank === undefined || rank < requiredRank) {
    return run(
      REUSE_REASON.LEVEL_DOWNGRADE,
      `proved at ${JSON.stringify(row.level ?? null)} but this moment requires ${gate.level}`
    );
  }
  // A diff gate resolved a BASE revision, which the tree hash does not carry.
  // Two commits sharing a tree do not share a diff, so this sub-class binds to
  // the commit as well — a strictly stronger requirement than the rest.
  if (policy.diff && !observed.commitMatches) {
    return run(
      REUSE_REASON.SUBJECT_MISMATCH,
      "a diff gate is bound to the commit it diffed, and the commit differs"
    );
  }
  return { decision: "reuse", detail: null, reason: REUSE_REASON.REUSED };
}

/**
 * Plan which gates at a moment may stand down on verified prior evidence.
 *
 * FAIL-CLOSED IS THE WHOLE CONTRACT. Every path through this function that is
 * not "the envelope passed every check AND this row passed every check" returns
 * `run`. There is no blanket switch, no `skip_jobs` equivalent, and no branch
 * where the ABSENCE of evidence produces anything but a full plan.
 * @param {object} options Inputs.
 * @param {unknown} options.envelope The parsed inbound envelope, or null.
 * @param {object|null} [options.gates] The project gates block.
 * @param {string} options.moment The moment being planned.
 * @param {number} [options.nowMs] Clock, injected for tests.
 * @param {object} options.observed Locally observed facts.
 * @param {{detail: string, reason: string}|null} [options.refusal] A refusal the caller already reached.
 * @param {string} [options.runner] The task-runner prefix.
 * @param {Record<string,string>|null} [options.scripts] Project scripts.
 * @returns {{decisions: object[], detail: string|null, verdict: string}} Plan.
 */
export function reusePlan({
  envelope,
  gates = null,
  moment,
  nowMs = Date.now(),
  observed,
  refusal = null,
  runner = undefined,
  scripts = null,
}) {
  const resolveOptions = { gates, moment, scripts };
  const resolved = resolveMoment(
    runner === undefined ? resolveOptions : { ...resolveOptions, runner }
  );
  // A refusal the CALLER already reached outranks anything this function could
  // work out. "The file was not there" and "the file was there and wrong" are
  // different facts about the same absent proof, and only the caller that tried
  // to open it knows which — reporting the wrong one sends an operator looking
  // at the wrong thing, and the ledger compares these tokens.
  const envelopeVerdict = refusal
    ? { detail: refusal.detail, ok: false, reason: refusal.reason }
    : verifyEnvelope({ envelope, moment, observed });
  const rows = new Map(
    envelopeVerdict.ok
      ? envelope.gates
          .filter(row => row && typeof row.gate === "string")
          .map(row => [row.gate, row])
      : []
  );
  const commitMatches = Boolean(
    envelope?.subject?.commit &&
    observed.commit &&
    envelope.subject.commit === observed.commit
  );
  const decisions = resolved.map(gate => {
    const policy = reusePolicyFor(gate.id, gates);
    const outcome = envelopeVerdict.ok
      ? verifyRow({
          gate,
          nowMs,
          observed: { ...observed, commitMatches },
          policy,
          row: rows.get(gate.id),
        })
      : {
          decision: "run",
          detail: envelopeVerdict.detail,
          reason: envelopeVerdict.reason,
        };
    return {
      class: policy.class,
      decision: outcome.decision,
      detail: outcome.detail,
      gate: gate.id,
      label: gate.label,
      level: gate.level,
      proof:
        outcome.decision === "reuse"
          ? (envelope.producer?.run_url ?? null)
          : null,
      reason: outcome.reason,
    };
  });
  return {
    decisions,
    detail: envelopeVerdict.detail,
    verdict: envelopeVerdict.ok ? "verified" : envelopeVerdict.reason,
  };
}

/**
 * Read an envelope from disk for the verifier, refusing anything it cannot
 * safely read.
 *
 * A read failure and a parse failure both return null plus a reason, because
 * the caller does the same thing with both: run everything. They carry
 * DIFFERENT refusal tokens, because an absent record and a corrupt one are
 * different things to go and fix. The byte budget lives here rather than in the
 * caller so every entry point shares one limit.
 * @param {string} path File to read.
 * @param {object} [io] Injected fs, for tests.
 * @returns {{envelope: object|null, reason: string|null, refusal: string|null}} The parsed envelope.
 */
export function readEvidenceFile(path, io = {}) {
  const { readFile = readFileSync, statFile = statSync } = io;
  let raw = null;
  try {
    const { size } = statFile(path);
    if (size > EVIDENCE_BYTE_BUDGET) {
      return {
        envelope: null,
        reason: `evidence at ${path} is ${size} bytes, past the ${EVIDENCE_BYTE_BUDGET}-byte budget`,
        refusal: REUSE_REASON.UNAVAILABLE,
      };
    }
    raw = readFile(path, "utf8");
  } catch (err) {
    return {
      envelope: null,
      reason: `evidence at ${path} could not be opened: ${err.message}`,
      refusal: REUSE_REASON.UNAVAILABLE,
    };
  }
  try {
    return { envelope: JSON.parse(raw), reason: null, refusal: null };
  } catch (err) {
    // Split from the open failure deliberately. Bytes that exist and do not
    // parse are a MALFORMED record; bytes that are not there are an ABSENT one.
    // Both run everything, and an operator needs to know which to go and fix.
    return {
      envelope: null,
      reason: `evidence at ${path} is not JSON: ${err.message}`,
      refusal: REUSE_REASON.MALFORMED,
    };
  }
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
 * How hard a ruleset bites.
 *
 * `evaluate` and `disabled` are not milder versions of `active` — a ruleset in
 * either state asserts NOTHING, which is why `rulesetSignals` refuses to read
 * policy off one. Declaring the value is what lets a project say it is running
 * a ruleset in dry-run on purpose instead of having it silently do nothing.
 */
export const ENFORCEMENTS = Object.freeze(["active", "evaluate", "disabled"]);

/**
 * Repository policy Lisa asserts.
 *
 * Policy differs from a gate in what failure means. A gate failing says stop
 * the change; a policy having drifted says put the setting back. That is why
 * `on_drift` defaults to repair and a gate never does.
 *
 * `review` and `ruleset` describe the SHAPE of the branch ruleset Lisa builds,
 * and they exist because a shipped `all/github-rulesets/base.json` used to
 * carry them instead. Seven of its fields were already declared here, so two
 * writers set the same settings and whichever ran last won with no drift
 * report between them; four more — `bypass_actors`, the `ref_name` conditions,
 * `required_approving_review_count`, `enforcement` — could not be declared at
 * all, which made a template value a fleet-wide lock no project could override.
 * The template is gone and the applier generates its payload from these fields,
 * so there is one writer and one declaration.
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
  review: Object.freeze({
    required_approving_review_count: "number",
    require_code_owner_review: "boolean",
    // Declarable precisely because GitHub fills it in when a payload omits it,
    // and what it fills in is not "leave it alone". Measured against the live
    // API on 2026-08-25: a `pull_request` rule sent without the field came
    // back with it `true`; flipped to `false` explicitly it came back `false`;
    // sent again without it, it came back `true`. So an operator who wants it
    // OFF has no way to hold it off — every apply silently puts it back — and
    // an operator who wants it ON is relying on a GitHub default that can move
    // under them without any declaration recording the choice. Undeclared
    // still means undeclared: the generator omits the field entirely rather
    // than defaulting it, so a project that says nothing sends exactly the
    // payload it sent before this existed.
    require_extra_approval_for_unattributed_changes: "boolean",
  }),
  ruleset: Object.freeze({
    enforcement: ENFORCEMENTS,
    include_refs: "string[]",
    exclude_refs: "string[]",
    bypass_actors: "object[]",
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
  "thresholdRatchet",
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
 * What a presence-gated CI job does when nothing proves its property.
 *
 * Six `quality.yml` jobs decide what to run by grepping for a script. When the
 * script is absent AND no declaration covers the gate, they used to print a
 * notice and exit 0 — and two of the six post required branch-protection
 * contexts, so the context reported satisfied having proved nothing. That is
 * strictly worse than having no gate, because it manufactures evidence.
 *
 * This is ONE control for the whole family, deliberately. `bdd_coverage`
 * hand-rolled a private three-state input (`bdd_mode`) for the same decision;
 * repeating that six more times would be six more adoption operations and six
 * more places to drift. That input is now retired and `bdd_coverage` answers to
 * the `behavior-contract` declaration like everything else — but it does NOT
 * join this family, because it has no absent-script path to fall back from: its
 * prover ships to every project on the stack, so an undeclared gate there would
 * mean enforcing a contract nobody adopted. It stands down unless declared.
 *
 * `warn` is the default and reproduces today's behaviour exactly, because
 * making absence fatal before a declaration is guaranteed turns every
 * unconfigured consumer red on the next bump — the ordering #2838 states.
 */
export const UNPROVEN_RESPONSES = Object.freeze(["warn", "fail"]);

/**
 * The response Lisa assumes when a project declares none.
 */
export const DEFAULT_UNPROVEN = "warn";

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
 * `unproven` is split out for the same reason: it is a RESERVED sibling of
 * `runner`, not a gate id. Left in the block it reaches `validateGates` as
 * `gates."unproven" is not a gate Lisa knows` — a BLOCKING problem — so a
 * project that set the control would have `validate` refuse it and get no
 * enforcement either.
 * @param {string} [cwd] Directory to look in.
 * @returns {{runner: string, unproven: string, gates: object, policy: object, config: object}} Parsed config.
 * @throws {Error} When `gates.runner` is not a runner, or `gates.unproven` is not a permitted response.
 */
export function readGates(cwd = process.cwd()) {
  const path = join(cwd, ".lisa.config.json");
  if (!existsSync(path)) {
    return {
      runner: DEFAULT_RUNNER,
      unproven: DEFAULT_UNPROVEN,
      gates: {},
      policy: {},
      config: {},
    };
  }
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`.lisa.config.json is not readable: ${err.message}`);
  }
  const {
    runner: declared,
    unproven: declaredUnproven,
    ...gates
  } = config.gates ?? {};
  const unproven =
    declaredUnproven === undefined ? DEFAULT_UNPROVEN : declaredUnproven;
  if (!UNPROVEN_RESPONSES.includes(unproven)) {
    throw new Error(
      `gates.unproven is ${JSON.stringify(declaredUnproven)}, which is not ` +
        `one of ${UNPROVEN_RESPONSES.join(", ")}. An unrecognised response is ` +
        `refused rather than defaulted, because falling through to the ` +
        `permissive value is how a typo silently turns enforcement off for ` +
        `the project that asked for it.`
    );
  }
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
  return { runner, unproven, gates, policy: config.policy ?? {}, config };
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
  const path = join(cwd, PACKAGE_MANIFEST);
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
 * The project's package.json scripts, for deciding what a seed may declare.
 *
 * Returns `{}` rather than throwing on an absent or unreadable manifest: the
 * only consumer is `seedGates`, and "no scripts" is exactly the answer that
 * makes it seed nothing — which is the safe direction. A malformed manifest is
 * a different claim and does throw, for the reason the resolve step in
 * `quality.yml` keeps stderr: a parse failure read as an empty result is a
 * broken command reported as a measured zero.
 * @param {string} [cwd] Directory holding package.json.
 * @returns {Record<string, string>} The scripts block.
 */
export function readScripts(cwd = process.cwd()) {
  const path = join(cwd, PACKAGE_MANIFEST);
  if (!existsSync(path)) return {};
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`package.json is not readable: ${err.message}`);
  }
  return manifest.scripts ?? {};
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
 * Whether a key on a gate block is a moment at all, family spellings included.
 *
 * The deploy families are NOT in `MOMENTS` — `isMoment` alone skips them, which
 * would silently exempt exactly the declarations the `no-runner-for-moment`
 * verdict exists to report. The configuration keys that are not moments at all
 * (`run`, `needs`, `evidence`) fall out of both checks.
 *
 * One function rather than the same two-clause test written at each site: the
 * classifier and `declarationsAt` have to agree on what counts as a moment key
 * or the projection would narrow away a declaration the classifier still
 * judges, which is a divergence of exactly the kind #3042 was filed about.
 * @param {string} key A key read off a gate's block.
 * @returns {boolean} Whether it names a moment.
 */
function isMomentKey(key) {
  return isMoment(key) || MOMENT_FAMILIES.includes(momentFamily(key));
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
  problems.push(...validateAwaitedContexts(gates));
  return problems;
}

/**
 * Refuse two required gates that await one context with different pins.
 *
 * Two gates may legitimately be proved by the same external signal, and the
 * ruleset carries one entry per context — so the payload writer has to collapse
 * them. Collapsing silently keeps whichever it met first and DISCARDS the other
 * declaration's `posted_by`, which is how a project ends up requiring a context
 * pinned to an app it never named. An omitted id is not "no opinion" either: it
 * means unpinned, GitHub's "any source", which is a different requirement from
 * a pinned one.
 *
 * So an exact duplicate — same context, same pin, including both unpinned — is
 * fine and collapses. Anything else is refused here, before a payload is built
 * from it.
 * @param {object} gates The gates block.
 * @returns {string[]} Problems.
 */
function validateAwaitedContexts(gates) {
  const problems = [];
  const seen = new Map();
  for (const [id, gate] of Object.entries(gates ?? {})) {
    if (!gate || typeof gate !== "object" || Array.isArray(gate)) continue;
    for (const [moment, value] of Object.entries(gate)) {
      const entry =
        typeof value === "string" ? { level: value } : (value ?? {});
      if (entry.level !== "required" || !entry.await) continue;
      const key = `${moment}\u0000${entry.await}`;
      const pin = entry.posted_by ?? null;
      const previous = seen.get(key);
      if (previous === undefined) {
        seen.set(key, { id, pin });
        continue;
      }
      if (previous.pin === pin) continue;
      problems.push(
        `gates."${id}"."${moment}" and gates."${previous.id}"."${moment}" both ` +
          `await "${entry.await}" but name different apps ` +
          `(${JSON.stringify(pin)} vs ${JSON.stringify(previous.pin)}). A ruleset ` +
          `carries ONE entry per context, so one of these pins would be dropped ` +
          `without a word — and an omitted posted_by means unpinned, which is a ` +
          `different requirement from a pinned one, not an absent opinion.`
      );
    }
  }
  return problems;
}

/**
 * How a declaration resolves to something able to run it.
 *
 * Five answers, and the separations are the whole value. A check that collapsed
 * them would rediscover "no runner exists for the deploy families" and file it
 * as an orphan — a different defect with its own issue — or call a property
 * proved by a step inside another job unenforced, which is worse than silence
 * because it is confidently wrong.
 */
const EXECUTABLE = "executable";
const ORPHANED = "orphaned";
const NO_RUNNER_FOR_MOMENT = "no-runner-for-moment";
const OUTSIDE_FACADE = "outside-facade";
const VACUOUS_PROVER = "vacuous-prover";

export const EXECUTOR_VERDICTS = Object.freeze([
  EXECUTABLE,
  ORPHANED,
  NO_RUNNER_FOR_MOMENT,
  OUTSIDE_FACADE,
  VACUOUS_PROVER,
]);

/**
 * Verdicts that make a declaration a configuration ERROR.
 *
 * The other two are facts about Lisa, not about the project: a moment family
 * with no runner yet is a roadmap item with its own issue, and a property
 * proved outside the façade IS enforced. Refusing either would turn a report
 * about the project's governance into a report about Lisa's backlog.
 */
const BLOCKING_VERDICTS = Object.freeze([ORPHANED, VACUOUS_PROVER]);

/** Where a repository declares which moments it runs gates at. */
export const MOMENT_EXECUTOR_DIR = ".github/workflows";

/**
 * A moment handed to a gate runner, in either spelling a workflow uses.
 *
 * `moment: <value>` is how a caller parameterises a reusable workflow, and
 * `--moment=<value>` is how a shell step invokes `lisa-run-gates.mjs` directly.
 * Both are the same statement — "this workflow executes gates at this moment" —
 * and a scan that read only one of them would report a repository as having no
 * runner while looking straight at one.
 *
 * `[ \t]*` rather than `\s*` around the colon, deliberately. A workflow that
 * DEFINES a `moment:` input writes the key with its value on following lines,
 * and `\s*` would step over the newline and capture `description` as the
 * moment. The definition of an input is not the use of one.
 *
 * The backtick is excluded from the unquoted form for the same class of reason,
 * and it was measured rather than anticipated: the header of Lisa's own
 * `gates.yml` documents the defect it fixes by quoting
 * ``list --moment=pre-deploy:production``, and the first version of this scan
 * read that PROSE as a runner and reported the moment executed. A workflow
 * describing a command is not a workflow running one.
 */
const MOMENT_ARGUMENT =
  /(?:\bmoment[ \t]*:[ \t]*|--moment=)(?:'([^'\n]+)'|"([^"\n]+)"|([^\s'"#`]+))/g;

/** A line that is entirely a comment — YAML's and the shell's are both `#`. */
const COMMENT_LINE = /^\s*#/;

/** The answer when nothing has been measured: no moment is executed. */
const NOTHING_EXECUTED = Object.freeze({
  moments: Object.freeze([]),
  families: Object.freeze([]),
});

/**
 * Which moments THIS repository actually runs gates at, read off its workflows.
 *
 * The registry's `no-runner-for-moment` verdict used to be an ASSERTION: every
 * declaration in a deploy or continuous family got told "nothing runs gates
 * here at all yet", because at the time nothing did. That sentence is a fact
 * about the repository, not about the gate, and hardcoding it has two failure
 * modes that arrive together. It keeps saying "nothing runs this" after a runner
 * ships — a control lying in the reassuring direction. And it keeps EXCUSING a
 * declaration that resolves to no prover, calling it inert-but-fine, at exactly
 * the moment the runner would have executed it and reported UNPROVABLE.
 *
 * So it is measured instead. A repository executes a moment when one of its
 * workflows names that moment to a gate runner.
 *
 * ## Family, when the environment is computed
 *
 * A deploy caller writes `moment: pre-deploy:${{ ... }}` — the family is
 * literal and the environment is a run-time expression. Requiring an exact
 * match would report "no runner" for every real deploy façade there is, so a
 * computed environment registers the FAMILY, and any moment in it counts as
 * executed. A value with no readable family (`moment: ${{ inputs.moment }}`,
 * which is how a reusable workflow forwards its own input) contributes nothing:
 * it is plumbing between two workflows, and the caller at the other end is the
 * one that made a statement about a moment.
 *
 * ## An unreadable directory answers "nothing", and that is the honest answer
 *
 * A repository with no `.github/workflows` runs no workflows, so no workflow of
 * its executes any moment. That is not a guess made under uncertainty; it is
 * the measurement.
 * @param {object} [options] Inputs.
 * @param {string} [options.cwd] Repository root.
 * @param {string} [options.dir] Directory holding the workflows.
 * @returns {{moments: string[], families: string[]}} Exact moments executed, and families executed at a computed environment.
 */
export function momentsExecutedBy({
  cwd = process.cwd(),
  dir = MOMENT_EXECUTOR_DIR,
} = {}) {
  const moments = new Set();
  const families = new Set();
  const root = join(cwd, dir);
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return NOTHING_EXECUTED;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
    let text;
    try {
      text = readFileSync(join(root, entry), "utf8");
    } catch {
      continue;
    }
    for (const value of momentArguments(text)) {
      recordExecutedMoment(value, moments, families);
    }
  }
  return {
    moments: [...moments].sort(),
    families: [...families].sort(),
  };
}

/**
 * Every moment argument one workflow file names.
 * @param {string} text The workflow source.
 * @returns {string[]} The raw values, unvalidated.
 */
function momentArguments(text) {
  const found = [];
  // Line by line, so a whole-line comment can be dropped before it is read.
  // Both languages in a workflow file — YAML and the shell inside `run:` —
  // comment with `#`, so one rule covers both, and a header documenting the
  // very command this scan looks for stops counting as an invocation of it.
  for (const line of text.split("\n")) {
    if (COMMENT_LINE.test(line)) continue;
    for (const match of line.matchAll(MOMENT_ARGUMENT)) {
      const value = match[1] ?? match[2] ?? match[3];
      if (value) found.push(value.trim());
    }
  }
  return found;
}

/**
 * Record one workflow's moment argument against the exact/family sets.
 * @param {string} value The raw value read from the workflow.
 * @param {Set<string>} moments Exact moments, mutated in place.
 * @param {Set<string>} families Families executed at a computed environment.
 */
function recordExecutedMoment(value, moments, families) {
  if (MOMENTS.includes(value)) {
    moments.add(value);
    return;
  }
  const separator = value.indexOf(":");
  if (separator === -1) return;
  const family = value.slice(0, separator);
  const environment = value.slice(separator + 1);
  if (!MOMENT_FAMILIES.includes(family) || environment === "") return;
  // `${{ ... }}` and `$VAR` both mean "decided at run time". The family is
  // still a statement, and it is the only one available.
  if (environment.includes("$")) families.add(family);
  else moments.add(`${family}:${environment}`);
}

/**
 * Whether the measured inventory covers one declared moment.
 * @param {{moments?: string[], families?: string[]}} executed The inventory.
 * @param {string} moment The declared moment.
 * @returns {boolean} Whether something in the repository runs gates there.
 */
function executesMoment(executed, moment) {
  const { moments = [], families = [] } = executed ?? {};
  return moments.includes(moment) || families.includes(momentFamily(moment));
}

/**
 * Gates whose only prover reports findings and cannot fail.
 *
 * A declaration in front of a prover with a guaranteed-zero exit reads as
 * governed everywhere that reads the registry while proving nothing — the
 * vacuous green this whole subsystem exists to refuse. `required` in front of
 * one is refused outright; `optional` is reported, because "advisory, and we
 * know" is a coherent position and "required, proved by something that cannot
 * fail" is not.
 *
 * The value is the operator-readable reason, and it names the prover, because a
 * refusal that does not say WHICH executor is advisory sends the reader to the
 * gate — which is not the thing that is wrong.
 */
export const ADVISORY_PROVERS = Object.freeze({
  "version-duplication":
    "duplicate-versions.yml runs in advisory mode: it reports duplicates and " +
    "exits 0 whatever it finds. Nothing it can discover will fail a check, so " +
    "a required declaration in front of it is a guarantee of nothing. The " +
    "pairing becomes valid when that workflow runs with --strict.",
});

/**
 * Gates proved by a step inside a job the façade does not represent.
 *
 * A THIRD thing, distinct from both "executable" and "orphaned", and the
 * distinction is not academic: `conflict-residue` was exactly this case until a
 * dedicated job was built for it — proved by a step inside a multi-purpose
 * workflow — and a classifier without this verdict would have called it an
 * orphan and implied the property was unenforced. It was not.
 *
 * The value says where the prover lives, so the report can say "proved
 * elsewhere" rather than "proved by nothing".
 *
 * EMPTY TODAY, deliberately and visibly. The one member it had was retired by
 * being given a real job. The verdict stays because the shape recurs, and
 * `tests/unit/scripts/lisa-gates-declared-executors` exercises it against a
 * synthetic entry rather than leaving a branch nothing reaches.
 */
export const PROVED_OUTSIDE_FACADE = Object.freeze({});

/**
 * The level one moment entry declares.
 * @param {unknown} entry The value under a moment key.
 * @returns {string} The level, or the empty string when it declares none.
 */
function declaredLevel(entry) {
  if (typeof entry === "string") return entry;
  if (entry !== null && typeof entry === "object") {
    const { level } = entry;
    if (typeof level === "string") return level;
  }
  return "";
}

/**
 * Classify every declaration by whether anything can execute it.
 *
 * MOMENT-AWARE, or it is wrong on its first run. The hook moments have a
 * generic executor — `lisa-run-gates.mjs` resolves whatever a moment declares
 * and runs `<runner> <task>` — so a declaration there needs a TASK. The
 * pull-request moment has no such runner: it has one hand-written block per
 * gate and `QUALITY_JOB_GATES` is the record of which ones exist, so a
 * declaration there needs a JOB. A check asking the pull-request question at
 * every moment flags declarations that work.
 *
 * `off` is skipped, and for a sharper reason than tidiness: it is a declaration
 * NOT to run and the only route that removes the required context along with
 * the job, which is what makes it the safe alternative to `skip_jobs`.
 * Demanding an executor for it would argue against the mechanism this check
 * exists to protect.
 *
 * `await` is skipped because it asks for nothing to be run — its prover is an
 * external app, which is the entire meaning of awaiting. `validateGates`
 * already refuses a malformed await.
 *
 * `scripts` of `null` means UNKNOWN, not empty, and nothing is reported from
 * it. A manifest this process could not read must never make every hook-moment
 * declaration look like an orphan.
 * @param {object} options Inputs.
 * @param {object} options.gates The gates block.
 * @param {Record<string, string>|null} [options.scripts] The project's package scripts, or null when unknown.
 * @param {Record<string, string>} [options.outsideFacade] Gates proved by a step the façade does not represent. A SEAM, not configuration: the shipped table is empty today, and a branch nothing can reach is a branch nothing tests.
 * @returns {Array<{gate: string, moment: string, level: string, verdict: string, detail: string}>} One finding per declaration that is not plainly executable.
 */
export function classifyDeclaredExecutors({
  gates,
  scripts,
  outsideFacade = PROVED_OUTSIDE_FACADE,
  executedMoments = NOTHING_EXECUTED,
}) {
  const findings = [];
  for (const [gate, block] of Object.entries(gates ?? {})) {
    if (!Object.hasOwn(REGISTRY, gate)) continue;
    if (block === null || typeof block !== "object") continue;
    for (const [moment, entry] of Object.entries(block)) {
      if (!isMomentKey(moment)) continue;
      const level = declaredLevel(entry);
      if (level === "off") continue;
      if (entry !== null && typeof entry === "object" && entry.await) continue;
      const finding = verdictFor({
        gate,
        block,
        moment,
        level,
        scripts,
        outsideFacade,
        executedMoments,
      });
      if (finding !== null) findings.push(finding);
    }
  }
  return findings;
}

/**
 * One declaration's verdict, or null when it is plainly executable.
 * @param {object} options The declaration.
 * @param {string} options.gate Gate id.
 * @param {object} options.block The gate's block.
 * @param {string} options.moment Declared moment.
 * @param {string} options.level Declared level.
 * @param {Record<string, string>|null|undefined} options.scripts Project scripts.
 * @param {Record<string, string>} options.outsideFacade Gates proved outside the façade.
 * @param {{moments?: string[], families?: string[]}} options.executedMoments Moments this repository actually runs gates at.
 * @returns {{gate: string, moment: string, level: string, verdict: string, detail: string}|null} The finding.
 */
function verdictFor({
  gate,
  block,
  moment,
  level,
  scripts,
  outsideFacade,
  executedMoments,
}) {
  const make = (verdict, detail) => ({ gate, moment, level, verdict, detail });
  if (level === "required" && Object.hasOwn(ADVISORY_PROVERS, gate)) {
    return make(VACUOUS_PROVER, ADVISORY_PROVERS[gate]);
  }
  if (Object.hasOwn(outsideFacade, gate)) {
    return make(
      OUTSIDE_FACADE,
      `${gate} is proved by ${outsideFacade[gate]}, which the gate ` +
        `façade does not represent. The property IS enforced; nothing here ` +
        `runs it.`
    );
  }
  const family = momentFamily(moment);
  // A HAND-WRITTEN JOB is still the answer wherever one exists, and it is the
  // FIRST answer: that job's `name:` is the gate's label, it owns the context,
  // and the generic runner deliberately emits no leg for it.
  if (
    family === PULL_REQUEST &&
    Object.values(QUALITY_JOB_GATES).includes(gate)
  )
    return null;
  // Everything below is the GENERIC RUNNER's question, and until #2881 the
  // pull-request moment was excluded from it. That exclusion was true when it
  // was written — the moment had one hand-written block per gate and nothing
  // else — and it is the asymmetry the runner closes: a pull-request
  // declaration with no job now gets a matrix leg, exactly as a commit
  // declaration with no hook step gets a hook leg. So the same test applies to
  // both: does the declaration resolve to a task this project actually has?
  //
  // What has NOT changed is what happens when it does not. A leg with no task
  // reports NOT PROVED and fails, which is loud rather than absent — but it is
  // still a declaration describing nothing, so it is still `orphaned` here.
  // The classifier answers "can anything run this", not "will something say so
  // when it cannot".
  //
  // The deploy and continuous families have a generic runner the same way the
  // hooks do — `lisa-run-gates.mjs --moment=<moment>` — but unlike a hook,
  // which every repository installs, the CALLER is a workflow this repository
  // either has or does not. So the question is asked of the repository rather
  // than answered from a table: is there a workflow that hands this moment to
  // the runner?
  if (
    MOMENT_FAMILIES.includes(family) &&
    !executesMoment(executedMoments, moment)
  ) {
    return make(
      NO_RUNNER_FOR_MOMENT,
      `nothing in this repository runs gates at "${moment}": no workflow ` +
        `under ${MOMENT_EXECUTOR_DIR} hands that moment to Lisa's gate ` +
        `runner. The declaration is read, validated and listed, and then ` +
        `never executed — inert rather than wrong. Add a caller for Lisa's ` +
        `gates.yml at this moment (the shipped deploy.yml and ` +
        `continuous-gates.yml templates do exactly that), or declare it ` +
        `"off" to put on record that you meant it not to run.`
    );
  }
  // Everything remaining is either integrated into its governing surface or
  // executed by a generic runner. Ask the canonical resolver which one it is;
  // reproducing its task precedence here is how a new execution mode can be
  // mistaken for a missing package script.
  if (scripts === null || scripts === undefined) return null;
  const [resolved] = resolveMoment({
    gates: { [gate]: block },
    moment,
    scripts,
  });
  if (resolved && isNonRunnerProverMode(resolved.mode)) return null;
  const task = resolved?.task;
  if (
    task !== undefined &&
    task !== null &&
    Object.hasOwn(scripts ?? {}, task)
  ) {
    return null;
  }
  return make(
    ORPHANED,
    `gates."${gate}"."${moment}" resolves to the task "${task}", and this ` +
      `project has no such script. The gate runner would find nothing to ` +
      `run, so the level in front of it describes nothing.`
  );
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
  problems.push(...validateReuse(id, gate.reuse));

  for (const [moment, value] of Object.entries(gate)) {
    // A key that is neither a known field nor a well-formed moment is a typo,
    // and skipping it silently is the hole this validator exists to close:
    // `pull_request` with an underscore reads as a configured gate and enables
    // nothing at all. Same shape as a misspelled gate id, one level down.
    if (!isMoment(moment)) {
      // Named before the generic typo message, because the generic one reads
      // as "this is not a moment" and sends the author looking for a moment
      // spelling. The mistake is real but different: the field exists, and it
      // belongs one level down.
      if (moment === FAILURE_SHAPE_FIELD) {
        // Named before the generic typo message for the reason the caller
        // chain is: "this is not a moment" sends the author looking for a
        // moment spelling, and the mistake is a level, not a spelling.
        problems.push(
          `gates."${id}"."${FAILURE_SHAPE_FIELD}" is declared for the whole ` +
            `gate, but a gate's prover can differ by moment — this ` +
            `repository runs code-style through "lint:staged" at commit and ` +
            `"lint" at pull-request, and only the first prints lint-staged's ` +
            `own banner. Declare it inside the moment whose prover prints ` +
            `it, e.g. gates."${id}"."${COMMIT}".${FAILURE_SHAPE_FIELD}. ` +
            `A gate-level key is also refused outright by any older Lisa, ` +
            `which refuses the whole gates block with it.`
        );
        continue;
      }
      if (moment === CALLER_CHAIN_FIELD) {
        problems.push(
          `gates."${id}"."${CALLER_CHAIN_FIELD}" is declared for the whole ` +
            `gate, but the chain of jobs a check run is posted under is a ` +
            `property of ONE moment's wiring, not of the gate: the same job ` +
            `posts "<caller> ${CONTEXT_SEPARATOR.trim()} <label>" on the ` +
            `pull-request path and "Release ${CONTEXT_SEPARATOR.trim()} ` +
            `<caller> ${CONTEXT_SEPARATOR.trim()} <label>" on the release ` +
            `path. Declare it inside the moment whose context it names, e.g. ` +
            `gates."${id}"."${PULL_REQUEST}".${CALLER_CHAIN_FIELD}.`
        );
        continue;
      }
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
 * Validate a gate's declared failure shape.
 *
 * Three refusals, and all three are the same defect wearing different clothes:
 * a declaration that looks configured and governs nothing.
 *
 * - **Not an array.** A bare string is the natural typo, and it would iterate
 *   as characters — every transcript containing the letter `c` would match.
 * - **Empty array.** Reads as "declared" at a glance and matches nothing ever.
 * - **Empty string.** The declaration that cannot fail: an empty needle is
 *   contained in every line, so every unrecognised failure would report FAILED
 *   against whichever gate declared it. That is this mechanism's own inverse
 *   defect, and shipping it by accident is one keystroke away.
 * @param {string} id Gate id.
 * @param {string} moment Moment key.
 * @param {*} shape The declared value, if any.
 * @returns {string[]} Problems.
 */
function validateFailureShape(id, moment, shape) {
  if (shape === undefined) return [];
  const where = `gates."${id}"."${moment}".${FAILURE_SHAPE_FIELD}`;
  if (!Array.isArray(shape)) {
    return [
      `${where} is ${JSON.stringify(shape)}; expected a list of literal ` +
        `strings this gate's prover prints when it measures the property and ` +
        `finds it wanting. A bare string would be read one character at a ` +
        `time, and every transcript contains most characters.`,
    ];
  }
  if (shape.length === 0) {
    return [
      `${where} is empty, so it declares nothing while looking configured. ` +
        `Remove it, or name the line the prover actually prints.`,
    ];
  }
  const problems = [];
  for (const [index, entry] of shape.entries()) {
    if (typeof entry !== "string") {
      problems.push(
        `${where}[${index}] is ${JSON.stringify(entry)}; expected a literal ` +
          `string from the prover's own output.`
      );
      continue;
    }
    if (entry.trim() === "") {
      problems.push(
        `${where}[${index}] is blank. An empty needle is contained in every ` +
          `line, so this would report a measured failure for any output at ` +
          `all — the inverse of the defect the field exists to fix.`
      );
    }
  }
  return problems;
}

/**
 * Validate a gate's reuse declaration (#3013).
 *
 * A half-written declaration here is the dangerous kind: a `time-sensitive`
 * class with no window would either be unbounded — the freshness requirement
 * resolving against nothing, which is the failure the gate façade exists to
 * refuse — or silently fall back to `never`, which is safe but leaves the
 * author believing they configured something. Refusing at declaration time is
 * the only reading that tells them.
 *
 * A window on a class that does not use one is refused for the mirror reason:
 * it reads as a bound that is being applied, and it is not.
 * @param {string} id Gate id.
 * @param {*} reuse The declared block, if any.
 * @returns {string[]} Problems.
 */
function validateReuse(id, reuse) {
  if (reuse === undefined) return [];
  const where = `gates."${id}"."reuse"`;
  if (!reuse || typeof reuse !== "object" || Array.isArray(reuse)) {
    return [`${where} must be an object`];
  }
  const problems = [];
  if (!REUSE_CLASSES.includes(reuse.class)) {
    problems.push(
      `${where}.class is ${JSON.stringify(reuse.class ?? null)}; ` +
        `expected one of ${REUSE_CLASSES.join(", ")}.`
    );
  }
  const window = reuse.max_age_minutes;
  if (reuse.class === REUSE_CLASS.TIME_SENSITIVE) {
    if (!Number.isFinite(window) || window <= 0) {
      problems.push(
        `${where}.max_age_minutes is ${JSON.stringify(window ?? null)}; ` +
          `a time-sensitive gate depends on external state that changes ` +
          `without the tree, so it must say how stale an answer it accepts. ` +
          `An unbounded window is not freshness, it is an unmeasured claim.`
      );
    }
  } else if (window !== undefined) {
    problems.push(
      `${where}.max_age_minutes is declared on a "${reuse.class}" gate, ` +
        `where nothing reads it. Either the class is wrong or the window is.`
    );
  }
  if (reuse.diff !== undefined && typeof reuse.diff !== "boolean") {
    problems.push(`${where}.diff must be true or false`);
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
    if (NO_STATUS_MOMENTS.includes(moment)) {
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
  } else if (entry.evidence !== undefined) {
    // Evidence describes what an AWAITED signal's description proves. Declared
    // without an `await`, there is no signal and no description, so the block
    // governs nothing — and it was silently skipped before, which is how a
    // project marks a reviewer and gets no reviewer at all.
    problems.push(
      `gates."${id}"."${moment}".evidence describes what an awaited signal's ` +
        `description proves, but this moment awaits nothing. Declare "await" ` +
        `alongside it, or drop the evidence block — it governs nothing here.`
    );
  }
  problems.push(
    ...validateFailureShape(id, moment, entry[FAILURE_SHAPE_FIELD])
  );
  problems.push(...validatePostedBy(id, moment, entry));
  problems.push(...validateCallerChain(id, moment, entry));
  if (!known && !interceptor && !entry.await && !entry.run && !gateRun) {
    problems.push(
      `gates."${id}"."${moment}" names no prover and Lisa has no default task ` +
        `for a custom gate, so nothing would execute.`
    );
  }
  return problems;
}

/**
 * Validate the app pin on an awaited signal.
 *
 * A required status check can name the ONE app allowed to post it, which is
 * what stops any other writer satisfying it. The pin therefore has to travel
 * with the declaration of who posts the signal, not with the ruleset payload —
 * a shipped template that hardcoded two vendor integration ids is precisely
 * what this replaces, and it was a fleet-wide lock no project could override.
 *
 * Refused on a gate Lisa RUNS, because those are posted by GitHub Actions and
 * the applier pins them to it already; a second, different pin on the same
 * context would name an app that can never post it and block every pull
 * request in the repository forever.
 * @param {string} id Gate id.
 * @param {string} moment Moment key.
 * @param {object} entry The moment entry.
 * @returns {string[]} Problems.
 */
function validatePostedBy(id, moment, entry) {
  if (entry.posted_by === undefined) return [];
  const where = `gates."${id}"."${moment}".posted_by`;
  if (!entry.await) {
    return [
      `${where} names the app that posts a signal, but this moment declares ` +
        `no await. Lisa posts its own gates through GitHub Actions and pins ` +
        `them itself; a second pin would name an app that never posts the ` +
        `context, and a required check nothing can post blocks every pull ` +
        `request.`,
    ];
  }
  if (!Number.isInteger(entry.posted_by) || entry.posted_by <= 0) {
    return [
      `${where} is ${JSON.stringify(entry.posted_by)}; expected the positive ` +
        `integer GitHub App id that posts "${entry.await}".`,
    ];
  }
  return [];
}

/**
 * Validate a declaration's caller-chain override.
 *
 * Every arm refuses at DECLARATION time something that would otherwise fail at
 * merge time, invisibly. A required context nothing posts does not turn a pull
 * request red — GitHub holds it at "Expected — Waiting for status to be
 * reported" indefinitely, with no failing check to read and no log to open —
 * so a chain that derives such a name has to be caught by the only thing that
 * can still say anything about it, which is the validator.
 *
 * Three ways it can derive a name nothing posts, and each is refused:
 *
 * 1. On an `await`ing moment it is a no-op. An awaited signal posts under its
 *    own name from wherever its app runs, and no chain prefixes it — so the
 *    author who declared the override to fix a context would keep requiring
 *    the unchanged one while believing it had been fixed.
 * 2. At a moment where nothing posts a status at all there is no check-run
 *    name for the chain to shape.
 * 3. A blank, non-string or empty level derives `" / <label>"` or
 *    `"<a> /  / <label>"` — strings that read as plausible and that no run has
 *    ever posted. `declaredCallerChain` is what refuses those, and it is the
 *    same refusal `contextsFor` applies, called here so it lands with the
 *    declaration rather than with the derivation.
 * @param {string} id Gate id.
 * @param {string} moment Moment key.
 * @param {object} entry The moment entry.
 * @returns {string[]} Problems.
 */
function validateCallerChain(id, moment, entry) {
  const value = entry[CALLER_CHAIN_FIELD];
  if (value === undefined) return [];
  const where = `gates."${id}"."${moment}".${CALLER_CHAIN_FIELD}`;

  if (entry.await) {
    return [
      `${where} names the chain of jobs a check run is posted under, but ` +
        `this moment awaits "${entry.await}" — an awaited signal posts under ` +
        `its own name from wherever its app runs, and no chain prefixes it. ` +
        `The override would change nothing: the required context would still ` +
        `be "${entry.await}".`,
    ];
  }
  if (NO_STATUS_MOMENTS.includes(moment)) {
    return [
      `${where} names the chain of jobs a check run is posted under, but ` +
        `nothing posts a check run at "${moment}" — it runs here, before ` +
        `there is a pull request for a status to attach to. Declare it at ` +
        `"${PULL_REQUEST}", which is the moment whose context it shapes.`,
    ];
  }
  const levels = Array.isArray(value) ? value : [value];
  if (levels.some(level => typeof level !== "string")) {
    return [
      `${where} is ${JSON.stringify(value)}; expected the job names that ` +
        `reach this gate's prover, outermost first — an array of strings, or ` +
        `the same chain as one "${CONTEXT_SEPARATOR.trim()}"-joined string. ` +
        `Read them off a completed run rather than off the YAML: a check ` +
        `run's name is the chain of JOB names, and the workflow's own "name:" ` +
        `never appears in it.`,
    ];
  }
  try {
    declaredCallerChain(value);
  } catch (error) {
    return [`${where} is ${JSON.stringify(value)}: ${error.message}`];
  }
  return [];
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
  problems.push(...validateReviewerFlag(where, evidence));
  return problems;
}

/**
 * Validate the third-party-reviewer marker on an evidence block.
 *
 * `reviewer: true` says this awaited signal is a third-party CODE REVIEW whose
 * evidence `check-third-party-review-evidence.mjs` enforces at the head commit.
 * Several gates may carry it; each then shows its own evidence.
 *
 * Only `true` and `false` are accepted. A truthy string or a `1` would read as
 * "on" to a careless consumer and as "not exactly true" to this one, and a
 * marker that means different things to its writer and its reader is worse than
 * an absent one — which is the fail-open shape the whole feature refuses.
 * @param {string} where - The declaration path, for the message.
 * @param {object} evidence - The evidence block.
 * @returns {string[]} Problems.
 */
function validateReviewerFlag(where, evidence) {
  if (evidence.reviewer === undefined) return [];
  if (typeof evidence.reviewer !== "boolean") {
    return [
      `${where}.reviewer is ${JSON.stringify(evidence.reviewer)}; expected ` +
        `true or false. Only the boolean true marks this awaited signal as a ` +
        `third-party code review, so any other value silently declares nothing.`,
    ];
  }
  if (evidence.reviewer !== true) return [];
  if (Array.isArray(evidence.proof) && evidence.proof.length > 0) return [];
  return [
    `${where}.reviewer is true but no ${where}.proof phrase is declared. The ` +
      `reviewed-when phrase is an ALLOWLIST — only a description that matches ` +
      `it counts as evidence a review happened — so leaving it to the shipped ` +
      `defaults alone means this project never stated what its own reviewer ` +
      `says when it has actually read the code.`,
  ];
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
  // Refused rather than ignored. `deps` is a claim about the prover Lisa
  // wrote, and honouring a project's copy of it would let a declaration skip
  // an install its own `run:` needs — a leg failing as `Cannot find module`,
  // which reads as a broken gate rather than as a wrong declaration. Silently
  // dropping the key would be worse: the operator would have written something
  // that looks obeyed and is not.
  if (gate.needs.deps !== undefined) {
    problems.push(
      `gates."${id}".needs.deps is registry-owned and cannot be declared. ` +
        `It states whether LISA's default prover for this gate runs without ` +
        `an install; a project naming its own "run:" always gets one.`
    );
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
 * Describe why a declared policy value does not fit its declared type.
 *
 * The vocabulary grew past `typeof` when the ruleset shape moved into config:
 * `bypass_actors` is an array of objects and `include_refs` an array of
 * strings, and `typeof` calls both of them "object", so the original check
 * would have accepted `"include_refs": {}` — a condition list that silently
 * matches no branch, which is a ruleset that protects nothing while reading as
 * configured. An expected value given as an ARRAY is a closed set of literals.
 * @param {string|readonly string[]} expected The schema entry.
 * @param {*} value The declared value.
 * @returns {string|null} The problem, or null when the value fits.
 */
function policyTypeProblem(expected, value) {
  if (Array.isArray(expected)) {
    return expected.includes(value)
      ? null
      : `must be one of ${expected.join(", ")}, got ${JSON.stringify(value)}`;
  }
  if (expected === "string[]" || expected === "object[]") {
    const member = expected === "string[]" ? "string" : "object";
    if (!Array.isArray(value)) {
      return `must be an array of ${member}s, got ${typeof value}`;
    }
    const bad = value.findIndex(entry =>
      member === "string"
        ? typeof entry !== "string"
        : !entry || typeof entry !== "object" || Array.isArray(entry)
    );
    return bad === -1
      ? null
      : `must be an array of ${member}s; entry ${bad} is ${JSON.stringify(value[bad])}`;
  }
  if (expected === "number") {
    return Number.isInteger(value) && value >= 0
      ? null
      : `must be a non-negative integer, got ${JSON.stringify(value)}`;
  }
  return typeof value === expected
    ? null
    : `must be a ${expected}, got ${typeof value}`;
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
      const wrong = policyTypeProblem(expected, value);
      if (wrong) {
        problems.push(`policy.${section}.${field} ${wrong}`);
      }
    }
  }
  return problems;
}

/**
 * Everything `validate` refuses a configuration for, and what it merely notes.
 *
 * ONE reading of legality, in one place, because there used to be two and they
 * disagreed. `validate` called a declaration BLOCKING while
 * `lisa-run-gates.mjs` executed that same declaration and reported it
 * `1 proved` — same tree, same config, opposite verdicts, and which answer an
 * operator got depended on which command they happened to run
 * (CodySwannGT/lisa#3042). The runner now calls this function and refuses what
 * it returns, rather than restating any of these rules. A rule added here
 * therefore binds both surfaces or neither, which is the only arrangement that
 * cannot drift back apart.
 *
 * `notes` is the other half of the same reading, and it is deliberately NOT
 * blocking: `no-runner-for-moment` and `outside-facade` are statements about
 * Lisa rather than about the project — a moment family with no runner yet, and
 * a property proved outside the façade — so letting either withhold
 * "configuration is valid" would make the verdict unreachable for projects
 * that have done nothing wrong.
 * @param {object} options Inputs.
 * @param {object} options.gates The gates block, runner already removed.
 * @param {object} [options.policy] The policy block.
 * @param {Record<string, string>|null} [options.scripts] The project's package
 *   scripts, or null when unknown.
 * @param {{moments?: string[], families?: string[]}} [options.executedMoments]
 *   Which moments this repository runs gates at, from `momentsExecutedBy`.
 * @returns {{blocking: string[], notes: Array<{gate: string, moment: string, level: string, verdict: string, detail: string}>}} The reading.
 */
export function configurationProblems({
  gates,
  policy,
  scripts,
  executedMoments = NOTHING_EXECUTED,
}) {
  const executors = classifyDeclaredExecutors({
    gates,
    scripts,
    executedMoments,
  });
  const unrunnable = executors.filter(finding =>
    BLOCKING_VERDICTS.includes(finding.verdict)
  );
  return {
    blocking: [
      ...validateGates(gates),
      ...validatePolicy(policy),
      ...unrunnable.map(
        finding =>
          `gates."${finding.gate}"."${finding.moment}" is declared ` +
          `"${finding.level}" and is UNRUNNABLE at that moment: ${finding.detail}`
      ),
    ],
    notes: executors.filter(finding => !unrunnable.includes(finding)),
  };
}

/**
 * The gates block as it reads at ONE moment: every gate keeps its gate-level
 * fields and its declaration at that moment, and loses every other moment.
 *
 * A projection of the INPUT, deliberately, rather than a moment-aware copy of
 * the rules. The runner has to know which of `validate`'s refusals bind at the
 * moment it was asked to run, and the obvious way to answer that — teach the
 * runner which problems are moment-scoped — puts a second implementation of
 * legality in the second file, which is the defect shape #3042 was filed
 * about. Narrowing the input and running the one validator over it asks the
 * same question with no second answer to drift from.
 *
 * A key that is not a moment at all is KEPT on purpose. `run` and `needs` are
 * what the declaration at this moment resolves through, and a typo like
 * `pull_request` runs at no moment whatsoever, so it can never be some other
 * moment's problem.
 *
 * What this does NOT narrow is a problem with the gate itself — an id Lisa does
 * not know, a `needs` block that is malformed, a gate that is really policy.
 * Those are moment-independent in `validate` too, and a projection cannot make
 * them otherwise: the gate survives the narrowing with its bad name intact.
 * @param {object} options Inputs.
 * @param {object} options.gates The gates block.
 * @param {string} options.moment The moment to narrow to.
 * @returns {object} The narrowed gates block.
 */
export function declarationsAt({ gates, moment }) {
  return Object.fromEntries(
    Object.entries(gates ?? {}).map(([id, gate]) => [
      id,
      gate === null || typeof gate !== "object" || Array.isArray(gate)
        ? gate
        : Object.fromEntries(
            Object.entries(gate).filter(
              ([key]) => key === moment || !isMomentKey(key)
            )
          ),
    ])
  );
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
 * @returns {Array<{id: string, level: string, mode: string, awaits: string|null, postedBy: number|null, declared: string|null, task: string|null, command: string|null, label: string, work: string|null, alias: {from: string, to: string}|null, evidence: {proof: string[], no_work: string[], on_hollow: string, wait_minutes: number|null, on_timeout: string}|null, callerChain: string[]|null, failureShape: string[]|null, mayRewrite: boolean, costly: boolean}>} Resolved provers, sorted by gate id. `declared` is the project's own `run:` — the PROVENANCE of the command, which `task` alone cannot carry because a project may spell its `run:` exactly as the registry default.
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
    // Read before the `off` branch so every resolved entry carries it. A
    // project's `run:` is a fact about the DECLARATION, not about the resolved
    // command, so an entry that runs nothing still has a truthful answer.
    const declared = entry.run ?? gate.run ?? null;
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
          postedBy: null,
          declared,
          task: null,
          command: null,
          label: REGISTRY[id]?.label ?? id,
          work: null,
          alias: null,
          evidence: null,
          callerChain: null,
          failureShape: entry[FAILURE_SHAPE_FIELD] ?? null,
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
    // A bare level declaration governs the façade that already proves this
    // property; it does not invent a package script. `declareOnly` is the
    // registry's explicit statement that the default task is descriptive and
    // is not shipped. When the matching hard-coded invocation exists, keep the
    // declaration visible (so contexts and requiredness still derive from it)
    // but let that invocation take its documented fallback path. An explicit
    // `run:` still replaces the fallback, and an unexpectedly present default
    // script still runs, so this cannot hide a prover the project supplied.
    const facadeBuiltIn =
      !entry.await &&
      !intercepts &&
      declared === null &&
      definition?.declareOnly !== undefined &&
      definition?.shippedAs === undefined &&
      scripts !== null &&
      typeof scripts === "object" &&
      !Object.hasOwn(scripts, task) &&
      HARDCODED_INVOCATIONS.some(
        invocation =>
          invocation.gate === id &&
          invocation.moment === moment &&
          invocation.facade === CONSULTS_THEN_FALLS_BACK &&
          invocation.command !== NO_FALLBACK_PROVER
      );

    resolved.push({
      id,
      level: entry.level,
      mode: entry.await
        ? "await"
        : intercepts
          ? "intercept"
          : facadeBuiltIn
            ? "builtin"
            : "run",
      awaits: entry.await ?? null,
      postedBy: entry.await ? (entry.posted_by ?? null) : null,
      // Reported unconditionally, unlike `task`/`command`/`alias`, which are
      // nulled for the modes that run nothing. Those describe what WOULD run;
      // this describes what the project SAID, and the project said it whatever
      // the mode. A consumer asking "did Lisa write this command" needs the
      // answer to survive every branch, or the question silently becomes "did
      // the resolved spelling happen to match", which is the defect this field
      // exists to close.
      declared,
      task: entry.await || intercepts || facadeBuiltIn ? null : task,
      command:
        entry.await || intercepts || facadeBuiltIn || !task
          ? null
          : `${runner} ${task}`,
      label: definition?.label ?? id,
      work: definition?.work ?? null,
      alias: entry.await || intercepts || facadeBuiltIn ? null : alias,
      evidence: entry.await ? mergeEvidence(entry.evidence) : null,
      // Carried RAW, exactly as declared. Normalising here would move the
      // blank-level refusal into a function whose caller swallows throws
      // (`resolveMergeMoment` in the drift comparator turns any throw into
      // "nothing resolved"), and a chain that fails silently is the failure
      // this whole area exists to make loud. `validateGates` refuses a
      // malformed chain at declaration time; `contextsFor` refuses it again at
      // derivation time.
      callerChain: entry.await ? null : (entry[CALLER_CHAIN_FIELD] ?? null),
      // Carried on every resolved entry, including an awaited one. It describes
      // what the project SAID about this moment's prover, and the project said
      // it whatever mode the moment resolves to — the same argument `declared`
      // makes one field up.
      failureShape: entry[FAILURE_SHAPE_FIELD] ?? null,
      mayRewrite: definition?.mayRewrite === true,
      costly: definition?.costly === true,
    });
  }
  // Rewriters first, then CHEAP before COSTLY, then alphabetical within each
  // group.
  //
  // `mayRewrite` leads because a verdict reached before a formatter runs
  // describes bytes that never ship.
  //
  // Cheap-before-costly is about what a failing run costs to learn. A gate
  // marked `costly` runs a test suite, a browser, or a load generator — minutes
  // each — and the ones that are not answer in seconds from files already on
  // disk. Alphabetical order alone put `traceability` behind every `test-*`
  // gate purely because `tra` sorts after `tes`, so a push refused for
  // something knowable from the commit range in milliseconds paid the whole
  // suite first and was told at the end. Nothing about the alphabet was a
  // statement about cost; this is.
  //
  // Ordering only. Every declared gate still runs, still reports its own
  // verdict, and `verdictFor` still runs a cheap gate after a failure and
  // stands only the costly ones down — so a run reports everything it can
  // afford to learn, sooner.
  return resolved.sort(
    (left, right) =>
      Number(right.mayRewrite) - Number(left.mayRewrite) ||
      Number(left.costly) - Number(right.costly) ||
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
    // PROJECT-DECLARED ONLY, and deliberately so. `tools` and `secrets` say
    // what a PROVER needs, and the prover is whatever the project named — Lisa
    // does not know it and must not guess on its behalf. The registry's own
    // `needs` carries `deps`, which is a claim about Lisa's default prover and
    // is read where that claim is used (`momentLegs`), not here.
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
 * The separator GitHub puts between the levels of a check-run name.
 *
 * Load-bearing, not cosmetic: a derived required context and a posted
 * check-run name are only comparable because both are this string joining the
 * same chain of names.
 */
export const CONTEXT_SEPARATOR = " / ";

/**
 * The caller chain the shipped wiring produces on the pull-request path.
 *
 * Measured, not assumed. A check-run's reported name is the `/`-joined chain
 * of the JOB names that reach it, outermost first — the top workflow's own
 * `name:` never appears. On CodySwannGT/lisa, `ci.yml`'s job `🔍 Quality
 * Checks` calls `quality.yml` directly, so pull request #3129's head
 * `b1307c42` posted `🔍 Quality Checks / 🧹 Lint`: ONE level. On the release
 * path `deploy.yml`'s job `Release` calls `release.yml`, whose job `🔍 Quality
 * Checks` calls the same `quality.yml`, so commit `6b44d6258` posted `Release
 * / 🔍 Quality Checks / 🧹 Lint`: TWO. Same jobs, same labels, different
 * names, because the chain above them is different.
 *
 * This default is the one-level form because that is what every ruleset in the
 * fleet is pinned to today — Lisa's own `quality checks` ruleset (13 required
 * contexts) and every shipped `github-rulesets/*.json` and
 * `create-only/.github/required-checks.json` seed carry the bare prefix. It
 * must not move without a coordinated ruleset migration: renaming a derived
 * context strands every consumer pinned to the old string at "Expected —
 * Waiting for status to be reported", forever.
 */
const DEFAULT_CALLER_CHAIN = Object.freeze(["🔍 Quality Checks"]);

/**
 * Normalise and validate the caller chain a derived context is prefixed with.
 *
 * Depth is not knowable from the gates block — it is a property of how the
 * CONSUMER wired its workflows, and it varies with that wiring: one hop from a
 * pull-request workflow, two through a release workflow, more for anyone who
 * nests further. So the chain is passed in rather than assumed, and
 * `workflowName` keeps accepting it as one `/`-joined string. That is why
 * nothing gained a flag: `--workflow "Release / 🔍 Quality Checks"` already
 * reaches here, and the long-standing single-level value normalises to itself.
 *
 * A blank level is refused rather than tolerated, because it fails in the
 * direction that is invisible. `"/ 🔍 Quality Checks"` would derive
 * `" / 🔍 Quality Checks / 🧹 Lint"` — a name no run posts. A required context
 * that never reports does not turn a pull request red; it holds it pending
 * forever, with no failing check to read and no log to open.
 * @param {object} options Chain inputs.
 * @param {string[]} [options.callerChain] Caller job names, outermost first.
 * @param {string} [options.workflowName] The same chain, `/`-joined.
 * @returns {string[]} The validated chain, outermost first.
 */
function callerChainFrom({ callerChain, workflowName }) {
  let raw = DEFAULT_CALLER_CHAIN;
  if (Array.isArray(callerChain)) {
    raw = callerChain;
  } else if (typeof workflowName === "string") {
    raw = workflowName.split("/");
  }
  const chain = raw.map(segment => String(segment).trim());
  if (chain.length === 0 || chain.some(segment => segment === "")) {
    throw new Error(
      "caller chain must be one or more non-empty job names, outermost first" +
        ` — got ${JSON.stringify(raw)}. A blank level derives a context no ` +
        "run ever posts, which holds every pull request at " +
        '"Expected — Waiting for status to be reported" forever.'
    );
  }
  return chain;
}

/**
 * Normalise the chain ONE declaration overrode the caller-wide chain with.
 *
 * Deliberately routed through `callerChainFrom` rather than used as written.
 * An override and a caller chain shape the same string, so they must be
 * normalised by the same code or the two would eventually disagree about
 * trimming, about the separator, and about what an empty level means. The
 * array form is the chain; the string form is the same chain `/`-joined, so
 * `"A / B"` and `["A", "B"]` are one declaration written two ways.
 *
 * It REPLACES the caller's chain rather than extending it. That is the whole
 * point: a project declares this precisely when the caller's chain does not
 * reach this gate's prover, so appending would derive a route that does not
 * exist. The label and blank-level refusal are still applied on top, so an
 * override cannot smuggle in a raw string that skips them. Registry
 * `previousLabels` are retirement evidence, not live contexts.
 * @param {string[]|string} value The declared chain.
 * @returns {string[]} The validated chain, outermost first.
 */
function declaredCallerChain(value) {
  return Array.isArray(value)
    ? callerChainFrom({ callerChain: value })
    : callerChainFrom({ workflowName: String(value) });
}

/**
 * The prefix one declaration's derived context carries, from its own chain.
 *
 * Exported for the SECOND derivation of the same string. `contextsFor` is not
 * the only thing that builds `<chain> / <label>` — the declaration-drift
 * comparator and the gate report each build it too, from the same registry
 * label, and three copies of the joining rule is three chances for a rename to
 * land in two of them. They call this instead, so a chain that is refused in
 * one place is refused in all three.
 *
 * Throws rather than falling back for the same reason `callerChainFrom` does:
 * a prefix nobody can determine is not a prefix to guess at, because the guess
 * fails silently. A caller that cannot afford to throw must report that it did
 * not compare, never that the comparison was clean.
 * @param {string[]|string} chain The declared chain, or one `/`-joined string.
 * @returns {string} The prefix, ready to join with a label.
 * @throws {Error} When the chain has an empty level.
 */
export function callerPrefix(chain) {
  return declaredCallerChain(chain).join(CONTEXT_SEPARATOR);
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
 *
 * The prefix is a CHAIN, not a name. See `callerChainFrom`: one level is what
 * the pull-request path posts and what every live ruleset pins, two is what
 * the release path posts, and passing the wrong depth is the permanent-pending
 * trap in either direction. `verifyContextsPosted` closes that loop against a
 * real run rather than leaving it to reasoning.
 *
 * One declaration may override that chain for itself with `caller_chain`, and
 * a declaration that does not carries on deriving exactly what it always did.
 * The override wins over the caller's chain for that gate alone, because it is
 * declared for precisely the case where the caller's chain does not reach the
 * gate's prover — a property proved by a workflow of the project's own rather
 * than through the quality facade. It changes only which chain is joined; the
 * label and blank-level refusal still apply, so an override cannot derive a
 * name by a different route than every other context. Registry
 * `previousLabels` are deliberately excluded; callers may request a temporary
 * overlap explicitly through the option of the same name.
 * @param {object} gates The gates block.
 * @param {object} [options] Context options.
 * @param {string} [options.moment] The moment to derive for.
 * @param {string} [options.workflowName] Caller chain, `/`-joined.
 * @param {string[]} [options.callerChain] Caller chain, outermost first.
 * @param {string[]} [options.previousLabels] Previous labels a caller proves
 * still have a live producer during an explicit overlap window.
 * @param {"run"|"await"} [options.mode] Limit the result to workflow-posted
 * contexts (`run`, including intercepted gates) or external awaited signals.
 * @returns {string[]} Sorted, de-duplicated contexts.
 */
export function contextsFor(gates, options = {}) {
  const {
    moment = PULL_REQUEST,
    workflowName,
    callerChain,
    previousLabels = [],
    mode,
  } = options;
  if (mode !== undefined && mode !== "run" && mode !== "await") {
    throw new Error(`Unknown context mode ${JSON.stringify(mode)}`);
  }
  const prefix = callerChainFrom({ callerChain, workflowName }).join(
    CONTEXT_SEPARATOR
  );

  const contexts = resolveMoment({ gates, moment })
    .filter(gate => gate.level === "required")
    // A workflow ruleset owns every context Lisa or the project posts through
    // a job chain. Awaited signals belong to the generated base ruleset, where
    // their declaration can retain the external app pin. Intercepted gates are
    // included in `run`: like an ordinary run gate, their context is derived
    // from the workflow chain rather than from an external signal name.
    .filter(gate =>
      mode === undefined
        ? true
        : mode === "await"
          ? gate.mode === "await"
          : gate.mode !== "await"
    )
    // An awaited signal posts under its own name; a run job posts under the
    // chain of jobs that reach it.
    .map(gate => {
      if (gate.mode === "await") return gate.awaits;
      // The caller's chain, UNLESS this declaration named its own. A gate
      // proved outside the facade is not reached through the facade's callers,
      // so the caller-wide chain describes a route to it that does not exist.
      // Everything below this line is identical either way, which is what
      // keeps an override from becoming a second way to spell a context.
      const chain =
        gate.callerChain === null
          ? prefix
          : declaredCallerChain(gate.callerChain).join(CONTEXT_SEPARATOR);
      return `${chain}${CONTEXT_SEPARATOR}${gate.label}`;
    });

  // Explicitly requested overlap remains additive. This option answers a
  // different question from the registry field: the registry records a name
  // Lisa retired, while this option says a particular migration still has a
  // live producer for the previous string.
  if (mode !== "await") {
    for (const label of previousLabels) {
      contexts.push(`${prefix}${CONTEXT_SEPARATOR}${label}`);
    }
  }
  return [...new Set(contexts)].sort((a, b) => a.localeCompare(b));
}
/**
 * The contexts Lisa's own registry proves NOTHING will post any more.
 *
 * A required status check that never reports does not fail a pull request —
 * GitHub holds it at "Expected — Waiting for status to be reported", forever.
 * There is no red tick and no log, so a ruleset naming a context Lisa retired
 * red-walls every pull request in that repository and nothing says why. The
 * only cheap way to find one is to compare what a ruleset requires against
 * what a job can still post, and this is the "can still post" half.
 *
 * `previousLabels` is the ONLY evidence that makes the claim provable rather
 * than inferred. A context absent from the derived set is not enough on its
 * own: a repository may legitimately require a status posted by a third-party
 * app or by a job its own CI defines, and a sweep that flagged every
 * externally-produced context would be noise an operator learns to ignore.
 * A `previousLabels` entry is different in kind — it is Lisa's record that
 * Lisa renamed its own job, so Lisa knows with certainty that no run will ever
 * post the old name again.
 *
 * A retired label some OTHER gate has since adopted as its current label is
 * dropped: that string is posted again, by a different job, so requiring it is
 * not a red-wall. The guard is why this reads the whole registry rather than
 * one entry's field.
 * Every entry carries the retired label and the replacement label BARE, next
 * to the `/`-joined contexts built from the default chain. A consumer holding a
 * live ruleset cannot assume that chain: a check run's reported name is the
 * `/`-joined chain of the JOB names reaching it, and the depth varies with
 * nesting — one level on the pull-request path, two on the release path, where
 * the same gate posts `Release / <quality workflow> / <label>`. Such a
 * consumer matches the retired label as the FINAL context segment and rebuilds
 * the replacement
 * against the chain it actually found, which is what `label` and
 * `replacementLabel` are for. `context` and `replacement` remain the
 * default-chain rendering, for a caller that has no live ruleset to match.
 * @param {object} [options] Context options.
 * @param {string} [options.workflowName] Caller chain, `/`-joined.
 * @param {string[]} [options.callerChain] Caller chain, outermost first.
 * @returns {{context: string, gate: string, label: string, replacement: string,
 *   replacementLabel: string}[]} Retired contexts, sorted by context.
 */
export function retiredContexts(options = {}) {
  const { workflowName, callerChain } = options;
  const prefix = callerChainFrom({ callerChain, workflowName }).join(
    CONTEXT_SEPARATOR
  );
  const live = new Set(
    Object.values(REGISTRY).map(definition => definition.label)
  );
  const retired = Object.entries(REGISTRY).flatMap(([gate, definition]) =>
    (definition.previousLabels ?? [])
      .filter(label => !live.has(label))
      .map(label => ({
        context: `${prefix}${CONTEXT_SEPARATOR}${label}`,
        gate,
        label,
        replacement: `${prefix}${CONTEXT_SEPARATOR}${definition.label}`,
        replacementLabel: definition.label,
      }))
  );
  return retired.sort((a, b) => a.context.localeCompare(b.context));
}

/**
 * Why a derived context list could not be reported clear.
 *
 * `NEVER_POSTED` is the trap this vocabulary exists for; the two vacuous
 * reasons exist because without them an empty comparison is indistinguishable
 * from a passing one.
 */
export const CONTEXT_VERDICTS = Object.freeze({
  NEVER_POSTED: "never-posted",
  VACUOUS_DERIVED: "vacuous-derived",
  VACUOUS_POSTED: "vacuous-posted",
});

/**
 * The caller chains a real run actually posted, read off its check-run names.
 *
 * This is how the depth stops being an assumption. Rather than reasoning about
 * YAML, hand a completed run's check-run names and the gate labels in play,
 * and each name that ends in a known label yields the chain that produced it —
 * `["🔍 Quality Checks"]` from a pull-request run, `["Release", "🔍 Quality
 * Checks"]` from the release run of the same commit. Feed the answer back in
 * as `callerChain` and the derivation matches reality by construction.
 * @param {string[]} [postedNames] Check-run names a completed run posted.
 * @param {string[]} [labels] Gate labels those runs are named for.
 * @returns {string[][]} Distinct chains, shallowest first.
 */
export function postedCallerChains(postedNames = [], labels = []) {
  const chains = new Map();
  for (const name of postedNames) {
    for (const label of labels) {
      const suffix = `${CONTEXT_SEPARATOR}${label}`;
      if (!name.endsWith(suffix)) continue;
      const prefix = name.slice(0, -suffix.length);
      if (prefix === "") continue;
      chains.set(prefix, prefix.split(CONTEXT_SEPARATOR));
    }
  }
  return [...chains.values()].sort(
    (left, right) =>
      left.length - right.length ||
      left.join(CONTEXT_SEPARATOR).localeCompare(right.join(CONTEXT_SEPARATOR))
  );
}

/**
 * Prove every derived required context is a name a real run actually posted.
 *
 * The whole point of the exercise. A required context nothing posts is not a
 * failure anyone can see: GitHub holds the pull request at "Expected — Waiting
 * for status to be reported" indefinitely, with no red tick to chase and no log
 * to read. Deriving one level too few strands a nested consumer there; deriving
 * one too many strands everybody pinned to the current string. Reasoning about
 * which is right is exactly what got this wrong, so this compares against what
 * a run posted instead.
 *
 * Both vacuous arms fail rather than pass, and that is deliberate. An empty
 * derived set and a fully-matched one produce the same "nothing missing", and
 * an empty posted set makes every derived name look absent OR present
 * depending on which way you write the loop. Neither is evidence, so neither
 * reports clear.
 * @param {object} [options] Comparison inputs.
 * @param {string[]} [options.derived] Contexts `contextsFor` derived.
 * @param {string[]} [options.posted] Check-run names a completed run posted.
 * @returns {{ok: boolean, missing: string[], verdict: string|null, reason: string|null}} The verdict.
 */
export function verifyContextsPosted({ derived = [], posted = [] } = {}) {
  if (derived.length === 0) {
    return {
      ok: false,
      missing: [],
      verdict: CONTEXT_VERDICTS.VACUOUS_DERIVED,
      reason:
        "no required context was derived, so nothing was compared. An empty " +
        "derived set reports the same all-clear as a fully-matched one; name " +
        "the moment and the gates block that were meant to produce contexts.",
    };
  }
  if (posted.length === 0) {
    return {
      ok: false,
      missing: [...derived],
      verdict: CONTEXT_VERDICTS.VACUOUS_POSTED,
      reason:
        "no check-run names were supplied, so nothing could be compared " +
        `against the ${derived.length} derived context(s). Read them off a ` +
        "completed run: gh api repos/OWNER/NAME/commits/SHA/check-runs " +
        "--paginate --slurp, unioned with the commit statuses from " +
        "repos/OWNER/NAME/commits/SHA/status — a required context can be " +
        "either surface.",
    };
  }
  const seen = new Set(posted);
  const missing = derived
    .filter(context => !seen.has(context))
    .sort((left, right) => left.localeCompare(right));
  if (missing.length === 0) {
    return { ok: true, missing, verdict: null, reason: null };
  }
  return {
    ok: false,
    missing,
    verdict: CONTEXT_VERDICTS.NEVER_POSTED,
    reason:
      `${missing.length} derived context(s) name no check run this run ` +
      "posted. Requiring one holds every pull request pending forever. Check " +
      "the caller chain first: the depth is the number of reusable-workflow " +
      "hops above the job, and it differs between the pull-request and " +
      "release paths.",
  };
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
 * Print the properties nothing in this project's config governs.
 *
 * Report only, never a status. Making an absent declaration fatal is the last
 * step of #2838's ordering and it lands behind an opt-in; here it is the
 * inventory that makes the gap measurable per repository in the meantime.
 * @param {object} gates The gates block.
 */
function reportUngoverned(gates) {
  const findings = ungovernedProperties({ gates });
  if (findings.length === 0) return;
  console.log(
    `${findings.length} propert${findings.length === 1 ? "y is" : "ies are"} ` +
      `proved by a built-in nothing declares:`
  );
  for (const finding of findings) {
    const where = finding.job
      ? `${finding.artifact} (job ${finding.job})`
      : finding.artifact;
    const takeover = finding.declaration
      ? ` Take it over with ${finding.declaration}.`
      : "";
    console.log(
      `  UNGOVERNED at ${finding.moment}: ${finding.gate} — ${where} runs ` +
        `"${finding.command}" and nothing declares it. ${finding.reason}${takeover}`
    );
  }
  console.log("");
}

/**
 * Derive the contexts both `contexts` and `verify-contexts` answer about.
 *
 * One function so the names being VERIFIED are byte-for-byte the names being
 * REQUIRED. Two call sites deriving separately is how a verifier ends up
 * proving something other than what shipped.
 *
 * `--workflow` takes the whole caller chain, `/`-joined, because that is what
 * GitHub names a check run: `--workflow "🔍 Quality Checks"` for the
 * pull-request path, `--workflow "Release / 🔍 Quality Checks"` for the
 * release path. Nothing needed a new flag; the old single-level value is the
 * one-element chain and derives exactly what it always did.
 * @param {object} gates The gates block.
 * @param {(name: string) => string|null} flag CLI flag reader.
 * @returns {string[]} Derived contexts.
 */
function cliContexts(gates, flag) {
  return contextsFor(gates, {
    moment: flag("moment") ?? PULL_REQUEST,
    workflowName:
      flag("workflow") ?? DEFAULT_CALLER_CHAIN.join(CONTEXT_SEPARATOR),
    previousLabels: (flag("previous") ?? "")
      .split(",")
      .map(entry => entry.trim())
      .filter(Boolean),
    mode: flag("mode") ?? undefined,
  });
}

/**
 * Read the names a completed run posted, from one or more evidence files.
 *
 * GitHub posts a required context from TWO surfaces and a branch ruleset
 * cannot tell them apart: a check run (`.../check-runs`, `.name`) and a commit
 * status (`.../status`, `.statuses[].context`). CodeRabbit is a status, so a
 * verifier that reads only check runs reports it never-posted and sends
 * whoever reads that on a hunt for a naming bug that is not there. Both shapes
 * are accepted, and `--posted` takes a comma-separated list so the two can be
 * unioned:
 *
 * ```
 * gh api repos/OWNER/NAME/commits/SHA/check-runs --paginate --slurp > runs.json
 * gh api repos/OWNER/NAME/commits/SHA/status > statuses.json
 * lisa-gates.mjs verify-contexts --posted=runs.json,statuses.json
 * ```
 * @param {string|null} source Comma-separated file paths, or `-` for stdin.
 * @returns {string[]} Posted names, unioned across the sources.
 */
function readPostedNames(source) {
  const sources = (source ?? "")
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean);
  if (sources.length === 0) {
    throw new Error(
      "verify-contexts requires --posted=<file|->[,<file>] naming what a " +
        "completed run posted: gh api repos/OWNER/NAME/commits/SHA/check-runs " +
        "--paginate --slurp > runs.json, and gh api " +
        "repos/OWNER/NAME/commits/SHA/status > statuses.json for the commit " +
        "statuses a check-runs read alone would miss."
    );
  }
  const names = new Set();
  for (const entry of sources) {
    const parsed = JSON.parse(readFileSync(entry === "-" ? 0 : entry, "utf8"));
    for (const payload of Array.isArray(parsed) ? parsed : [parsed]) {
      if (typeof payload === "string") {
        names.add(payload);
        continue;
      }
      for (const run of payload.check_runs ?? []) names.add(run.name);
      for (const status of payload.statuses ?? []) names.add(status.context);
    }
  }
  return [...names];
}

/* ─── Which Lisa produced this report ───────────────────────────────────── */

/**
 * The package whose version answers "which Lisa is installed here".
 *
 * Named once. `registryVersion()` resolves it and then checks the manifest it
 * lands on carries this exact name, and the two must not be able to disagree —
 * a resolution checked against a different literal is a version attached to
 * whatever package happened to answer.
 */
const LISA_PACKAGE = "@codyswann/lisa";

/**
 * What an unestablished identity field renders as.
 *
 * A word rather than an empty string, and never a fallback value. An operator
 * comparing two gate reports has to be able to tell "this ran a Lisa whose
 * version could not be resolved" from "this report has no version field at
 * all", and a blank renders as the second. Guessing renders as neither: the
 * host application's version in this slot is the specific failure
 * `registryVersion()` returns null to avoid.
 */
export const IDENTITY_UNKNOWN = "unknown";

/**
 * The shipped enforcement artifacts whose COPY decides a verdict.
 *
 * A workflow ref answers "which wrapper ran". It does not answer "which copy
 * of the checked-in script did that wrapper execute", and when the enforcement
 * is a file living in the consuming repository those are independent facts —
 * the second one is the one that produces the verdict. Four live copies of one
 * enforcement script have been observed at once (a repository's default
 * branch, a pull request's head, an installed release, and upstream), two of
 * them sharing a version string, so the identity emitted here is a digest of
 * the bytes rather than a declared version.
 */
const IDENTITY_ARTIFACTS = Object.freeze([
  "lisa-gates.mjs",
  "lisa-run-gates.mjs",
]);

/** The directory the executing copy of this registry lives in. */
const SCRIPTS_DIRECTORY = dirname(fileURLToPath(import.meta.url));

/**
 * The `@codyswann/lisa` version that owns the resolver behind this run.
 *
 * Resolve the package entry from this file, then walk to the owning manifest.
 * That works in both shipped layouts: inside the installed package and after
 * Lisa emits this registry into a host project's `scripts/` directory. Reading
 * a fixed relative path from the emitted copy escapes the package, while
 * reading `../package.json` confidently reports the host application's version.
 *
 * The package-name check stays load-bearing. It makes an unexpected resolution
 * return null rather than attaching another package's version to this registry.
 * @returns {string|null} The version, or null when it cannot be established.
 */
export function registryVersion() {
  try {
    const entry = createRequire(import.meta.url).resolve(LISA_PACKAGE);
    const root = parse(entry).root;
    let directory = dirname(entry);
    while (true) {
      const manifest = join(directory, PACKAGE_MANIFEST);
      if (existsSync(manifest)) {
        const parsed = JSON.parse(readFileSync(manifest, "utf8"));
        if (parsed.name === LISA_PACKAGE) return parsed.version ?? null;
      }
      if (directory === root) return null;
      directory = dirname(directory);
    }
  } catch {
    return null;
  }
}

/**
 * A content digest of one file, or null when its bytes cannot be read.
 *
 * Twelve hex characters, not sixty-four. The question this answers is "did
 * these two surfaces run the same bytes", which is a comparison between two
 * printed lines an operator reads side by side; a full digest is not more
 * comparable and is materially less readable. Null rather than a placeholder
 * string, so a caller can tell "absent" from a digest that happens to look odd.
 * @param {string} file Path to the artifact.
 * @returns {string|null} `sha256:<12 hex>`, or null when unreadable.
 */
export function artifactDigest(file) {
  try {
    const hex = createHash("sha256").update(readFileSync(file)).digest("hex");
    return `sha256:${hex.slice(0, 12)}`;
  } catch {
    return null;
  }
}

/**
 * WHICH COPY the digests above were taken from, rendered for a reader.
 *
 * A digest alone cannot be checked. Several copies of this registry can be on
 * one runner at once — the installed package under `node_modules`, the copy
 * `lisa apply` writes into `scripts/`, and this repository's own source tree —
 * and a stamp naming none of them is a hash a reader has no way to attribute.
 * The failure that made this load-bearing was a stamp resolved on a filesystem
 * the gates had not yet been installed onto: it named bytes that decided
 * nothing, on the run whose verdicts a reader was trying to date, and read as
 * the one fact that could not be mistaken.
 *
 * Relative to the working directory when it is inside it, because that is the
 * form the resolving shell prints and the form two reports can be compared in;
 * absolute otherwise, rather than a `../..` chain that names a location only
 * this process can resolve.
 * @param {string} directory The directory whose artifacts were digested.
 * @param {string} [cwd] The directory paths are rendered relative to.
 * @returns {string} The path, relative where that is meaningful.
 */
export function identityRegistryPath(directory, cwd = process.cwd()) {
  const rendered = relative(cwd, directory);
  if (rendered === "") return ".";
  if (isAbsolute(rendered) || rendered.split(/[\\/]/).includes(".."))
    return directory;
  return rendered;
}

/**
 * WHICH Lisa is running: the surface, the version, the ref, and the bytes.
 *
 * ONE COMPUTATION, SEVERAL RENDERINGS. A gate report from CI and a gate report
 * from a pre-push hook are claims about different code at different versions —
 * a consumer pins `@codyswann/lisa` for the local hook and calls the reusable
 * workflow at a floating ref for CI — and neither report used to say which. So
 * an observation about gate behaviour could not be dated, and a true warning
 * went stale with nothing in either repository able to notice.
 *
 * Every renderer below reads this object rather than resolving a version of
 * its own, because a second resolution path is a second answer that can
 * disagree with the first.
 * @param {object} [options] Inputs.
 * @param {Record<string,string|undefined>} [options.env] The environment.
 * @param {string} [options.directory] Where the enforcement scripts live.
 * @param {string} [options.cwd] What `registry_path` is rendered relative to.
 * @returns {object} The identity record.
 */
export function lisaIdentity({
  env = process.env,
  directory = SCRIPTS_DIRECTORY,
  cwd = process.cwd(),
} = {}) {
  return {
    surface: env.GITHUB_ACTIONS === "true" ? "ci" : "local",
    registry_version: registryVersion(),
    registry_path: identityRegistryPath(directory, cwd),
    workflow_ref: env.GITHUB_WORKFLOW_REF ?? null,
    workflow_sha: env.GITHUB_WORKFLOW_SHA ?? null,
    artifacts: Object.fromEntries(
      IDENTITY_ARTIFACTS.map(name => [
        name,
        artifactDigest(join(directory, name)),
      ])
    ),
  };
}

/**
 * The workflow half of an identity, rendered for a reader.
 * @param {object} identity As returned by `lisaIdentity`.
 * @returns {string} `<ref>@<sha>`, or `unknown` when nothing was established.
 */
function identityWorkflow(identity) {
  if (!identity.workflow_ref) return IDENTITY_UNKNOWN;
  return `${identity.workflow_ref}@${identity.workflow_sha ?? IDENTITY_UNKNOWN}`;
}

/**
 * One operator-readable line naming which Lisa produced a report.
 *
 * Cheap enough to appear in ORDINARY output, which is the property that
 * matters. A stamp only an adjudicator sees helps a reader who is already
 * suspicious; the observations that go stale unchallenged are the ones nobody
 * had a reason to check.
 * @param {object} identity As returned by `lisaIdentity`.
 * @returns {string} The line, with `unknown` wherever nothing was established.
 */
export function formatIdentityLine(identity) {
  return [
    `🔖 Lisa identity — surface=${identity.surface}`,
    `package=${LISA_PACKAGE}@${identity.registry_version ?? IDENTITY_UNKNOWN}`,
    `registry=${identity.registry_path ?? IDENTITY_UNKNOWN}`,
    `workflow=${identityWorkflow(identity)}`,
    ...Object.entries(identity.artifacts ?? {}).map(
      ([name, sha]) => `${name}=${sha ?? IDENTITY_UNKNOWN}`
    ),
  ].join(" · ");
}

/**
 * The same identity as a run-summary block.
 * @param {object} identity As returned by `lisaIdentity`.
 * @returns {string} Markdown for `$GITHUB_STEP_SUMMARY`.
 */
export function formatIdentityMarkdown(identity) {
  const version = identity.registry_version ?? IDENTITY_UNKNOWN;
  const rows = [
    ["surface", identity.surface],
    ["package", `${LISA_PACKAGE}@${version}`],
    ["registry path", identity.registry_path ?? IDENTITY_UNKNOWN],
    ["workflow ref", identity.workflow_ref ?? IDENTITY_UNKNOWN],
    ["workflow sha", identity.workflow_sha ?? IDENTITY_UNKNOWN],
    ...Object.entries(identity.artifacts ?? {}).map(([name, sha]) => [
      name,
      sha ?? IDENTITY_UNKNOWN,
    ]),
  ];
  return [
    "### 🔖 Which Lisa ran this",
    "",
    "| field | value |",
    "| --- | --- |",
    ...rows.map(([field, value]) => `| ${field} | \`${value}\` |`),
    "",
    "Every gate report on this run was produced by the Lisa above. A report " +
      "from the other surface — the local pre-push gate — prints the same " +
      "fields, so the two can be compared without either repository: equal " +
      "digests mean the same enforcement bytes ran, and a differing " +
      "`workflow sha` dates any claim made from this run.",
    "",
    "`registry path` names WHICH copy those digests were taken from. Several " +
      "live at once on one runner — the installed package, the copy `lisa " +
      "apply` writes into `scripts/`, and a repository's own source tree — so " +
      "a digest attributed to none of them cannot be checked against the copy " +
      "a gate job executed.",
  ].join("\n");
}

/**
 * Append a block to the run summary, or report that there was nowhere to.
 * @param {string} markdown The block to append.
 * @returns {boolean} Whether it was written.
 */
function appendRunSummary(markdown) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return false;
  try {
    appendFileSync(target, `${markdown}\n`);
    return true;
  } catch {
    return false;
  }
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
  // FIRST, AND BEFORE ANY GATE IS RESOLVED. This command answers "which Lisa
  // is about to run", so it must be answerable on a project whose declarations
  // are the thing under suspicion — including one whose config this registry
  // would refuse. It reads no gates and cannot fail on them.
  if (command === "identity") {
    const identity = lisaIdentity();
    if (rest.includes("--json")) {
      console.log(JSON.stringify(identity, null, 2));
      return;
    }
    const line = formatIdentityLine(identity);
    if (flag("format") === "github") {
      // The annotation AND the run summary, not one of them: an annotation is
      // what a reader sees beside a failing gate, and the summary is what
      // survives into a link somebody pastes into a ticket a week later. The
      // stale claim this exists to refute is always read later.
      console.log(`::notice title=Lisa identity::${line}`);
      appendRunSummary(formatIdentityMarkdown(identity));
      return;
    }
    console.log(line);
    return;
  }

  const { runner, gates, policy, config } = readGates();
  // Read once, here, so every subcommand answers about the same project. The
  // resolver is handed the result rather than reading the disk itself, which
  // keeps it a pure function of its inputs.
  const scripts = projectScripts();

  if (command === "validate") {
    // WHAT NOTHING GOVERNS — its own section, above the verdict and outside
    // the advisory list on purpose. These findings are not defects in what the
    // project declared; they are an inventory of what it has not declared, and
    // EVERY installed project has some. Folding them into `advisory` would
    // suppress "configuration is valid" for every project that ever runs this,
    // which turns the verdict into noise and trains an operator to ignore both.
    reportUngoverned(gates);
    // MEASURED, not assumed. Whether a deploy or continuous declaration has
    // anything able to run it is a fact about THIS repository's workflows, and
    // the answer changed the day a deploy façade shipped. Reading it here means
    // the report cannot go stale in the reassuring direction.
    //
    // The reading itself lives in `configurationProblems` rather than here,
    // because `lisa-run-gates.mjs` has to reach the same verdict and used not
    // to reach any (#3042). This command is now one of its two callers, not
    // the definition.
    const { blocking, notes } = configurationProblems({
      gates,
      policy,
      scripts,
      executedMoments: momentsExecutedBy(),
    });
    // The two non-blocking verdicts print HERE rather than as advisory
    // findings. An advisory finding suppresses "configuration is valid", and
    // both of these are statements about Lisa — a moment family with no runner
    // yet, and a property proved outside the façade — so letting them withhold
    // the verdict would make it unreachable for projects that have done
    // nothing wrong.
    for (const finding of notes) {
      console.log(
        `  NOTE gates."${finding.gate}"."${finding.moment}": ${finding.detail}`
      );
    }
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
            : gate.mode === "builtin"
              ? "(built in to the governing façade)"
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

  if (command === "quality-plan") {
    const moment = flag("moment");
    if (!moment)
      throw new Error("usage: lisa-gates.mjs quality-plan --moment=<moment>");
    console.log(JSON.stringify(qualityJobPlan({ gates, moment })));
    return;
  }

  if (command === "legs") {
    const moment = flag("moment");
    if (!moment)
      throw new Error("usage: lisa-gates.mjs legs --moment=<moment> [--json]");
    const legs = momentLegs({ gates, moment, runner, scripts });
    if (rest.includes("--json")) {
      // ONE LINE, deliberately. This is read by `fromJSON()` in a workflow
      // through a job output, and a job output is a single line — a
      // pretty-printed array would arrive truncated at its first newline and
      // `fromJSON` would fail on a fragment, which reads as a malformed
      // registry rather than as a formatting choice made here.
      console.log(JSON.stringify(legs));
      return;
    }
    for (const leg of legs) {
      const how =
        leg.action === "run"
          ? `${leg.runner} ${leg.task}`
          : leg.action === "report"
            ? "(declared off — the leg reports and passes)"
            : "(NO PROVER — the leg reports NOT PROVED and fails)";
      console.log(
        `${leg.level.padEnd(9)} ${leg.gate.padEnd(28)} ${leg.label.padEnd(30)} ${how}`
      );
    }
    console.log(`\n${legs.length} leg(s) at ${moment}.`);
    return;
  }

  if (command === "needs") {
    const moment = flag("moment") ?? SESSION_START;
    console.log(JSON.stringify(needsAt({ gates, moment }), null, 2));
    return;
  }

  if (command === "contexts") {
    console.log(JSON.stringify(cliContexts(gates, flag), null, 2));
    return;
  }

  if (command === "retired-contexts") {
    // The machine-readable retirement list #3067 asked for. It answers about
    // the SHIPPED registry, not about this project's declarations, so it is
    // deliberately not filtered by `gates`: a repository whose ruleset still
    // requires a retired context is red-walled whether or not it declares the
    // gate that used to post it, and filtering on the declaration would hide
    // exactly the repositories that have already turned the gate off.
    console.log(
      JSON.stringify(
        retiredContexts({
          workflowName:
            flag("workflow") ?? DEFAULT_CALLER_CHAIN.join(CONTEXT_SEPARATOR),
        }),
        null,
        2
      )
    );
    return;
  }

  if (command === "verify-contexts") {
    const result = verifyContextsPosted({
      derived: cliContexts(gates, flag),
      posted: readPostedNames(flag("posted")),
    });
    if (result.ok) {
      console.log("every derived required context was posted by that run.");
      return;
    }
    const listed = result.missing.length
      ? `\n  missing: ${result.missing.join("\n  missing: ")}`
      : "";
    throw new Error(`${result.verdict}: ${result.reason}${listed}`);
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

  if (command === "inventory") {
    // Deliberately NOT gated on reading .lisa.config.json. This answers "what
    // does Lisa run with a command written into the artifact", which is a
    // property of the shipped templates and has the same answer in a
    // repository that has declared nothing — the population it exists to
    // describe.
    const filtered = hardcodedAt({
      moment: flag("moment") ?? undefined,
      surface: flag("surface") ?? undefined,
      gate: flag("gate") ?? undefined,
    });
    if (rest.includes("--json")) {
      console.log(
        JSON.stringify(
          filtered.map(entry => ({
            ...entry,
            declarable: isDeclarableAt(entry.gate, entry.moment),
          })),
          null,
          2
        )
      );
      return;
    }
    for (const entry of filtered) {
      const declarable = isDeclarableAt(entry.gate, entry.moment)
        ? ""
        : "  [NOT DECLARABLE AT THIS MOMENT]";
      console.log(
        `${entry.facade.padEnd(26)} ${entry.moment.padEnd(13)} ${entry.gate.padEnd(28)} ${entry.command}${declarable}`
      );
      console.log(`${" ".repeat(26)} ${entry.artifact}`);
    }
    console.log(`\n${filtered.length} hardcoded invocation(s).`);
    return;
  }

  if (command === "unconfigured") {
    const moment = flag("moment");
    if (!moment)
      throw new Error(
        "usage: lisa-gates.mjs unconfigured --moment=<moment> [--gate=<id>] [--surface=<surface>] [--json] [--format=github]"
      );
    const findings = unconfiguredAt({
      gates,
      moment,
      gate: flag("gate") ?? undefined,
      surface: flag("surface") ?? undefined,
    });
    if (rest.includes("--json")) {
      console.log(JSON.stringify(findings, null, 2));
      return;
    }
    // REPORT ONLY, ALWAYS EXIT 0. This is the cheap half of the fix and it is
    // deliberately behaviour-neutral: it ships to a fleet where essentially
    // every project would be reported, and a reporter that could fail a push
    // would be a new gate nobody declared. Making an absent declaration a hard
    // failure is the LAST step, after seeding guarantees one exists.
    for (const finding of findings) {
      const where = finding.job
        ? `${finding.artifact} (job ${finding.job})`
        : finding.artifact;
      if (flag("format") === "github") {
        const takeover = finding.declaration
          ? ` Take it over with ${finding.declaration}.`
          : "";
        console.log(
          `::warning::${finding.gate} is UNCONFIGURED at ${moment}. The built-in runs: ${finding.command}. ${finding.reason}${takeover}`
        );
        continue;
      }
      console.log(
        `⚠️  ${finding.gate} is UNCONFIGURED at ${moment} — nothing in .lisa.config.json governs it.`
      );
      console.log(`   built-in: ${finding.command}`);
      console.log(`   from:     ${where}`);
      console.log(`   why:      ${finding.reason}`);
      if (finding.declaration) {
        console.log(`   declare:  ${finding.declaration}`);
      }
    }
    return;
  }

  if (command === "seed") {
    const scripts = readScripts();
    const seedRunner = flag("runner") ?? runner;
    const result = seedGates({ gates, scripts, runner: seedRunner });
    if (rest.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    for (const entry of result.seeded) {
      console.log(
        `+ ${entry.gate.padEnd(28)} ${entry.moment.padEnd(13)} ${entry.run ?? "(registry default)"}`
      );
    }
    for (const entry of result.skipped) {
      console.log(
        `- ${entry.gate.padEnd(28)} ${entry.moment.padEnd(13)} ${entry.reason}`
      );
    }
    console.log(
      `\n${result.seeded.length} declaration(s) would be seeded, ${result.skipped.length} skipped.`
    );
    console.log(
      "Merge the block below into .lisa.config.json, then re-run `validate`:"
    );
    console.log(JSON.stringify({ gates: result.gates }, null, 2));
    return;
  }

  // ─── reuse-plan (#3013) ────────────────────────────────────────────────
  // Answers ONE question: which gates at this moment may stand down because a
  // VERIFIED envelope already proves them for this exact tree under this exact
  // contract. Every ambiguity — an unreadable file, a mismatched dimension, a
  // gate nobody classified — resolves to `run`, so the worst this command can
  // do is describe today's behaviour. It never exits non-zero on a refusal: an
  // optimization that can redden a release is not an optimization.
  if (command === "reuse-plan") {
    const moment = flag("moment");
    if (!moment) {
      throw new Error(
        "usage: lisa-gates.mjs reuse-plan --moment=<moment> --evidence=<file> --repository=<o/r> --tree=<sha> [--commit=<sha>] [--workflow-ref=<ref>] [--workflow-sha=<sha>] [--inputs-digest=<sha256:…>] [--registry-version=<v>] [--json]"
      );
    }
    const evidencePath = flag("evidence");
    const read = evidencePath
      ? readEvidenceFile(evidencePath)
      : {
          envelope: null,
          reason: "no --evidence path was given, so nothing was verified",
          refusal: REUSE_REASON.UNAVAILABLE,
        };
    const plan = reusePlan({
      envelope: read.envelope,
      gates,
      moment,
      observed: {
        commit: flag("commit") ?? null,
        gatesDigest: planDigest({ gates, moment, runner, scripts }),
        inputsDigest: flag("inputs-digest") ?? null,
        registryVersion: flag("registry-version") ?? null,
        repository: flag("repository") ?? null,
        tree: flag("tree") ?? null,
        workflowRef: flag("workflow-ref") ?? null,
        workflowSha: flag("workflow-sha") ?? null,
      },
      refusal: read.refusal
        ? { detail: read.reason, reason: read.refusal }
        : null,
      runner,
      scripts,
    });
    if (rest.includes("--json")) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    console.log(`reuse verdict: ${plan.verdict}`);
    if (plan.detail) console.log(`  ${plan.detail}`);
    for (const entry of plan.decisions) {
      const proof = entry.proof ? `  ← ${entry.proof}` : "";
      console.log(
        `  ${entry.decision === "reuse" ? "♻️ " : "▶️ "} ${entry.gate.padEnd(28)} ${entry.reason}${proof}`
      );
    }
    const reused = plan.decisions.filter(
      entry => entry.decision === "reuse"
    ).length;
    console.log(
      `\n${reused} of ${plan.decisions.length} gate(s) at ${moment} are proved by prior evidence.`
    );
    return;
  }

  if (command === "audit-config") {
    const findings = auditConfigKeys(config);
    for (const finding of findings) console.error(`  ${finding.message}`);
    console.log(`${findings.length} config key finding(s).`);
    return;
  }

  throw new Error(
    "usage: lisa-gates.mjs validate|list|legs|quality-plan|reuse-plan|needs|contexts|retired-contexts|verify-contexts|skip-jobs|audit-config|inventory|unconfigured|identity|seed"
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
