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
 * `passWithNoTests: true` ships in five stack configs, so a unit-test gate can
 * report green having run zero tests. That is the `run` form, caught by a work
 * count. No description is involved and no vendor is at fault.
 *
 * The response is configurable, with one exception. You may configure whether
 * to stop; you may not configure it into having been proved. A hollow result is
 * recorded as unproved in every mode, or `on_hollow: report` becomes a way to
 * launder an unreviewed merge.
 * @module lisa-gates
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Enforcement levels a moment may carry. */
export const LEVELS = ["required", "optional", "off"];

/** What to do when a gate reports success without evidence of work. */
export const HOLLOW_RESPONSES = ["report", "wait", "block"];

/** Fixed moments. Two more families take an environment suffix. */
export const MOMENTS = [
  "session-start",
  "pre-tool",
  "commit",
  "push",
  "pull-request",
];

/** Moment families that take an `:<environment>` suffix. */
export const MOMENT_FAMILIES = ["pre-deploy", "post-deploy"];

/** Prefix marking a gate, or a config key, that this project invented. */
export const CUSTOM_PREFIX = "x-";

const COMMIT_ONWARD = [
  "commit",
  "push",
  "pull-request",
  "pre-deploy",
  "post-deploy",
];
const PUSH_ONWARD = ["push", "pull-request", "pre-deploy", "post-deploy"];
const PR_ONWARD = ["pull-request", "pre-deploy", "post-deploy"];
const PR_ONLY = ["pull-request"];
const DEPLOY_ONLY = ["pre-deploy", "post-deploy"];
const SESSION_ONWARD = ["session-start", ...COMMIT_ONWARD];

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
 */
export const REGISTRY = Object.freeze({
  "code-style": {
    label: "🧹 Lint",
    summary: "Code conforms to the project's lint rules.",
    task: "lint",
    moments: COMMIT_ONWARD,
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
  },
  "test-integration": {
    label: "🧪 Run Integration Tests",
    summary: "The integration suite passes.",
    task: "test:integration",
    moments: PUSH_ONWARD,
    work: "tests run",
  },
  "test-meaningfulness": {
    label: "🧬 Mutation Testing Gate",
    summary: "Tests fail when the code they cover is wrong.",
    task: "test:mutation",
    moments: PR_ONWARD,
    work: "mutants generated",
  },
  "coverage-adequacy": {
    label: "✅ Verification Coverage",
    summary: "What must be proved is covered by something that runs.",
    task: "test:coverage",
    moments: PUSH_ONWARD,
    work: "files measured",
  },
  "e2e-browser": {
    label: "🎭 Playwright E2E Tests",
    summary: "Browser journeys pass end to end.",
    task: "test:e2e",
    moments: PR_ONWARD,
    work: "specs run",
  },
  "e2e-native": {
    label: "📱 Maestro Native E2E",
    summary: "Native device journeys pass end to end.",
    task: "test:e2e:native",
    moments: PR_ONWARD,
    work: "flows run",
  },
  "structural-rules": {
    label: "🔎 AST Grep Scan",
    summary: "Structural rules lint cannot express are respected.",
    task: "lint:structural",
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
    moments: PUSH_ONWARD,
  },
  "credential-leakage": {
    label: "🔐 Credential Leakage",
    summary: "No secret enters the repository, an artifact, or a log.",
    task: "security:check-for-leaks",
    moments: COMMIT_ONWARD,
  },
  "dependency-vulnerability": {
    label: "🔒 Security Scan",
    summary: "No known high or critical advisory in shipped dependencies.",
    task: "security:audit",
    moments: PUSH_ONWARD,
    work: "manifests scanned",
  },
  "static-security": {
    label: "🔍 Static Security Analysis",
    summary: "Static analysis finds no security defect.",
    task: "security:sast",
    moments: PR_ONWARD,
    work: "files analysed",
  },
  "runtime-web-vulnerability": {
    label: "🕷️ DAST Baseline",
    summary: "The running application passes a baseline dynamic scan.",
    task: "security:dast",
    moments: DEPLOY_ONLY,
    work: "URLs scanned",
  },
  "license-compliance": {
    label: "📜 Licence Check",
    summary: "Every dependency licence is permitted.",
    task: "security:licenses",
    moments: PR_ONWARD,
  },
  "code-review": {
    label: "👁️ Code Review",
    summary: "The change was reviewed by something that read it.",
    task: "review:local",
    moments: ["push", "pull-request"],
  },
  "performance-budget": {
    label: "⚡ Performance Budget",
    summary: "Pages stay inside their performance budget.",
    task: "perf:check",
    moments: DEPLOY_ONLY,
    work: "pages measured",
  },
  "load-capacity": {
    label: "📈 Load Capacity",
    summary: "The service holds up under its expected load.",
    task: "perf:load",
    moments: DEPLOY_ONLY,
    work: "requests issued",
  },
  accessibility: {
    label: "♿ Accessibility",
    summary: "Pages meet the declared accessibility standard.",
    task: "a11y:check",
    moments: DEPLOY_ONLY,
    work: "pages audited",
  },
  traceability: {
    label: "🔗 Work-Item Traceability",
    summary: "Every change is bound to a live tracker item.",
    task: "check:work-item",
    moments: PR_ONLY,
  },
  "commit-conformance": {
    label: "📝 Commit Message",
    summary: "Commit messages follow the declared convention.",
    task: "check:commit-msg",
    moments: COMMIT_ONWARD,
  },
  "threshold-monotonicity": {
    label: "📐 Threshold Ratchet",
    summary: "Quality thresholds may tighten, never loosen.",
    task: "check:thresholds",
    moments: PUSH_ONWARD,
  },
  "artifact-freshness": {
    label: "🧾 Generated Artifacts",
    summary: "Generated files match the source they describe.",
    task: "check:artifacts",
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
    moments: COMMIT_ONWARD,
  },
  "credential-availability": {
    label: "🔑 Credential Readiness",
    summary: "Every credential the work needs resolves before work is claimed.",
    task: "readiness:secrets",
    moments: SESSION_ONWARD,
  },
  "tool-availability": {
    label: "🧰 Tooling Readiness",
    summary: "Every CLI the work needs is present at its required version.",
    task: "readiness:tools",
    moments: SESSION_ONWARD,
  },
});

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
 * Read the config, splitting the runner out of the gates block.
 * @param {string} [cwd] Directory to look in.
 * @returns {{runner: string, gates: object, policy: object, config: object}} Parsed config.
 */
export function readGates(cwd = process.cwd()) {
  const path = join(cwd, ".lisa.config.json");
  if (!existsSync(path)) {
    return { runner: "npm run", gates: {}, policy: {}, config: {} };
  }
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`.lisa.config.json is not readable: ${err.message}`);
  }
  const { runner = "npm run", ...gates } = config.gates ?? {};
  return { runner, gates, policy: config.policy ?? {}, config };
}

/**
 * Whether a moment string is one Lisa understands.
 * @param {string} moment Candidate moment.
 * @returns {boolean} True when well-formed.
 */
export function isMoment(moment) {
  if (MOMENTS.includes(moment)) return true;
  const [family, environment] = moment.split(":");
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
      `gates."${id}" is not a gate Lisa knows` +
        (near ? `. Did you mean "${near}"?` : "") +
        ` Prefix a gate of your own with "${CUSTOM_PREFIX}" — Lisa will run ` +
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
    if (!isMoment(moment)) continue;
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
    if (["commit", "push", "session-start", "pre-tool"].includes(moment)) {
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
        `policy."${section}" is not a policy section Lisa knows` +
          (near ? `. Did you mean "${near}"?` : "")
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
          `policy.${section}."${field}" is not a setting Lisa manages` +
            (near ? `. Did you mean "${near}"?` : "")
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
      message:
        `${key} is not a key Lisa reads` +
        (near ? `. Did you mean "${near}"?` : "") +
        ` Nothing consumes it, so whatever it was meant to configure is unset.`,
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
 * @returns {Array<{id: string, level: string, mode: string, awaits: string|null, task: string|null, command: string|null, label: string, work: string|null, evidence: {proof: string[], no_work: string[], on_hollow: string, wait_minutes: number|null, on_timeout: string}|null}>} Resolved provers, sorted by gate id.
 */
export function resolveMoment({ gates, moment, runner = "npm run" }) {
  const resolved = [];
  for (const [id, gate] of Object.entries(gates ?? {})) {
    const raw = gate?.[moment];
    if (raw === undefined) continue;
    const entry = typeof raw === "string" ? { level: raw } : raw;
    if (!entry?.level || entry.level === "off") continue;

    const definition = REGISTRY[id];
    const task = entry.run ?? gate.run ?? definition?.task ?? null;
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
      evidence: entry.await ? mergeEvidence(entry.evidence) : null,
    });
  }
  return resolved.sort((left, right) => left.id.localeCompare(right.id));
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
    moment = "pull-request",
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
 * CLI entry point.
 */
function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flag = name => {
    const hit = rest.find(arg => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const { runner, gates, policy, config } = readGates();

  if (command === "validate") {
    const blocking = [...validateGates(gates), ...validatePolicy(policy)];
    const advisory = auditConfigKeys(config).map(finding => finding.message);
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
    const resolved = resolveMoment({ gates, moment, runner });
    if (rest.includes("--json")) {
      console.log(JSON.stringify(resolved, null, 2));
      return;
    }
    for (const gate of resolved) {
      const how =
        gate.mode === "await"
          ? `await ${gate.awaits}`
          : (gate.command ?? "(intercepted by Lisa)");
      console.log(`${gate.level.padEnd(9)} ${gate.id.padEnd(28)} ${how}`);
    }
    return;
  }

  if (command === "needs") {
    const moment = flag("moment") ?? "session-start";
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
          moment: flag("moment") ?? "pull-request",
          workflowName: flag("workflow") ?? "🔍 Quality Checks",
          previousLabels,
        }),
        null,
        2
      )
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
    "usage: lisa-gates.mjs validate|list|needs|contexts|audit-config"
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
