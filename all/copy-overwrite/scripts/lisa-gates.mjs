#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * The gate registry: what Lisa guarantees, and where each guarantee is proved.
 *
 * A **gate is a property**, not a tool. `gitleaks` is not a gate — *credential
 * leakage* is the gate, and gitleaks is one way to prove it. Catalogued as tools,
 * the same guarantee appears three times under three names and no one can see
 * that a fourth is missing; catalogued as properties, the question "which
 * guarantees rest on a single mechanism" has an answer.
 *
 * That split is the whole design. **Lisa owns the vocabulary; the project owns
 * the implementation.** Lisa's workflows and hooks say "run the credential-leakage
 * gate"; the project says what that means by pointing it at one of its own task
 * names. A project swapping gitleaks for something else changes one line of its
 * own config and nothing in Lisa.
 *
 * ## Stages
 *
 * A gate declares where it is proved, and each stage carries an enforcement
 * level rather than a boolean:
 *
 * - `required` — blocks. The action does not happen.
 * - `optional` — runs and reports, never blocks.
 * - `off` — does not run. Also the meaning of an absent stage.
 *
 * The three-state vocabulary is deliberate and matches the readiness preflight:
 * a check that *could not run* must never be recorded as a check that *passed*,
 * and a check that merely reports must never be mistaken for one that gates.
 *
 * ## Why some gates cannot be facaded
 *
 * A few gates intercept an action *before* it happens — refusing `--no-verify`,
 * refusing a destructive command. Those cannot be a project script, because by
 * the time a script could run, the thing it was meant to prevent has already
 * run. They are marked `implementation: "lisa"`: the project may still say where
 * they are enforced, but not what implements them.
 * @module lisa-gates
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Enforcement levels a stage may carry, weakest last. */
export const LEVELS = ["required", "optional", "off"];

/** Agent hook events a gate may bind to. */
export const AGENT_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "SubagentStart",
  "Stop",
  "SessionEnd",
];

/** Prefix marking a gate this project invented. */
export const CUSTOM_PREFIX = "x-";

/**
 * Lisa's canonical gates.
 *
 * `label` is the CI job name, and it is load-bearing: a repository ruleset names
 * required checks by exact string, so this value is what a branch-protection
 * context is built from. Changing one is a fleet-wide rename — see
 * `contextsFor` and the alias window it supports.
 *
 * `implementation: "lisa"` marks a gate whose mechanism cannot be delegated;
 * everything else is proved by a project task named in config.
 */
export const REGISTRY = Object.freeze({
  "credential-leakage": {
    label: "🔐 Credential Leakage",
    summary: "No secret enters the repository, an artifact, or a log.",
    implementation: "project",
  },
  "credential-availability": {
    label: "🔑 Credential Readiness",
    summary: "Every credential the work needs resolves before work is claimed.",
    implementation: "project",
  },
  "tool-availability": {
    label: "🧰 Tooling Readiness",
    summary: "Every CLI the work needs is present at its required version.",
    implementation: "project",
  },
  "type-correctness": {
    label: "🔍 Type Check",
    summary: "The project compiles.",
    implementation: "project",
  },
  "test-correctness": {
    label: "🧪 Run Unit Tests",
    summary: "The test suite passes.",
    implementation: "project",
  },
  "test-meaningfulness": {
    label: "🧬 Mutation Testing Gate",
    summary: "Tests fail when the code they cover is wrong.",
    implementation: "project",
  },
  "coverage-adequacy": {
    label: "✅ Verification Coverage",
    summary:
      "The things that must be proved are covered by something that runs.",
    implementation: "project",
  },
  "code-style": {
    label: "🧹 Lint",
    summary: "Code conforms to the project's lint and format rules.",
    implementation: "project",
  },
  "structural-rules": {
    label: "🔎 AST Grep Scan",
    summary: "Structural rules lint cannot express are respected.",
    implementation: "project",
  },
  "dead-code": {
    label: "🗑️ Dead Code Detection",
    summary: "No unused exports or dependencies.",
    implementation: "project",
  },
  "dependency-vulnerability": {
    label: "🔒 Security Scan",
    summary: "No known high or critical advisory in shipped dependencies.",
    implementation: "project",
  },
  "static-security": {
    label: "🔍 SonarCloud SAST",
    summary: "Static analysis finds no security defect.",
    implementation: "project",
  },
  "runtime-web-vulnerability": {
    label: "🕷️ OWASP ZAP Baseline",
    summary: "The running application passes a baseline DAST scan.",
    implementation: "project",
  },
  "license-compliance": {
    label: "📜 FOSSA License Check",
    summary: "Every dependency licence is permitted.",
    implementation: "project",
  },
  traceability: {
    label: "🔗 Work-Item Traceability",
    summary: "Every change is bound to a live tracker item.",
    implementation: "project",
  },
  "commit-conformance": {
    label: "📝 Commit Message",
    summary: "Commit messages follow conventional commits.",
    implementation: "project",
  },
  "threshold-monotonicity": {
    label: "📐 Threshold Ratchet",
    summary: "Quality thresholds may tighten, never loosen.",
    implementation: "project",
  },
  "artifact-freshness": {
    label: "🧾 Generated Artifacts",
    summary: "Generated files match the source they describe.",
    implementation: "project",
  },
  "conflict-residue": {
    label: "🩹 Conflict Markers",
    summary: "No leftover merge-conflict markers in tracked files.",
    implementation: "project",
  },
  "version-duplication": {
    label: "🧮 Duplicate Versions",
    summary: "One declared version per dependency.",
    implementation: "project",
  },
  "performance-budget": {
    label: "⚡ Performance Budget",
    summary: "The application stays inside its performance budget.",
    implementation: "project",
  },
  "review-completion": {
    label: "👀 Review Completion",
    summary: "Every review thread is resolved before merge.",
    implementation: "lisa",
  },
  "branch-protection": {
    label: "🛡️ Branch Protection",
    summary: "No direct commits to an environment branch.",
    implementation: "lisa",
  },
  "verification-bypass": {
    label: "🚫 Verification Bypass",
    summary: "Verification hooks cannot be disabled.",
    implementation: "lisa",
  },
  "destructive-safety": {
    label: "☢️ Destructive Operations",
    summary: "Destructive commands are refused where they cannot be undone.",
    implementation: "lisa",
  },
  "instruction-integrity": {
    label: "📕 Instruction Files",
    summary: "Agents cannot rewrite their own instruction files.",
    implementation: "lisa",
  },
  "orchestration-conformance": {
    label: "🎯 Orchestration",
    summary: "Lifecycle flows follow the required orchestration.",
    implementation: "lisa",
  },
  "structured-data-handling": {
    label: "🧷 Structured Data",
    summary: "Structured formats are parsed with real parsers.",
    implementation: "lisa",
  },
});

/**
 * Gates a project's own routing makes mandatory.
 *
 * The same derivation the credential and tooling floors use, for the same
 * reason: a guarantee implied by configuration the project already wrote should
 * not depend on someone also remembering to enable it. A project that names a
 * tracker has said it wants work traceable to that tracker.
 * @param {object} config Parsed `.lisa.config.json` root.
 * @returns {Record<string, string>} Gate id to the reason it is implied.
 */
export function gateFloor(config = {}) {
  const floor = {};
  if (config.tracker) {
    floor.traceability = `tracker is "${config.tracker}"`;
  }
  if (config.secrets?.provider && config.secrets.provider !== "env") {
    floor["credential-availability"] =
      `secrets.provider is "${config.secrets.provider}"`;
  }
  return floor;
}

/**
 * Read the `gates` block, with the runner separated from the gates themselves.
 * @param {string} [cwd] Directory to look in.
 * @returns {{runner: string, gates: object, config: object}} Parsed block.
 */
export function readGates(cwd = process.cwd()) {
  const path = join(cwd, ".lisa.config.json");
  if (!existsSync(path)) return { runner: "npm run", gates: {}, config: {} };
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`.lisa.config.json is not readable: ${err.message}`);
  }
  const { runner = "npm run", ...gates } = config.gates ?? {};
  return { runner, gates, config };
}

/**
 * Validate a gates block, returning every problem rather than the first.
 *
 * An unknown gate id is an error and not a silent pass, because the failure it
 * prevents is invisible: a misspelled `credential-leakge` would read as an
 * enabled guarantee and run nothing at all. That is the same shape as every
 * other defect this subsystem exists to catch, so it fails loudly and suggests
 * the nearest real name.
 * @param {object} gates The gates block, runner already removed.
 * @returns {string[]} Problems, empty when valid.
 */
export function validateGates(gates) {
  const problems = [];
  for (const [id, gate] of Object.entries(gates ?? {})) {
    const known = Object.hasOwn(REGISTRY, id);
    const custom = id.startsWith(CUSTOM_PREFIX);

    if (!known && !custom) {
      const near = nearestGate(id);
      problems.push(
        `gates."${id}" is not a gate Lisa knows` +
          (near ? `. Did you mean "${near}"?` : "") +
          ` Prefix a gate of your own with "${CUSTOM_PREFIX}" — Lisa will run ` +
          `it without pretending to understand it.`
      );
      continue;
    }
    if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
      problems.push(`gates."${id}" must be an object`);
      continue;
    }
    if (known && REGISTRY[id].implementation === "lisa" && gate.run) {
      problems.push(
        `gates."${id}" declares run "${gate.run}", but this gate intercepts an ` +
          `action before it happens and cannot be delegated to a task — by the ` +
          `time a task could run, the thing it prevents has already run. ` +
          `Declare where it is enforced, not what implements it.`
      );
    }
    if (needsRun(id, gate) && !gate.run) {
      problems.push(
        `gates."${id}" is enabled somewhere but names no "run" task, so ` +
          `nothing would execute.`
      );
    }
    problems.push(...validateStages(id, gate));
  }
  return problems;
}

/**
 * Validate the stage map of one gate.
 * @param {string} id Gate id, for messages.
 * @param {object} gate The gate entry.
 * @returns {string[]} Problems.
 */
function validateStages(id, gate) {
  const problems = [];
  for (const stage of ["commit", "push"]) {
    if (gate[stage] !== undefined && !LEVELS.includes(gate[stage])) {
      problems.push(
        `gates."${id}".${stage} is "${gate[stage]}"; expected ${LEVELS.join(", ")}`
      );
    }
  }
  for (const [event, level] of Object.entries(gate.agent ?? {})) {
    if (!AGENT_EVENTS.includes(event)) {
      problems.push(
        `gates."${id}".agent has event "${event}"; known: ${AGENT_EVENTS.join(", ")}`
      );
    }
    if (!LEVELS.includes(level)) {
      problems.push(
        `gates."${id}".agent."${event}" is "${level}"; expected ${LEVELS.join(", ")}`
      );
    }
  }
  for (const [env, level] of Object.entries(gate.ci ?? {})) {
    if (!LEVELS.includes(level)) {
      problems.push(
        `gates."${id}".ci."${env}" is "${level}"; expected ${LEVELS.join(", ")}`
      );
    }
  }
  return problems;
}

/**
 * Whether a gate is enabled anywhere and therefore needs something to run.
 * @param {string} id Gate id.
 * @param {object} gate The gate entry.
 * @returns {boolean} True when some stage is not `off`.
 */
function needsRun(id, gate) {
  if (REGISTRY[id]?.implementation === "lisa") return false;
  const levels = [
    gate.commit,
    gate.push,
    ...Object.values(gate.agent ?? {}),
    ...Object.values(gate.ci ?? {}),
  ];
  return levels.some(level => level === "required" || level === "optional");
}

/**
 * The closest known gate id, for a did-you-mean suggestion.
 * @param {string} id The unrecognised id.
 * @returns {string|null} A near match, or null when nothing is close.
 */
function nearestGate(id) {
  let best = null;
  let bestScore = Infinity;
  for (const candidate of Object.keys(REGISTRY)) {
    const score = distance(id, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  // A third of the name may differ before a suggestion stops being helpful and
  // starts being a guess that sends the reader to the wrong gate.
  return bestScore <= Math.max(2, Math.floor(id.length / 3)) ? best : null;
}

/**
 * Levenshtein distance, iterative and allocation-light.
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
 * Resolve which gates run at one stage, and how strictly.
 *
 * The floor is unioned in so a guarantee implied by routing is enforced even
 * when the gates block never mentions it — but only where the project has
 * given it somewhere to run, because Lisa cannot invent a task name.
 * @param {object} options Resolution inputs.
 * @param {object} options.gates The gates block.
 * @param {string} options.stage `commit`, `push`, `agent:<Event>`, or `ci:<env>`.
 * @param {string} [options.runner] Task-runner prefix.
 * @returns {Array<{id: string, level: string, run: string|null, command: string|null, label: string}>} Resolved gates.
 */
export function resolveStage({ gates, stage, runner = "npm run" }) {
  const [kind, key] = stage.split(":");
  const resolved = [];

  for (const [id, gate] of Object.entries(gates ?? {})) {
    const level =
      kind === "agent"
        ? (gate.agent ?? {})[key]
        : kind === "ci"
          ? (gate.ci ?? {})[key]
          : gate[kind];
    if (!level || level === "off") continue;
    resolved.push({
      id,
      level,
      run: gate.run ?? null,
      command: gate.run ? `${runner} ${gate.run}` : null,
      label: REGISTRY[id]?.label ?? id,
    });
  }
  return resolved.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * The branch-protection contexts a gates block implies.
 *
 * This is the value that replaces a hand-transcribed snapshot. A repository
 * ruleset names required checks by exact string, and until now that list was
 * copied out of an admin console by hand, carried a 90-day expiry, and shipped
 * empty because Lisa could not know it. Derived from a declaration instead, the
 * transcription and its clock stop being necessary.
 *
 * `previousLabels` exists for the one dangerous moment. Downstream repositories
 * call the shared workflow unpinned, so a renamed job reaches every repository
 * on its next run — before any of them has reconciled its ruleset. A required
 * context that never reports leaves pull requests waiting indefinitely, and the
 * fastest way out of that is to delete the requirement, which is how a rename
 * ends up removing a guarantee. Emitting the old context alongside the new one
 * for a release keeps both reporting while repositories catch up.
 * Scoped to one environment on purpose. A gate required before a production
 * deploy is not thereby a merge blocker on a pull request, and collapsing the
 * two would silently promote every deploy-time gate into branch protection —
 * blocking merges on checks that were never meant to run yet.
 * @param {object} gates The gates block.
 * @param {object} [options] Context options.
 * @param {string} [options.environment] Which `ci` environment to derive for.
 * @param {string} [options.workflowName] The calling workflow's display name.
 * @param {string[]} [options.previousLabels] Retired labels still worth requiring.
 * @returns {string[]} Sorted, de-duplicated context strings.
 */
export function contextsFor(gates, options = {}) {
  const {
    environment = "pull_request",
    workflowName = "🔍 Quality Checks",
    previousLabels = [],
  } = options;

  const contexts = [];
  for (const [id, gate] of Object.entries(gates ?? {})) {
    if ((gate.ci ?? {})[environment] !== "required") continue;
    contexts.push(`${workflowName} / ${REGISTRY[id]?.label ?? id}`);
  }
  for (const label of previousLabels) {
    contexts.push(`${workflowName} / ${label}`);
  }
  return [...new Set(contexts)].sort((a, b) => a.localeCompare(b));
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
  const { runner, gates, config } = readGates();

  if (command === "validate") {
    const problems = validateGates(gates);
    for (const problem of problems) console.error(`  ${problem}`);
    if (problems.length) {
      console.error(`\n${problems.length} gate configuration problem(s).`);
      process.exit(1);
    }
    console.log("gates: configuration is valid");
    return;
  }

  if (command === "list") {
    const stage = flag("stage");
    if (!stage) throw new Error("usage: lisa-gates.mjs list --stage=<stage>");
    const resolved = resolveStage({ gates, stage, runner });
    if (flag("json") !== null || rest.includes("--json")) {
      console.log(JSON.stringify(resolved, null, 2));
      return;
    }
    for (const gate of resolved) {
      console.log(
        `${gate.level.padEnd(9)} ${gate.id.padEnd(28)} ${gate.command ?? "(lisa-internal)"}`
      );
    }
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
          environment: flag("env") ?? "pull_request",
          workflowName: flag("workflow") ?? "🔍 Quality Checks",
          previousLabels,
        }),
        null,
        2
      )
    );
    return;
  }

  if (command === "floor") {
    console.log(JSON.stringify(gateFloor(config), null, 2));
    return;
  }

  throw new Error("usage: lisa-gates.mjs validate|list|contexts|floor");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
