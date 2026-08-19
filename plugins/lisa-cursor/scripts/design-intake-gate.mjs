#!/usr/bin/env node
/**
 * Deterministic, fail-closed gate for the `design-value-binding` contract.
 *
 * Values come from design variables where a variable system exists. Visual
 * measurement is supplemental there, and it is the legitimate primary source
 * where no variable system exists. Missing design information blocks the work
 * item; it is never worked around.
 *
 * The judgment lives in `/lisa:design:intake`, which gathers the facts — which
 * axes the design source publishes variable collections for, and what the
 * referenced frames and components actually do. This module turns those facts
 * into a verdict, because a verdict an agent reasons out fresh each time is a
 * verdict that decides differently on Tuesday.
 *
 * **The whole design is one distinction: block on *unbound*, never on
 * *unsure*.** "I cannot tell what they meant" is a judgment call, and an agent
 * asked to make it blocks on everything or nothing depending on temperament.
 * "The design does not bind a value I need" is a fact, and two agents check it
 * the same way. So every blocking condition here is a fact about the design,
 * and the non-blocking kinds are enumerated just as explicitly — a gate with no
 * enumerated non-blocks fires constantly, and a gate that fires constantly gets
 * switched off.
 *
 * **The regime is per-axis, not per-project.** A library with a mature colour
 * system and no spacing scale is the common case: colour blocks while spacing
 * gets measured, in the same work item, without contradiction.
 *
 * Run it: `node design-intake-gate.mjs --findings=<file.json> [--json]`
 * Exit 0 = PROCEED, 1 = BLOCK, 2 = usage.
 * @module design-intake-gate
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Every condition that blocks a work item.
 *
 * Exported so the suite can pin the set itself, not just its members' behavior.
 * Classifying a finding is not a guard; *blocking the work item* because of it
 * is. With only per-condition behavior asserted, deleting a condition from this
 * set flips the verdict to PROCEED with the whole suite still green — the
 * failure mode `design-source-gate.mjs` measured on its own violation set.
 */
export const BLOCK_CONDITIONS = new Set([
  "escalation-target-unset",
  "hardcoded-in-design",
  "measured-over-binding",
  "missing-state",
  "missing-token",
  "regime-unknown",
  "source-disagreement",
  "unpublished-component",
]);

/**
 * Who owns each blocking condition.
 *
 * Three failures, two owners, and conflating them sends the wrong person the
 * wrong work. `design` means the design does not settle a value. `us` means the
 * design is fine and our own machinery cannot read it — a stale or incomplete
 * variable-id map, or a project that never named an escalation target. Handing
 * an `us` failure to a designer teaches them to ignore the next one, which is
 * expensive in a way that is hard to undo.
 */
export const CONDITION_OWNERS = {
  "hardcoded-in-design": "design",
  "missing-token": "design",
  "missing-state": "design",
  "source-disagreement": "design",
  "unpublished-component": "design",
  "measured-over-binding": "us",
  "regime-unknown": "us",
  "escalation-target-unset": "us",
};

/**
 * Words that must not reach the operator standing at the gate.
 *
 * Every one is correct and every one is useless to the person being asked for a
 * decision. The house standard is that a non-technical operator reads these
 * comments, so the vocabulary is enforced rather than merely requested — a
 * style note in a contract document is advice, and a list the tests check is a
 * rule.
 */
export const ENGINEERING_VOCABULARY = [
  "token",
  "binding",
  "unbound",
  "axis",
  "untyped",
  "typed",
  "regime",
  "variable collection",
  "node id",
  "lint",
  "hardcode",
];

/** Human names for each axis. The identifiers never reach a comment. */
const AXIS_LABELS = {
  color: "colour",
  spacing: "spacing",
  typography: "text style",
  radius: "corner radius",
  elevation: "shadow",
  motion: "animation timing",
};

/** Finding kinds that are explicitly never a block. */
const NON_BLOCKING_KINDS = new Set(["bound", "one-off", "aesthetic-concern"]);

/** Finding kinds whose verdict depends on the axis regime. */
const REGIME_SENSITIVE_KINDS = new Set(["hardcoded-in-design", "measured"]);

/** Finding kinds that block regardless of regime. */
const UNCONDITIONAL_BLOCK_KINDS = new Set([
  "missing-token",
  "missing-state",
  "source-disagreement",
  "unpublished-component",
]);

/**
 * @param {string | undefined} axis - Axis identifier.
 * @returns {string} The human name, falling back to the identifier.
 */
function labelOf(axis) {
  return AXIS_LABELS[axis] ?? "value";
}

/**
 * @param {object} finding - The finding under evaluation.
 * @returns {string} The component name, or a readable stand-in.
 */
function componentOf(finding) {
  return finding?.component ?? "this component";
}

/**
 * Plain-language reasons, one per blocking condition.
 *
 * Each names the artifact, names the specific value, and says what to do in
 * consequences rather than in vocabulary. "Published as a variable" is an
 * action a designer can take; "unbound reference in a typed axis" is a
 * diagnosis nobody outside the factory can act on.
 */
const REASONS = {
  "missing-token": finding =>
    `The '${componentOf(finding)}' design asks for a ${labelOf(finding.axis)} called '${finding.name ?? finding.token}', but the design library does not publish anything by that name. I need it published, or the design pointed at one that already exists — otherwise I would be inventing a value nobody agreed to.`,

  "hardcoded-in-design": finding =>
    `The '${componentOf(finding)}' component uses the ${labelOf(finding.axis)} ${finding.value} directly rather than a ${labelOf(finding.axis)} variable. I need that ${labelOf(finding.axis)} published as a variable so the app and the design stay in sync — otherwise I'd be copying a number that changes without warning.`,

  "unpublished-component": finding =>
    `The '${componentOf(finding)}' component only exists in a working draft, so there is nothing settled for me to build against — it could be renamed or removed at any time and the app would quietly break. I need it published to the shared library first.`,

  "missing-state": finding =>
    `The work asks for the '${finding.state}' version of '${componentOf(finding)}', and the design does not have one. I need someone to draw it — guessing what it should look like is how two screens end up disagreeing with each other.`,

  "source-disagreement": finding =>
    `The '${componentOf(finding)}' design gives two different answers for its ${labelOf(finding.axis)}: the shared library says ${finding.tokenValue} and the drawing shows ${finding.frameValue}. I need someone to say which one is right — if I choose, I am making a design decision on my own.`,

  "measured-over-binding": finding =>
    `I could measure the ${labelOf(finding.axis)} of '${componentOf(finding)}' off the picture — ${finding.value} — but this project publishes its ${labelOf(finding.axis)} choices as shared variables, and a number copied off a picture drifts the moment the shared one changes. I need to know which shared ${labelOf(finding.axis)} this is meant to use.`,

  "regime-unknown": finding =>
    `I could not find out whether this project publishes its ${labelOf(finding.axis)} choices as shared variables, so I do not know whether to use one or measure it. I need that checked before I build '${componentOf(finding)}' — guessing either way is how the app and the design drift apart.`,

  "escalation-target-unset": () =>
    `No one is set up to receive design questions for this project — 'design.escalation.assignee' in .lisa.config.json is empty — so anything I stopped on would sit where nobody sees it. I need that filled in before I can hand a design question to a person.`,
};

/**
 * Build one block entry.
 *
 * Deliberately carries no resolved value. Where two sources disagree, choosing
 * between them is a design decision, and a gate that quietly made it would be
 * guessing in exactly the situation the condition exists to catch.
 * @param {string} condition - A member of {@link BLOCK_CONDITIONS}.
 * @param {object} finding - The finding that produced it.
 * @returns {{ condition: string, component: string, axis: string | null, reason: string }} Block entry.
 */
function blockFor(condition, finding) {
  return {
    condition,
    owner: CONDITION_OWNERS[condition],
    component: finding?.component ?? null,
    axis: finding?.axis ?? null,
    reason: REASONS[condition](finding ?? {}),
  };
}

/**
 * Classify a regime-sensitive finding against the axis regime.
 *
 * An unresolved regime is a block, never a fallback to untyped: defaulting a
 * failed query to "no variable system here" converts every access problem into
 * silent permission to copy numbers out of a picture.
 * @param {object} finding - Finding with an `axis`.
 * @param {Record<string, string>} regime - Observed regime per axis.
 * @returns {{ block: object | null, derived: object | null }} The outcome.
 */
function classifyRegimeSensitive(finding, regime) {
  const state = regime?.[finding.axis];

  if (state !== "typed" && state !== "untyped") {
    return { block: blockFor("regime-unknown", finding), derived: null };
  }

  if (state === "untyped") {
    // Measuring is the correct source of truth here. The measurement is still
    // recorded, so what the variable system is missing accumulates on its own,
    // ranked by what people actually needed.
    return {
      block: null,
      derived: {
        axis: finding.axis,
        component: finding.component ?? null,
        value: finding.value ?? null,
      },
    };
  }

  const condition =
    finding.kind === "measured"
      ? "measured-over-binding"
      : "hardcoded-in-design";
  return { block: blockFor(condition, finding), derived: null };
}

/**
 * Classify one finding.
 * @param {object} finding - The finding.
 * @param {Record<string, string>} regime - Observed regime per axis.
 * @returns {{ block: object | null, derived: object | null }} The outcome.
 */
function classifyFinding(finding, regime) {
  const kind = finding?.kind;

  if (NON_BLOCKING_KINDS.has(kind)) return { block: null, derived: null };
  if (REGIME_SENSITIVE_KINDS.has(kind)) {
    return classifyRegimeSensitive(finding, regime);
  }
  if (UNCONDITIONAL_BLOCK_KINDS.has(kind)) {
    return { block: blockFor(kind, finding), derived: null };
  }

  // A kind this module does not recognise is a caller defect, and guessing at
  // it would be the gate inventing a verdict. Fail loudly instead.
  throw new TypeError(
    `design-intake-gate: unrecognised finding kind '${kind}'`
  );
}

/**
 * Read a non-empty string from a config path, or null.
 * @param {unknown} value - Candidate value.
 * @returns {string | null} The trimmed string, or null.
 */
function configuredString(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Evaluate one work item's design facts.
 *
 * @param {{
 *   config?: { design?: { escalation?: { assignee?: string, label?: string }, tokens?: object } },
 *   regime?: Record<string, string>,
 *   findings?: readonly object[]
 * }} input - Facts gathered by `/lisa:design:intake`.
 * @returns {{
 *   verdict: "BLOCK" | "PROCEED",
 *   owner: "design" | "us" | null,
 *   assignee: string | null,
 *   label: string | null,
 *   blocks: object[],
 *   derived: object[],
 *   comment: string | null
 * }} The verdict.
 */
export function evaluateDesignIntake(input = {}) {
  const escalation = input?.config?.design?.escalation ?? {};
  const assignee = configuredString(escalation.assignee);
  const label = configuredString(escalation.label);

  const blocks = [];
  const derived = [];

  // Checked first and unconditionally. A blocked item assigned to nobody is an
  // item nobody sees, which is operationally identical to having skipped the
  // block — except that it also consumed the work item. Guessing a target is
  // worse still: it routes a design question to whoever happened to be nearby.
  if (assignee === null) blocks.push(blockFor("escalation-target-unset", {}));

  for (const finding of input?.findings ?? []) {
    const { block, derived: record } = classifyFinding(finding, input?.regime);
    if (block !== null) blocks.push(block);
    if (record !== null) derived.push(record);
  }

  // Design wins when both are present: an unbound value is the thing that
  // actually stops the build, and it needs a person either way.
  const owners = new Set(blocks.map(block => block.owner));
  const owner = owners.has("design")
    ? "design"
    : owners.has("us")
      ? "us"
      : null;

  return {
    verdict: blocks.length === 0 ? "PROCEED" : "BLOCK",
    owner,
    assignee,
    label,
    blocks,
    derived,
    comment: blocks.length === 0 ? null : renderComment(blocks),
  };
}

/**
 * Render the comment posted on a blocked work item.
 *
 * Written for the non-technical operator standing at the gate: plain language,
 * naming the specific missing artifact and what to do about it.
 * @param {readonly { reason: string }[]} blocks - The blocking findings.
 * @returns {string} The comment body.
 */
export function renderComment(blocks) {
  const opening =
    blocks.length === 1
      ? "I've stopped on this because the design does not settle something I need:"
      : `I've stopped on this because the design does not settle ${blocks.length} things I need:`;
  const body = blocks.map(block => `- ${block.reason}`).join("\n");
  return `${opening}\n\n${body}`;
}

/**
 * Render the operator-readable report for a CLI run.
 * @param {ReturnType<typeof evaluateDesignIntake>} result - The verdict.
 * @returns {string} Report text.
 */
export function renderReport(result) {
  const lines = [`design-intake gate: ${result.verdict}`];

  if (result.verdict === "PROCEED") {
    lines.push(
      `  Nothing is missing. ${result.derived.length} value(s) were measured and recorded.`
    );
  } else {
    lines.push(
      `  Owner: ${result.owner}${result.owner === "us" ? " — do NOT send this to a designer" : ""}`,
      `  Assign to: ${result.assignee ?? "(nobody — that is itself one of the reasons below)"}`,
      "",
      result.comment ?? ""
    );
  }

  for (const record of result.derived) {
    lines.push(
      `  · measured ${labelOf(record.axis)} on '${record.component}': ${record.value}`
    );
  }

  return lines.join("\n");
}

/**
 * Read merged project config, local overriding global per key.
 * @returns {object} Parsed config, or {}.
 */
function readProjectConfig() {
  const load = file => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  };
  const global = load(".lisa.config.json");
  const local = load(".lisa.config.local.json");
  return {
    ...global,
    ...local,
    design: { ...global.design, ...local.design },
  };
}

/**
 * CLI entrypoint.
 * @param {readonly string[]} argv - Arguments after the script name.
 * @returns {number} Process exit code.
 */
export function runCli(argv) {
  const args = new Map(
    argv
      .filter(arg => arg.startsWith("--"))
      .map(arg => {
        const eq = arg.indexOf("=");
        return eq === -1
          ? [arg.slice(2), "true"]
          : [arg.slice(2, eq), arg.slice(eq + 1)];
      })
  );

  const findingsPath = args.get("findings");
  if (!findingsPath) {
    process.stderr.write(
      "usage: design-intake-gate.mjs --findings=<file.json> [--json]\n"
    );
    return 2;
  }

  let payload;
  try {
    payload = JSON.parse(readFileSync(findingsPath, "utf8"));
  } catch (error) {
    // Unreadable facts are a block, never a quiet pass: a gate that returns
    // PROCEED on what it could not look at proves nothing.
    process.stderr.write(
      `design-intake gate: BLOCK — could not read ${findingsPath}: ${String(error?.message ?? error)}\n`
    );
    return 1;
  }

  const result = evaluateDesignIntake({
    config: payload.config ?? readProjectConfig(),
    regime: payload.regime,
    findings: payload.findings,
  });

  process.stdout.write(
    args.get("json") === "true"
      ? `${JSON.stringify(result, null, 2)}\n`
      : `${renderReport(result)}\n`
  );
  return result.verdict === "PROCEED" ? 0 : 1;
}

/**
 * True when `moduleUrl` names the module node was asked to run.
 *
 * Both sides are realpath'd. Reached through a symlinked checkout, a git
 * worktree, or a `/tmp` path on macOS the naive comparisons disagree, the body
 * never runs, and the process exits 0 having done nothing — and every
 * Lisa-driven agent runs in a worktree, so that is the routine path.
 *
 * Written out rather than imported: this ships inside a plugin payload, which
 * has no `./lib/` to resolve against. Same rule and reasoning as
 * `scripts/lib/invoked-as-script.mjs`.
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
export function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  process.exit(runCli(process.argv.slice(2)));
}
