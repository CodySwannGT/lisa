#!/usr/bin/env node
/**
 * Headless probe for the `design-value-binding` contract: does a design node's
 * subtree bind its style values to variables, or paint literals?
 *
 * This is the fact-gathering half. It reads the design source and produces
 * findings; `design-intake-gate.mjs` turns findings into a verdict. Split
 * deliberately — the decision has to be identical whether the facts arrived
 * from this probe, from an interactive session, or from a fixture.
 *
 * WHY IT WORKS THE WAY IT DOES
 * ----------------------------
 * The obvious implementation — ask the design tool "which variable collections
 * are published?" — cannot run headlessly, and that is measured, not assumed:
 *
 *   - The Variables REST API (`/v1/files/:key/variables/local`) returns names
 *     directly but is **Enterprise-plan only**. The read scope is not offered
 *     in the token scope picker on other plans, so no token change unlocks it.
 *   - The design-tool MCP returns names on every plan but authenticates by
 *     **browser OAuth**, which cron, CI, and a subagent cannot perform.
 *
 * A gate built on either would work in an interactive session and silently
 * no-op everywhere else — the exact defect class of a control that reports
 * success while inert.
 *
 * What IS available headlessly on a plain personal access token is
 * `/v1/files/:key/nodes`, which reports each bound property as an opaque
 * `VariableID:106:15`. That id→name mapping is **static**. So it is resolved
 * once interactively by `design-variable-ids.mjs`, committed to the repo, and
 * this probe runs headlessly against the token alone forever after.
 *
 * That also answers the regime question. An axis is **typed** when the
 * committed map contains at least one variable in that axis's namespace —
 * derived from what the design source really publishes, not from a human being
 * asked, and not from a live query that cannot run.
 *
 * MEASURE THE SUBTREE YOU ARE IMPLEMENTING, NOT THE ENCLOSING SCREEN. A
 * frame-level read counts the chrome behind a modal and over-reports; one
 * measured work item scored 14 bound values at frame level and **zero** inside
 * the modal subtree it actually had to build. Pass the node you will build.
 *
 * FIGMA IS OPTIONAL. A project with no design source configured, no token, or
 * no committed map is SKIPPED — loudly, exit 0. A mandatory gate on an absent
 * integration breaks every project that has no designs, which is most of them.
 *
 * Usage:
 *   FIGMA_ACCESS_TOKEN=… node design-bindings-probe.mjs --file <key> --node <id>
 *     [--json] [--require color,spacing,radius] [--min 100]
 *
 * Exit codes: 0 PASS or SKIPPED · 1 BLOCK · 2 usage/transport error.
 * @module design-bindings-probe
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Bound-property → axis. A property absent here is not a style decision this
 * contract gates, so it is neither counted bound nor counted literal.
 */
export const PROPERTY_AXES = {
  fills: "color",
  strokes: "color",
  paddingLeft: "spacing",
  paddingRight: "spacing",
  paddingTop: "spacing",
  paddingBottom: "spacing",
  itemSpacing: "spacing",
  counterAxisSpacing: "spacing",
  cornerRadius: "radius",
  topLeftRadius: "radius",
  topRightRadius: "radius",
  bottomLeftRadius: "radius",
  bottomRightRadius: "radius",
  rectangleCornerRadii: "radius",
};

/**
 * Variable-name prefixes that mark an axis as published. Overridable per
 * project through `design.tokens.namespaces`, because the namespace vocabulary
 * is the design system's, not Lisa's.
 */
export const DEFAULT_NAMESPACES = {
  color: [
    "color/",
    "colour/",
    "content/",
    "surface/",
    "accent/",
    "status/",
    "outline/",
    "chart/",
  ],
  spacing: ["space/", "spacing/", "gap/"],
  radius: ["radius/", "corner/"],
  typography: ["font/", "text/", "type/"],
  elevation: ["elevation/", "shadow/"],
  motion: ["motion/", "duration/", "easing/"],
};

/** The axes this probe can observe through the node payload. */
export const PROBED_AXES = ["color", "spacing", "radius"];

/**
 * Normalise the three shapes a `boundVariables` entry can take.
 *
 * | shape | example | seen on |
 * |---|---|---|
 * | scalar | `{type,id}` | `paddingLeft`, `itemSpacing` |
 * | array | `[{type,id}, …]` | `fills`, `strokes` — one per paint |
 * | keyed object | `{RECTANGLE_TOP_LEFT_CORNER_RADIUS: {type,id}, …}` | `rectangleCornerRadii` |
 *
 * The keyed shape is the trap: it is neither an array nor itself a ref, so a
 * reader that handles only the first two reports **zero bound radii on a file
 * whose radii are fully bound**. Measured, not hypothetical.
 * @param {unknown} ref - A `boundVariables` entry.
 * @returns {{ id: string }[]} Every variable reference it carries.
 */
export function refsOf(ref) {
  if (!ref || typeof ref !== "object") return [];
  if (Array.isArray(ref)) return ref.filter(entry => entry?.id);
  if (ref.id) return [ref];
  return Object.values(ref).filter(entry => entry?.id);
}

/**
 * @param {{ r: number, g: number, b: number }} color - Figma colour triple.
 * @returns {string} `#rrggbb`.
 */
function hexOf(color) {
  const channel = value =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

/**
 * @param {object} node - A design node.
 * @returns {string} A short human locator for a report.
 */
function whereOf(node) {
  return `${node.type}:${node.name ?? ""}`.slice(0, 60);
}

/**
 * Record every bound style value on one node.
 *
 * Boundness is read from `boundVariables` **directly, never inferred from a
 * resolved value being present**. Figma omits zero-valued properties from the
 * REST payload, so a padding bound to `space/0` vanishes entirely from the
 * resolved side. Reading it correctly moved one measured frame from 55% to 82%.
 * @param {object} node - A design node.
 * @param {object[]} bound - Accumulator.
 * @returns {void}
 */
function collectBound(node, bound) {
  const boundVariables = node.boundVariables ?? {};
  for (const [property, ref] of Object.entries(boundVariables)) {
    const axis = PROPERTY_AXES[property];
    if (!axis) continue;
    for (const one of refsOf(ref)) {
      bound.push({ axis, property, where: whereOf(node), id: one.id });
    }
  }
}

/**
 * Record every literal paint on one node, past whatever is already bound.
 * @param {object} node - A design node.
 * @param {string} property - `fills` or `strokes`.
 * @param {number} boundCount - How many paints on this property are bound.
 * @param {object[]} literal - Accumulator.
 * @returns {void}
 */
function collectLiteralPaints(node, property, boundCount, literal) {
  const paints = (node[property] ?? []).filter(
    paint => paint?.type === "SOLID" && paint.color
  );
  for (const paint of paints.slice(boundCount)) {
    literal.push({
      axis: PROPERTY_AXES[property],
      property,
      where: whereOf(node),
      value: hexOf(paint.color),
    });
  }
}

/**
 * Record every literal numeric value on one node, past whatever is bound.
 * @param {object} node - A design node.
 * @param {string} property - The gated property name.
 * @param {number} boundCount - How many entries on this property are bound.
 * @param {object[]} literal - Accumulator.
 * @returns {void}
 */
function collectLiteralNumbers(node, property, boundCount, literal) {
  const raw = node[property];
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "number"
      ? [raw]
      : [];
  for (const value of values.slice(boundCount)) {
    // A zero is the absence of a value, not a design decision worth a variable.
    if (typeof value !== "number" || value === 0) continue;
    literal.push({
      axis: PROPERTY_AXES[property],
      property,
      where: whereOf(node),
      value: `${value}px`,
    });
  }
}

/**
 * Walk a node subtree, recording every gated style value as bound or literal.
 * @param {object} root - The subtree root — the node being implemented.
 * @returns {{ bound: object[], literal: object[] }} Observations.
 */
export function collectValues(root) {
  const bound = [];
  const literal = [];
  const stack = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

    collectBound(node, bound);

    for (const property of Object.keys(PROPERTY_AXES)) {
      const boundCount = refsOf(node.boundVariables?.[property]).length;
      if (property === "fills" || property === "strokes") {
        collectLiteralPaints(node, property, boundCount, literal);
      } else {
        collectLiteralNumbers(node, property, boundCount, literal);
      }
    }

    for (const child of node.children ?? []) stack.push(child);
  }

  return { bound, literal };
}

/**
 * Derive the per-axis regime from the committed variable-id map.
 *
 * An axis is `typed` when the map names at least one variable in its namespace
 * — that is the published-collection question, answered from real published
 * variables and answerable headlessly. An axis with no variables is `untyped`,
 * and measuring is its correct source of truth.
 * @param {readonly string[]} names - Variable names from the committed map.
 * @param {Record<string, readonly string[]>} [namespaces] - Axis → name prefixes.
 * @returns {Record<string, "typed" | "untyped">} Regime per axis.
 */
export function regimeFromVariableNames(
  names,
  namespaces = DEFAULT_NAMESPACES
) {
  const regime = {};
  for (const [axis, prefixes] of Object.entries(namespaces)) {
    regime[axis] = names.some(name =>
      prefixes.some(prefix => String(name).startsWith(prefix))
    )
      ? "typed"
      : "untyped";
  }
  return regime;
}

/**
 * Resolve observed variable ids against the committed map.
 *
 * Three outcomes with two different owners, and conflating them sends the wrong
 * person the wrong work:
 *
 * - **named** — resolved. Nothing to do.
 * - **unknown** — *our* map is stale. The value IS bound; we simply cannot say
 *   which variable. Regenerate the map.
 * - **ambiguous** — *our* map cannot name it, because two variables share a
 *   value. Also not the designer's fault, and still not a pass: guessing which
 *   one is exactly what the contract forbids.
 *
 * This is what makes a committed map safe to trust — an id it has never seen
 * fails loudly instead of silently resolving to the wrong variable.
 * @param {readonly { id: string }[]} bound - Observed bound values.
 * @param {{ byId?: Record<string, string>, ambiguous?: Record<string, string[]> }} idMap - Committed map.
 * @returns {{ names: string[], unknownIds: string[], ambiguousIds: Record<string, string[]> }} Resolution.
 */
export function resolveIds(bound, idMap) {
  const names = new Set();
  const unknownIds = new Set();
  const ambiguousIds = {};

  for (const entry of bound) {
    const name = idMap?.byId?.[entry.id];
    if (name) {
      names.add(name);
      continue;
    }
    const candidates = idMap?.ambiguous?.[entry.id];
    if (candidates) ambiguousIds[entry.id] = candidates;
    else unknownIds.add(entry.id);
  }

  return {
    names: [...names].sort(),
    unknownIds: [...unknownIds].sort(),
    ambiguousIds,
  };
}

/**
 * Map a variable name onto the repo's token vocabulary.
 *
 * Identity-ish by default (`a/b` → `a-b`) because the mapping is the project's
 * vocabulary, not Lisa's. `design.tokens.nameMap` overrides per name.
 * @param {Record<string, string>} [nameMap] - Configured overrides.
 * @returns {(name: string) => string} The mapper.
 */
export function tokenNamer(nameMap = {}) {
  return name => nameMap[name] ?? String(name).replaceAll("/", "-");
}

/**
 * Turn observations into findings for `design-intake-gate.mjs`.
 *
 * Every literal becomes a `hardcoded-in-design` finding regardless of axis —
 * the probe reports what it saw, and the gate applies the regime. Keeping the
 * regime decision in one place is what stops the two halves from disagreeing.
 * @param {{ bound: readonly object[], literal: readonly object[] }} observed - Observations.
 * @param {string} component - Human name of the subtree being implemented.
 * @returns {object[]} Findings.
 */
export function toFindings(observed, component) {
  const findings = observed.literal.map(entry => ({
    kind: "hardcoded-in-design",
    axis: entry.axis,
    component,
    value: entry.value,
    where: entry.where,
  }));
  for (const entry of observed.bound) {
    findings.push({ kind: "bound", axis: entry.axis, component });
  }
  return findings;
}

/**
 * Summarise coverage per axis.
 * @param {{ bound: readonly object[], literal: readonly object[] }} observed - Observations.
 * @returns {Record<string, { bound: number, literal: number, total: number, pct: number | null }>} Per-axis stats.
 */
export function summarise(observed) {
  const summary = {};
  for (const axis of PROBED_AXES) {
    const bound = observed.bound.filter(entry => entry.axis === axis).length;
    const literal = observed.literal.filter(
      entry => entry.axis === axis
    ).length;
    const total = bound + literal;
    summary[axis] = {
      bound,
      literal,
      total,
      pct: total === 0 ? null : (100 * bound) / total,
    };
  }
  return summary;
}

/**
 * Decide the probe's own verdict from its observations.
 *
 * The default threshold is the contract as written — 100%, so any literal in a
 * required axis fails. `--min` exists so that any relaxation is an explicit,
 * reviewable decision made on the command line, rather than a quiet softening
 * in code, which is the failure this probe was written to prevent.
 * @param {{
 *   summary: Record<string, { total: number, pct: number | null }>,
 *   unknownIds: readonly string[],
 *   ambiguousIds: Record<string, string[]>,
 *   required: readonly string[],
 *   min?: number
 * }} input - Probe state.
 * @returns {{ verdict: "PASS" | "BLOCK", owner: "design" | "us" | null, failing: string[] }} Verdict.
 */
export function judgeProbe(input) {
  const min = typeof input.min === "number" ? input.min : 100;
  const failing = input.required.filter(axis => {
    const stats = input.summary?.[axis];
    if (!stats || stats.total === 0) return false;
    return stats.pct < min;
  });

  const stale = input.unknownIds.length > 0;
  const unnameable = Object.keys(input.ambiguousIds).length > 0;

  if (failing.length > 0) return { verdict: "BLOCK", owner: "design", failing };
  if (stale || unnameable) return { verdict: "BLOCK", owner: "us", failing };
  return { verdict: "PASS", owner: null, failing };
}

/**
 * Decide whether this project has a design source to probe at all.
 *
 * Figma is optional and this is the single most important property of the
 * probe: most projects have no designs, and a mandatory gate on an absent
 * integration breaks every one of them on upgrade. Absence is SKIPPED, exit 0,
 * and said out loud — never a silent pass and never a block.
 * @param {{ design?: { tokens?: { source?: string } } }} config - Project config.
 * @param {Record<string, string | undefined>} env - Process environment.
 * @param {object | null} idMap - The committed map, or null when absent.
 * @returns {{ skip: true, reason: string } | { skip: false }} Whether to skip.
 */
export function skipReason(config, env, idMap) {
  if (!config?.design?.tokens?.source) {
    return {
      skip: true,
      reason:
        "no design source is configured (design.tokens.source) — this project has no designs to check against",
    };
  }
  if (!env?.FIGMA_ACCESS_TOKEN) {
    return {
      skip: true,
      reason:
        "FIGMA_ACCESS_TOKEN is not set — the design source cannot be read from here",
    };
  }
  if (!idMap) {
    return {
      skip: true,
      reason:
        "no committed variable-id map was found — run design-variable-ids.mjs once, interactively, to create it",
    };
  }
  return { skip: false };
}

/**
 * Read merged project config, local overriding global per key.
 * @returns {object} Parsed config, or {}.
 */
export function readProjectConfig() {
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
 * Load the committed variable-id map, or null when absent.
 * @param {string} path - Path to the map.
 * @returns {object | null} The map.
 */
export function readIdMap(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Render the operator-readable report.
 * @param {object} result - Probe result.
 * @returns {string} Report text.
 */
export function renderReport(result) {
  if (result.verdict === "SKIPPED") {
    return `design-bindings probe: SKIPPED — ${result.reason}`;
  }

  const lines = [`design-bindings probe: ${result.verdict}  ${result.nodeId}`];
  for (const [axis, stats] of Object.entries(result.summary)) {
    const pct = stats.pct === null ? " n/a " : `${stats.pct.toFixed(0)}%`;
    lines.push(
      `  ${axis.padEnd(8)} ${pct.padStart(5)}  bound ${stats.bound} / literal ${stats.literal}`
    );
  }

  if (result.owner === "us") {
    lines.push(
      "",
      "  This is OURS, not design's. These values ARE bound; our map cannot name them.",
      ...result.unknownIds.map(id => `    unknown   ${id}`),
      ...Object.entries(result.ambiguousIds).map(
        ([id, names]) => `    ambiguous ${id} → one of ${names.join(" | ")}`
      ),
      "  Regenerate with design-variable-ids.mjs. Do NOT guess which variable it is."
    );
  }

  if (result.owner === "design") {
    lines.push(
      "",
      `  BIND THESE (${result.bindList.length} distinct value(s), most frequent first):`,
      ...result.bindList
        .slice(0, 40)
        .map(
          entry =>
            `    ${String(entry.occurrences).padStart(4)}x  ${entry.value}`
        ),
      "",
      "  This is a block, not a warning. Do NOT snap them to the nearest variable."
    );
  }

  return lines.join("\n");
}

/**
 * Fetch one node subtree from the design source.
 * @param {string} fileKey - File key.
 * @param {string} nodeId - Node id — the subtree being implemented.
 * @param {string} token - Personal access token.
 * @returns {Promise<{ document: object } | { error: string }>} The node, or the failure.
 */
export async function fetchNode(fileKey, nodeId, token) {
  const url = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`;
  const response = await fetch(url, { headers: { "X-Figma-Token": token } });
  if (!response.ok) {
    const body = await response.text();
    return {
      error: `design source responded ${response.status}: ${body.slice(0, 300)}`,
    };
  }
  const payload = await response.json();
  const document = payload.nodes?.[nodeId]?.document;
  return document
    ? { document }
    : { error: `node ${nodeId} not found in file ${fileKey}` };
}

/**
 * Evaluate an already-fetched subtree. Pure — no network, no filesystem.
 * @param {{
 *   document: object,
 *   idMap: object,
 *   component?: string,
 *   namespaces?: Record<string, readonly string[]>,
 *   nameMap?: Record<string, string>,
 *   required?: readonly string[],
 *   min?: number
 * }} input - Everything the evaluation needs.
 * @returns {object} The probe result.
 */
export function evaluateSubtree(input) {
  const observed = collectValues(input.document);
  const { names, unknownIds, ambiguousIds } = resolveIds(
    observed.bound,
    input.idMap
  );
  const summary = summarise(observed);
  const required = input.required ?? PROBED_AXES;
  const { verdict, owner, failing } = judgeProbe({
    summary,
    unknownIds,
    ambiguousIds,
    required,
    min: input.min,
  });

  const occurrences = {};
  for (const entry of observed.literal) {
    const key = `${entry.axis}:${entry.value}`;
    occurrences[key] = (occurrences[key] ?? 0) + 1;
  }

  const namer = tokenNamer(input.nameMap);
  return {
    verdict,
    owner,
    failing,
    summary,
    unknownIds,
    ambiguousIds,
    regime: regimeFromVariableNames(
      Object.values(input.idMap?.byId ?? {}),
      input.namespaces
    ),
    findings: toFindings(observed, input.component ?? "this component"),
    tokensUsed: names.map(namer).sort(),
    bindList: Object.entries(occurrences)
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, occurrences: count })),
  };
}

/**
 * Parse `--flag=value` and `--flag value` argv forms.
 * @param {readonly string[]} argv - Arguments after the script name.
 * @returns {Map<string, string>} Parsed flags.
 */
function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      args.set(arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }
    const next = argv[index + 1];
    args.set(arg.slice(2), next && !next.startsWith("--") ? next : "true");
  }
  return args;
}

/**
 * CLI entrypoint.
 * @param {readonly string[]} argv - Arguments after the script name.
 * @param {Record<string, string | undefined>} [env] - Process environment.
 * @returns {Promise<number>} Process exit code.
 */
export async function runCli(argv, env = process.env) {
  const args = parseArgs(argv);
  const config = readProjectConfig();
  const mapPath =
    args.get("id-map") ??
    config.design?.tokens?.idMap ??
    "docs/design-system/figma-variable-ids.json";
  const idMap = readIdMap(mapPath);

  const skip = skipReason(config, env, idMap);
  if (skip.skip) {
    const result = { verdict: "SKIPPED", reason: skip.reason };
    process.stdout.write(
      args.get("json") === "true"
        ? `${JSON.stringify(result, null, 2)}\n`
        : `${renderReport(result)}\n`
    );
    return 0;
  }

  const fileKey = args.get("file") ?? config.design?.tokens?.source;
  const nodeId = args.get("node");
  if (!fileKey || !nodeId) {
    process.stderr.write(
      "usage: design-bindings-probe.mjs --file <key> --node <id> [--json] [--require color,spacing,radius] [--min 100]\n" +
        "note: --node must be the SUBTREE you are implementing, not the enclosing screen frame.\n"
    );
    return 2;
  }

  const fetched = await fetchNode(fileKey, nodeId, env.FIGMA_ACCESS_TOKEN);
  if (fetched.error) {
    process.stderr.write(`design-bindings probe: ${fetched.error}\n`);
    return 2;
  }

  const result = {
    ...evaluateSubtree({
      document: fetched.document,
      idMap,
      component: args.get("component") ?? fetched.document.name,
      namespaces: config.design?.tokens?.namespaces,
      nameMap: config.design?.tokens?.nameMap,
      required: args
        .get("require")
        ?.split(",")
        .map(part => part.trim()),
      min: args.has("min") ? Number(args.get("min")) : undefined,
    }),
    fileKey,
    nodeId,
  };

  process.stdout.write(
    args.get("json") === "true"
      ? `${JSON.stringify(result, null, 2)}\n`
      : `${renderReport(result)}\n`
  );
  return result.verdict === "PASS" ? 0 : 1;
}

/**
 * True when `moduleUrl` names the module node was asked to run.
 *
 * Both sides are realpath'd. Reached through a symlinked checkout, a git
 * worktree, or a `/tmp` path on macOS the naive comparisons disagree, the body
 * never runs, and the process exits 0 having done nothing — and every
 * Lisa-driven agent runs in a worktree, so that is the routine path.
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
  process.exit(await runCli(process.argv.slice(2)));
}
