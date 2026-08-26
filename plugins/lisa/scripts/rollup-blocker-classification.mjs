#!/usr/bin/env node
/**
 * Blocker classification for the parent status rollup.
 *
 * The `leaf-only-lifecycle` rollup propagates "blocked dominates" faithfully:
 * one blocked leaf anywhere under a container puts the container in `blocked`.
 * What it propagates is a single bit. It cannot say which leaf, and it cannot
 * say what kind of hold it is — and those are two different asks:
 *
 * - a **hard blocker** waits on an external event and may clear with nobody
 *   touching it;
 * - a **bad acceptance criterion** waits on a person rewriting it, and will
 *   never clear on its own.
 *
 * Rendered identically, the second class accumulates silently. Measured on one
 * Epic: two occurrences, 32 identical hold comments, six weeks — while the
 * initiative was two-thirds complete both times.
 *
 * This module classifies from **recorded signals only** — the markers and the
 * `is blocked by` links a writer already put on the item. It never reads prose
 * to guess, and it never decides that a criterion is bad: judging that is a
 * human call, and `unknown` is the honest answer when nothing recorded says.
 * Its job is to make the distinction recordable and visible, not to make it.
 *
 * It probes nothing itself. The caller reads the tracker and hands back the
 * child graph, which keeps the decision auditable and testable apart from the
 * network — same contract as `intake-blocker-reprobe`.
 */

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Classes a hold can carry, most specific first. */
export const BLOCKER_CLASSES = Object.freeze([
  "spec-defect",
  "human-input",
  "hard-blocker",
  "unknown",
]);

/** Default marker naming a hold a person must rewrite the spec to clear. */
export const DEFAULT_SPEC_DEFECT_MARKER = "blocked:spec-defect";

/** Default marker naming a hold only a person can supply the input for. */
export const DEFAULT_HUMAN_NEEDED_MARKER = "human-needed";

/** Lifecycle values that mean "held", across the three trackers. */
const DEFAULT_BLOCKED_STATES = Object.freeze([
  "blocked",
  "status:blocked",
  "Blocked",
]);

/**
 * Who must act, per class. One actor per class, never a shared line: the whole
 * point is that "waits on an external event" and "waits on a person rewriting
 * it" are different asks and must not be rendered the same way.
 */
export const BLOCKER_ACTOR = Object.freeze({
  "spec-defect": "a person rewrites the acceptance criteria",
  "human-input": "a person supplies the input",
  "hard-blocker": "nobody — it waits on other work",
  unknown: "a person says which kind of hold this is",
});

/** Operator-readable heading and body, per class. Composed, never asserted. */
export const BLOCKER_COPY = Object.freeze({
  "spec-defect": {
    heading: "Waiting on a rewrite",
    line: "A person must rewrite this item's acceptance criteria. Nothing external will ever clear it, so it will sit here until someone edits it.",
  },
  "human-input": {
    heading: "Waiting on a person",
    line: "A person must supply something no agent can invent — access, a credential, or a product decision. It will not clear on its own.",
  },
  "hard-blocker": {
    heading: "Waiting on other work",
    line: "Nobody has to act. This clears by itself when the work it names below closes.",
  },
  unknown: {
    heading: "Nobody is assigned",
    line: `Nothing recorded on this item says which kind of hold it is, so nobody is assigned to it and it will sit. A person must decide, then record it: add \`${DEFAULT_SPEC_DEFECT_MARKER}\` if the acceptance criteria are the problem, or an \`is blocked by\` link if it is waiting on other work.`,
  },
});

/** Why a classification run refuses to report. */
export const CLASSIFICATION_FAILURES = Object.freeze({
  CONTAINER_UNREADABLE: "container-unreadable",
  NO_CHILDREN: "rollup-has-no-children",
  NOTHING_EXAMINED: "no-child-could-be-examined",
});

const FAILURE_COPY = Object.freeze({
  "container-unreadable":
    "The tracker could not be read, so nothing was examined. This is not an all-clear.",
  "rollup-has-no-children":
    "This container has no children, so there was nothing to roll up. A container with no children is a decomposition gap, not a clear rollup.",
  "no-child-could-be-examined":
    "Children were listed but none could be examined, so nothing was classified. This is not an all-clear.",
});

/**
 * @param {unknown} value
 * @returns {string}
 */
function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} labels
 * @returns {readonly string[]}
 */
function normalizeMarkers(labels) {
  return (Array.isArray(labels) ? labels : [])
    .map(label =>
      typeof label === "string" ? label : trimmedString(label?.name)
    )
    .map(label => trimmedString(label).toLowerCase())
    .filter(label => label.length > 0);
}

/**
 * @param {unknown} states
 * @returns {readonly string[]}
 */
function normalizeBlockedStates(states) {
  const configured = (Array.isArray(states) ? states : DEFAULT_BLOCKED_STATES)
    .map(state => trimmedString(state).toLowerCase())
    .filter(state => state.length > 0);

  return configured.length > 0
    ? configured
    : DEFAULT_BLOCKED_STATES.map(state => state.toLowerCase());
}

/**
 * A child's own lifecycle value, taken from whichever field the vendor reader
 * filled: a JIRA/Linear `state`, or the single `status:*` GitHub label.
 *
 * @param {{ state?: unknown, status?: unknown, role?: unknown }} node
 * @returns {string}
 */
function nodeState(node) {
  return (
    trimmedString(node?.state) ||
    trimmedString(node?.status) ||
    trimmedString(node?.role)
  );
}

/**
 * Open `is blocked by` dependencies recorded on the item. A dependency the
 * caller resolved as closed is dropped: it no longer holds anything.
 *
 * @param {unknown} blockedBy
 * @returns {readonly string[]}
 */
function openDependencies(blockedBy) {
  return (Array.isArray(blockedBy) ? blockedBy : [])
    .map(entry =>
      typeof entry === "string"
        ? { ref: entry, open: true }
        : { ref: trimmedString(entry?.ref), open: entry?.open !== false }
    )
    .filter(entry => entry.open && entry.ref.length > 0)
    .map(entry => entry.ref);
}

/**
 * Classify one held item from its recorded signals.
 *
 * Order is load-bearing and runs most-deliberate first. A marker is something
 * a person chose to write; a dependency link is something a flow wrote. Where
 * both are present the human's record wins, because the marker is the only
 * signal that carries a judgment nothing else can supply.
 *
 * @param {{
 *   ref?: unknown
 *   labels?: unknown
 *   markers?: unknown
 *   blockedBy?: unknown
 * }} node
 * @param {{ specDefect?: unknown, humanNeeded?: unknown }} [markerNames]
 * @returns {{ class: string, actor: string, signals: readonly string[] }}
 */
export function classifyHeldItem(node = {}, markerNames = {}) {
  const specDefect = (
    trimmedString(markerNames.specDefect) || DEFAULT_SPEC_DEFECT_MARKER
  ).toLowerCase();
  const humanNeeded = (
    trimmedString(markerNames.humanNeeded) || DEFAULT_HUMAN_NEEDED_MARKER
  ).toLowerCase();
  const markers = normalizeMarkers(node.markers ?? node.labels);
  const dependencies = openDependencies(node.blockedBy);

  if (markers.includes(specDefect)) {
    return {
      class: "spec-defect",
      actor: BLOCKER_ACTOR["spec-defect"],
      signals: [`marked \`${specDefect}\``],
    };
  }
  if (markers.includes(humanNeeded)) {
    return {
      class: "human-input",
      actor: BLOCKER_ACTOR["human-input"],
      signals: [`marked \`${humanNeeded}\``],
    };
  }
  if (dependencies.length > 0) {
    return {
      class: "hard-blocker",
      actor: BLOCKER_ACTOR["hard-blocker"],
      signals: [`blocked by ${dependencies.join(", ")}`],
    };
  }

  return { class: "unknown", actor: BLOCKER_ACTOR.unknown, signals: [] };
}

/**
 * @param {unknown} children
 * @returns {readonly object[]}
 */
function childArray(children) {
  return Array.isArray(children) ? children.filter(Boolean) : [];
}

/**
 * Walk the container's descendants, collecting every held item that is itself
 * the bottom of a chain of holds.
 *
 * A held parent whose own children include a held one is *transparent*: it is
 * blocked because of them, so reporting it would name the wrong item. Its path
 * is kept instead, which is what turns a five-level descent into one read.
 *
 * @param {readonly object[]} children
 * @param {{ blockedStates: readonly string[], markerNames: object }} context
 * @param {readonly string[]} path
 * @param {Set<string>} seen
 * @param {{ examined: number, unexaminable: string[] }} tally
 * @returns {object[]}
 */
function collectHolds(children, context, path, seen, tally) {
  return childArray(children).flatMap(child => {
    const ref = trimmedString(child.ref) || trimmedString(child.key);
    const state = nodeState(child);
    if (ref.length === 0 || state.length === 0) {
      tally.unexaminable.push(ref || "(child with no reference)");
      return [];
    }
    if (seen.has(ref)) {
      return [];
    }
    seen.add(ref);
    tally.examined += 1;

    const here = [...path, ref];
    const descendants = collectHolds(
      child.children,
      context,
      here,
      seen,
      tally
    );
    if (!context.blockedStates.includes(state.toLowerCase())) {
      return descendants;
    }
    if (descendants.length > 0) {
      return descendants;
    }

    return [
      {
        ref,
        path: here,
        ...classifyHeldItem(child, context.markerNames),
      },
    ];
  });
}

/**
 * Classify every hold under a container and derive the rollup from it.
 *
 * Refuses rather than reports when it examined nothing: an unreadable tracker,
 * a container with no children, and children none of which could be read all
 * return `ok: false`. Reporting all-clear on any of them would be the same
 * defect this module exists to fix, one level up.
 *
 * @param {{
 *   container?: { ref?: unknown, type?: unknown }
 *   readError?: unknown
 *   children?: unknown
 *   renderedState?: unknown
 *   childTally?: unknown
 *   blockedStates?: unknown
 *   markerNames?: { specDefect?: unknown, humanNeeded?: unknown }
 * }} input
 * @returns {object}
 */
export function classifyRollupBlockers(input = {}) {
  const container = {
    ref: trimmedString(input.container?.ref) || "(unnamed container)",
    type: trimmedString(input.container?.type) || "container",
  };
  const readError = trimmedString(input.readError);
  if (readError.length > 0) {
    return failure(container, CLASSIFICATION_FAILURES.CONTAINER_UNREADABLE, {
      detail: readError,
    });
  }

  const children = childArray(input.children);
  if (children.length === 0) {
    return failure(container, CLASSIFICATION_FAILURES.NO_CHILDREN);
  }

  const tally = { examined: 0, unexaminable: [] };
  const blockers = collectHolds(
    children,
    {
      blockedStates: normalizeBlockedStates(input.blockedStates),
      markerNames: input.markerNames ?? {},
    },
    [container.ref],
    new Set([container.ref]),
    tally
  );

  if (tally.examined === 0) {
    return failure(container, CLASSIFICATION_FAILURES.NOTHING_EXAMINED, {
      detail: `${children.length} listed, none readable`,
    });
  }

  const byClass = Object.fromEntries(
    BLOCKER_CLASSES.map(name => [
      name,
      blockers.filter(blocker => blocker.class === name),
    ]).filter(([, group]) => group.length > 0)
  );
  const renderedState = trimmedString(input.renderedState);
  const childTally =
    trimmedString(input.childTally) ||
    `examined=${tally.examined}, held=${blockers.length}, unreadable=${tally.unexaminable.length}`;

  return {
    ok: true,
    container,
    verdict: blockers.length > 0 ? "blocked" : "not-blocked",
    examined: tally.examined,
    blockers,
    byClass,
    unexaminable: tally.unexaminable,
    renderedState,
    childTally,
  };
}

/**
 * @param {{ ref: string, type: string }} container
 * @param {string} reason
 * @param {{ detail?: string }} [extra]
 * @returns {object}
 */
function failure(container, reason, extra = {}) {
  return {
    ok: false,
    container,
    verdict: "unclassified",
    examined: 0,
    reason,
    message: FAILURE_COPY[reason] ?? reason,
    detail: trimmedString(extra.detail),
  };
}

/**
 * @param {{ ref: string, path: readonly string[], signals: readonly string[] }} blocker
 * @returns {string}
 */
function renderBlockerLine(blocker) {
  const via =
    blocker.path.length > 2 ? ` (via ${blocker.path.join(" -> ")})` : "";
  const signals =
    blocker.signals.length > 0 ? ` — ${blocker.signals.join("; ")}` : "";

  return `  - ${blocker.ref}${via}${signals}`;
}

/**
 * Render the rollup for an operator.
 *
 * Every sentence is composed from the per-class grouping rather than asserted
 * over all blockers, so the summary and the per-item lines cannot disagree. A
 * class with nothing in it produces no text at all.
 *
 * @param {object} result - A {@link classifyRollupBlockers} result.
 * @returns {string}
 */
export function renderRollupBlockerReport(result) {
  if (!result?.ok) {
    return [
      `${result?.container?.ref ?? "(unnamed container)"} — NOT CLASSIFIED (${result?.reason ?? "unknown"}).`,
      result?.message ?? "",
      trimmedString(result?.detail).length > 0
        ? `Detail: ${result.detail}`
        : "",
    ]
      .filter(line => line.length > 0)
      .join("\n");
  }

  if (result.verdict === "not-blocked") {
    return `${result.container.ref} — not blocked. ${result.examined} item(s) examined, none held.`;
  }

  const held = result.blockers.length;
  const sections = BLOCKER_CLASSES.filter(
    name => (result.byClass[name] ?? []).length > 0
  ).map(name => {
    const group = result.byClass[name];
    const copy = BLOCKER_COPY[name];

    return [
      `${copy.heading} (${group.length}) — who must act: ${BLOCKER_ACTOR[name]}.`,
      `  ${copy.line}`,
      ...group.map(renderBlockerLine),
    ].join("\n");
  });

  return [
    `${result.container.ref} — blocked. ${held} of ${result.examined} item(s) examined are held.`,
    "",
    ...sections.flatMap(section => [section, ""]),
  ]
    .join("\n")
    .trimEnd();
}

/**
 * A stable identity for a rollup note: the rendered lifecycle state, child
 * tally, container, and every held item plus its class, sorted.
 *
 * This is what lets a repeat cycle stay quiet. 32 identical hold comments over
 * six weeks was the same verdict restated on a schedule; comparing this string
 * to the last one tells a caller whether it has anything new to say.
 *
 * @param {object} result - A {@link classifyRollupBlockers} result.
 * @returns {string}
 */
export function rollupBlockerFingerprint(result) {
  if (!result?.ok) {
    return `container=${result?.container?.ref ?? "?"};unclassified=${result?.reason ?? "?"}`;
  }
  const pairs = [...result.blockers]
    .map(blocker => `${blocker.ref}:${blocker.class}`)
    .sort((left, right) => left.localeCompare(right));

  return [
    `container=${result.container.ref}`,
    `verdict=${result.verdict}`,
    `rendered=${JSON.stringify(trimmedString(result.renderedState))}`,
    `tally=${JSON.stringify(trimmedString(result.childTally))}`,
    `examined=${result.examined}`,
    `holds=${pairs.join(",")}`,
  ].join(";");
}

/**
 * Decide whether this cycle has anything new to say, and say what changed.
 *
 * @param {string | null | undefined} previousFingerprint
 * @param {object} result - A {@link classifyRollupBlockers} result.
 * @returns {{ changed: boolean, fingerprint: string, summary: string }}
 */
export function describeRollupBlockerChange(previousFingerprint, result) {
  const fingerprint = rollupBlockerFingerprint(result);
  const previous = trimmedString(previousFingerprint);
  if (previous.length === 0) {
    return {
      changed: true,
      fingerprint,
      summary: "First classification of this container.",
    };
  }
  if (previous === fingerprint) {
    return {
      changed: false,
      fingerprint,
      summary:
        "Unchanged since the last cycle — same items held, same classes. Nothing new to post.",
    };
  }

  return {
    changed: true,
    fingerprint,
    summary: `Changed since the last cycle: ${describeDelta(previous, fingerprint)}.`,
  };
}

/**
 * @param {string} previous
 * @param {string} current
 * @returns {string}
 */
function describeDelta(previous, current) {
  const parse = fingerprint =>
    new Map(
      (fingerprint.split(";holds=")[1] ?? "")
        .split(",")
        .filter(pair => pair.length > 0)
        .map(pair => {
          const cut = pair.lastIndexOf(":");
          return [pair.slice(0, cut), pair.slice(cut + 1)];
        })
    );
  const before = parse(previous);
  const after = parse(current);
  const cleared = [...before.keys()].filter(ref => !after.has(ref));
  const added = [...after.keys()].filter(ref => !before.has(ref));
  const reclassified = [...after.entries()]
    .filter(([ref, name]) => before.has(ref) && before.get(ref) !== name)
    .map(([ref, name]) => `${ref} is now ${name} (was ${before.get(ref)})`);
  const parts = [
    cleared.length > 0 ? `${cleared.join(", ")} no longer held` : "",
    added.length > 0 ? `${added.join(", ")} newly held` : "",
    ...reclassified,
  ].filter(part => part.length > 0);

  return parts.length > 0 ? parts.join("; ") : "the rollup verdict itself";
}

/**
 * @param {readonly string[]} argv
 * @returns {number}
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

  const inputPath = args.get("input");
  if (!inputPath) {
    process.stderr.write(
      "usage: rollup-blocker-classification.mjs --input=<file.json> [--since=<fingerprint>] [--json]\n"
    );
    return 2;
  }

  let payload;
  try {
    payload = JSON.parse(readFileSync(inputPath, "utf8"));
  } catch (error) {
    process.stderr.write(
      `rollup-blocker-classification: NOT CLASSIFIED — could not read ${inputPath}: ${String(error?.message ?? error)}\n`
    );
    return 1;
  }

  const result = classifyRollupBlockers(payload);
  const change = describeRollupBlockerChange(args.get("since"), result);
  process.stdout.write(
    args.get("json") === "true"
      ? `${JSON.stringify({ ...result, change }, null, 2)}\n`
      : `${renderRollupBlockerReport(result)}\n\n${change.summary}\n`
  );

  return result.ok ? 0 : 1;
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
 * has no `./lib/` to resolve against.
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
