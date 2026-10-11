#!/usr/bin/env node
/**
 * Interactive one-off: build the committed `VariableID → variable name` map
 * that lets `design-bindings-probe.mjs` run headlessly forever after.
 *
 * WHY A COMMITTED MAP EXISTS AT ALL
 * ---------------------------------
 * Enforcing "values come from design variables" headlessly needs variable
 * NAMES. Both routes to a name are unusable on their own, and this is measured:
 *
 *   - The Variables REST API (`/v1/files/:key/variables/local`) returns names
 *     directly but is **Enterprise-plan only**. The read scope is not offered
 *     in the token scope picker on other plans, so no token change unlocks it.
 *   - The design-tool MCP (`get_variable_defs`) returns names on every plan but
 *     authenticates by **browser OAuth**, which cron and CI cannot perform.
 *
 * What IS available headlessly is `/v1/files/:key/nodes`, which reports each
 * bound property as an opaque `VariableID:106:15`. That id→name mapping is
 * **static**, so it is resolved ONCE here, interactively, and committed. The
 * headless probe then needs only the access token.
 *
 * HOW THE JOIN WORKS
 * ------------------
 * ```
 * MCP  get_variable_defs → { name: value }        per node, per mode
 * REST /nodes            → { VariableID: value }  per bound property, per mode
 * ```
 * Joining on value alone is ambiguous wherever two variables share a value — a
 * foreground and a surface variable are both `#ffffff` in light mode. Three
 * signals separate them:
 *
 * 1. **property kind** — a padding can only bind a spacing variable, a radius
 *    only a radius variable;
 * 2. **light + dark signature** — same-valued variables in light mode diverge
 *    in dark, so the `(light, dark)` pair separates them. This is the signal
 *    that takes the map to complete;
 * 3. **single occupancy** — a node containing exactly one tied id and exactly
 *    one tied name forces that pairing, because no other candidate is present
 *    to claim it.
 *
 * STALENESS IS SELF-DETECTING. If design adds or renames a variable, an
 * unknown id shows up in a headless read and the probe fails loudly telling you
 * to re-run this. It cannot silently drift into resolving the wrong variable —
 * that property is the whole reason a committed map is safe to trust.
 *
 * Usage:
 *   FIGMA_ACCESS_TOKEN=… FIGMA_MCP_TOKEN=… node design-variable-ids.mjs \
 *     --file <fileKey> --light <n1,n2,…> [--dark <n1,n2,…>] [--out <path>]
 * @module design-variable-ids
 */
import { writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MCP_URL = "https://mcp.figma.com/mcp";

/**
 * Variable namespaces each bound property may legitimately reference. Narrowing
 * the candidate set by property kind is the cheapest of the three signals and
 * removes most collisions before the value join runs at all.
 */
export const KIND_NAMESPACES = {
  "fills:text": ["content/", "accent/", "status/", "chart/"],
  "fills:box": ["surface/", "accent/", "status/", "chart/", "content/"],
  strokes: ["outline/", "content/", "status/", "accent/", "chart/"],
  paddingLeft: ["space/"],
  paddingRight: ["space/"],
  paddingTop: ["space/"],
  paddingBottom: ["space/"],
  itemSpacing: ["space/"],
  counterAxisSpacing: ["space/"],
  cornerRadius: ["radius/"],
  topLeftRadius: ["radius/"],
  topRightRadius: ["radius/"],
  bottomLeftRadius: ["radius/"],
  bottomRightRadius: ["radius/"],
  rectangleCornerRadii: ["radius/"],
};

/**
 * Score every candidate name for one observed id.
 *
 * A candidate survives only if it agrees with the observed value in **every**
 * mode where both are known — one disagreement eliminates it outright. Among
 * survivors, a match confirmed in both modes outranks a light-only match,
 * because a light-only agreement is exactly the coincidence that produces a
 * wrong map.
 * @param {{
 *   slots: Map<string, { light?: string, dark?: string }>,
 *   names: readonly string[],
 *   valuesLight: Record<string, unknown>,
 *   valuesDark: Record<string, unknown>
 * }} input - The join inputs for one id.
 * @returns {[string, number][]} Candidates, best first.
 */
export function scoreCandidates(input) {
  const scores = new Map();
  const normalise = value =>
    value === undefined ? undefined : String(value).toLowerCase();

  for (const [slot, observed] of input.slots) {
    const allowed = KIND_NAMESPACES[slot];
    for (const name of input.names) {
      if (allowed && !allowed.some(prefix => name.startsWith(prefix))) continue;
      const nameLight = normalise(input.valuesLight[name]);
      const nameDark = normalise(input.valuesDark[name]);
      if (
        observed.light !== undefined &&
        nameLight !== undefined &&
        observed.light !== nameLight
      )
        continue;
      if (
        observed.dark !== undefined &&
        nameDark !== undefined &&
        observed.dark !== nameDark
      )
        continue;
      if (observed.light === undefined && observed.dark === undefined) continue;

      const bothModes =
        observed.light !== undefined &&
        observed.dark !== undefined &&
        nameLight !== undefined &&
        nameDark !== undefined;
      scores.set(name, (scores.get(name) ?? 0) + (bothModes ? 10 : 1));
    }
  }

  return [...scores.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Classify one id's ranked candidates into resolved, ambiguous, or unresolved.
 *
 * A tie is **ambiguous**, never resolved by picking the first. Guessing which
 * of two variables a value came from is precisely what the contract forbids,
 * and a map that guessed would be worse than no map — it would resolve
 * confidently and wrongly.
 * @param {readonly [string, number][]} ranked - Scored candidates, best first.
 * @returns {{ kind: "resolved", name: string } | { kind: "ambiguous", names: string[] } | { kind: "unresolved" }} Classification.
 */
export function classifyCandidates(ranked) {
  if (ranked.length === 0) return { kind: "unresolved" };
  if (ranked.length === 1 || ranked[0][1] > ranked[1][1]) {
    return { kind: "resolved", name: ranked[0][0] };
  }
  const top = ranked[0][1];
  return {
    kind: "ambiguous",
    names: ranked.filter(entry => entry[1] === top).map(entry => entry[0]),
  };
}

/**
 * Settle remaining ties by single occupancy.
 *
 * When some node contains exactly one of the tied ids and exactly one of the
 * tied names, the pairing is forced: no other candidate is present to claim the
 * name. Corroboration across nodes makes it evidence rather than inference, and
 * a single contradicting node abandons the attempt rather than voting.
 * @param {Record<string, string[]>} ambiguous - id → tied candidate names.
 * @param {Map<string, Set<string>>} idsPerNode - nodeId → ids present.
 * @param {Map<string, Set<string>>} namesPerNode - nodeId → names present.
 * @returns {{ resolved: Record<string, string>, evidence: Record<string, string[]> }} Forced pairings.
 */
export function disambiguateBySingleOccupancy(
  ambiguous,
  idsPerNode,
  namesPerNode
) {
  const resolved = {};
  const evidence = {};

  for (const [id, names] of Object.entries(ambiguous)) {
    const tiedIds = Object.entries(ambiguous)
      .filter(
        ([, candidates]) =>
          candidates.length === names.length &&
          candidates.every(name => names.includes(name))
      )
      .map(([tiedId]) => tiedId);

    const votes = new Map();
    for (const [nodeId, idsHere] of idsPerNode) {
      const idsPresent = tiedIds.filter(tied => idsHere.has(tied));
      const namesPresent = names.filter(name =>
        namesPerNode.get(nodeId)?.has(name)
      );
      if (idsPresent.length !== 1 || namesPresent.length !== 1) continue;
      if (idsPresent[0] !== id) continue;
      votes.set(namesPresent[0], [
        ...(votes.get(namesPresent[0]) ?? []),
        nodeId,
      ]);
    }

    // More than one distinct winner means the nodes disagree. Abandon, do not
    // vote — a majority among contradictory evidence is still a guess.
    if (votes.size !== 1) continue;
    const [name, nodes] = [...votes][0];
    resolved[id] = name;
    evidence[id] = nodes;
  }

  return { resolved, evidence };
}

/**
 * Build the full map from already-gathered observations. Pure — no network.
 * @param {{
 *   observed: Map<string, Map<string, { light?: string, dark?: string }>>,
 *   valuesLight: Record<string, unknown>,
 *   valuesDark: Record<string, unknown>,
 *   idsPerNode?: Map<string, Set<string>>,
 *   namesPerNode?: Map<string, Set<string>>
 * }} input - Observations from both modes.
 * @returns {{ byId: Record<string, string>, ambiguous: Record<string, string[]>, unresolved: string[], evidence: Record<string, string[]> }} The map.
 */
export function buildIdMap(input) {
  const names = [
    ...new Set([
      ...Object.keys(input.valuesLight),
      ...Object.keys(input.valuesDark),
    ]),
  ];

  const byId = {};
  const ambiguous = {};
  const unresolved = [];

  for (const [id, slots] of input.observed) {
    const ranked = scoreCandidates({
      slots,
      names,
      valuesLight: input.valuesLight,
      valuesDark: input.valuesDark,
    });
    const classified = classifyCandidates(ranked);
    if (classified.kind === "resolved") byId[id] = classified.name;
    else if (classified.kind === "ambiguous") ambiguous[id] = classified.names;
    else unresolved.push(id);
  }

  const { resolved, evidence } = disambiguateBySingleOccupancy(
    ambiguous,
    input.idsPerNode ?? new Map(),
    input.namesPerNode ?? new Map()
  );
  for (const [id, name] of Object.entries(resolved)) {
    byId[id] = name;
    delete ambiguous[id];
  }

  return { byId, ambiguous, unresolved, evidence };
}

/**
 * @param {{ r: number, g: number, b: number }} color - Colour triple.
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
 * Call one design-tool MCP tool over HTTP, parsing the SSE envelope.
 * @param {string} token - OAuth access token from the interactive session.
 * @param {string} tool - Tool name.
 * @param {object} args - Tool arguments.
 * @returns {Promise<string | null>} Concatenated text content, or null.
 */
async function callMcp(token, tool, args) {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  const raw = await response.text();
  const dataLines = raw.split("\n").filter(line => line.startsWith("data:"));
  if (dataLines.length === 0) return null;
  try {
    const payload = JSON.parse(dataLines[dataLines.length - 1].slice(5).trim());
    return (payload.result?.content ?? [])
      .map(part => part.text ?? "")
      .join("");
  } catch {
    // probe-direction: neutral — this is a design-token lookup for a generator;
    // no gate reads the result, and null renders as a missing token.
    return null;
  }
}

/**
 * Fetch variable name → value for one mode's reference nodes.
 * @param {string} token - MCP token.
 * @param {string} fileKey - File key.
 * @param {readonly string[]} nodeIds - Reference nodes for this mode.
 * @returns {Promise<{ values: Record<string, unknown>, perNode: Map<string, Set<string>> }>} Names by mode.
 */
async function namesForMode(token, fileKey, nodeIds) {
  const values = {};
  const perNode = new Map();
  for (const nodeId of nodeIds) {
    const text = await callMcp(token, "get_variable_defs", { fileKey, nodeId });
    if (!text?.trim().startsWith("{")) continue;
    try {
      const defs = JSON.parse(text);
      Object.assign(values, defs);
      perNode.set(nodeId, new Set(Object.keys(defs)));
    } catch {
      // A node with no variables answers in prose rather than JSON. Skip it.
    }
  }
  return { values, perNode };
}

/**
 * Fetch node documents in chunks.
 * @param {string} token - Access token.
 * @param {string} fileKey - File key.
 * @param {readonly string[]} nodeIds - Node ids.
 * @returns {Promise<Record<string, object>>} Node entries by id.
 */
async function restNodes(token, fileKey, nodeIds) {
  const out = {};
  for (let index = 0; index < nodeIds.length; index += 8) {
    const chunk = nodeIds.slice(index, index + 8);
    const response = await fetch(
      `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${chunk.join(",")}`,
      { headers: { "X-Figma-Token": token } }
    );
    if (!response.ok) {
      throw new Error(
        `design source responded ${response.status} for ${chunk.join(",")}`
      );
    }
    Object.assign(out, (await response.json()).nodes ?? {});
  }
  return out;
}

/**
 * Resolve the observed value for one bound reference on one node.
 * @param {object} node - The node.
 * @param {string} property - Bound property.
 * @param {number} index - Position within an array-valued property.
 * @returns {{ slot: string, value: string } | null} Observation.
 */
function observationFor(node, property, index) {
  if (property === "fills" || property === "strokes") {
    const paints = node[property] ?? [];
    const paint = paints[index] ?? paints[0];
    if (!paint?.color) return null;
    const slot =
      property === "fills"
        ? node.type === "TEXT"
          ? "fills:text"
          : "fills:box"
        : "strokes";
    return { slot, value: hexOf(paint.color) };
  }
  if (typeof node[property] === "number") {
    return { slot: property, value: String(node[property]) };
  }
  if (
    property === "rectangleCornerRadii" &&
    Array.isArray(node.rectangleCornerRadii)
  ) {
    const value =
      node.rectangleCornerRadii[index] ?? node.rectangleCornerRadii[0];
    return { slot: property, value: String(value) };
  }
  if (typeof node.cornerRadius === "number" && property.endsWith("Radii")) {
    return { slot: property, value: String(node.cornerRadius) };
  }
  return null;
}

/**
 * Walk fetched documents recording each id's observed value per slot.
 * @param {Record<string, object>} documents - Node entries.
 * @param {"light" | "dark"} mode - Which mode these nodes render.
 * @param {Map<string, Map<string, object>>} observed - Accumulator.
 * @param {Map<string, Set<string>>} idsPerNode - Accumulator.
 * @returns {void}
 */
function recordObservations(documents, mode, observed, idsPerNode) {
  for (const [rootId, entry] of Object.entries(documents)) {
    idsPerNode.set(rootId, idsPerNode.get(rootId) ?? new Set());
    const stack = [entry?.document];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      for (const [property, ref] of Object.entries(node.boundVariables ?? {})) {
        const refs = Array.isArray(ref)
          ? ref
          : ref && typeof ref === "object" && !ref.id
            ? Object.values(ref)
            : [ref];
        refs.forEach((one, index) => {
          if (!one?.id) return;
          idsPerNode.get(rootId).add(one.id);
          const observation = observationFor(node, property, index);
          if (!observation) return;
          if (!observed.has(one.id)) observed.set(one.id, new Map());
          const slots = observed.get(one.id);
          const existing = slots.get(observation.slot) ?? {};
          slots.set(observation.slot, {
            ...existing,
            [mode]: observation.value.toLowerCase(),
          });
        });
      }
      for (const child of node.children ?? []) stack.push(child);
    }
  }
}

/**
 * @param {readonly string[]} argv - Arguments after the script name.
 * @returns {Map<string, string>} Parsed flags.
 */
function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) args.set(arg.slice(2, eq), arg.slice(eq + 1));
    else {
      const next = argv[index + 1];
      args.set(arg.slice(2), next && !next.startsWith("--") ? next : "true");
    }
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
  const fileKey = args.get("file");
  const light = (args.get("light") ?? "").split(",").filter(Boolean);
  const dark = (args.get("dark") ?? "").split(",").filter(Boolean);
  const out = args.get("out") ?? "docs/design-system/figma-variable-ids.json";

  if (
    !env.FIGMA_ACCESS_TOKEN ||
    !env.FIGMA_MCP_TOKEN ||
    !fileKey ||
    light.length === 0
  ) {
    process.stderr.write(
      "usage: FIGMA_ACCESS_TOKEN=… FIGMA_MCP_TOKEN=… design-variable-ids.mjs " +
        "--file <key> --light <n1,n2,…> [--dark <n1,n2,…>] [--out <path>]\n" +
        "This step is INTERACTIVE by necessity: the MCP token comes from a browser OAuth session.\n" +
        "Pass --dark as well wherever the library has a dark mode — the light+dark signature is\n" +
        "what separates variables that share a value, and without it more ids stay ambiguous.\n"
    );
    return 2;
  }

  const observed = new Map();
  const idsPerNode = new Map();
  const namesPerNode = new Map();

  const lightNames = await namesForMode(env.FIGMA_MCP_TOKEN, fileKey, light);
  recordObservations(
    await restNodes(env.FIGMA_ACCESS_TOKEN, fileKey, light),
    "light",
    observed,
    idsPerNode
  );
  for (const [nodeId, names] of lightNames.perNode)
    namesPerNode.set(nodeId, names);

  const darkNames =
    dark.length > 0
      ? await namesForMode(env.FIGMA_MCP_TOKEN, fileKey, dark)
      : { values: {}, perNode: new Map() };
  if (dark.length > 0) {
    recordObservations(
      await restNodes(env.FIGMA_ACCESS_TOKEN, fileKey, dark),
      "dark",
      observed,
      idsPerNode
    );
  }
  for (const [nodeId, names] of darkNames.perNode)
    namesPerNode.set(nodeId, names);

  const map = buildIdMap({
    observed,
    valuesLight: lightNames.values,
    valuesDark: darkNames.values,
    idsPerNode,
    namesPerNode,
  });

  writeFileSync(
    out,
    `${JSON.stringify(
      {
        $comment:
          "VariableID -> variable name. Generated by design-variable-ids.mjs. Lets " +
          "design-bindings-probe.mjs resolve which variable a layer uses HEADLESSLY with only " +
          "FIGMA_ACCESS_TOKEN — the Variables REST API is Enterprise-only and the design-tool MCP " +
          "needs browser OAuth, so neither works in CI or cron. Regenerate when design adds or " +
          "renames variables; an unknown id makes the probe fail loudly rather than resolve the " +
          "wrong variable.",
        $fileKey: fileKey,
        $generatedFrom: { light, dark },
        $disambiguatedBySingleOccupancy: map.evidence,
        byId: map.byId,
        ambiguous: map.ambiguous,
        unresolved: map.unresolved,
      },
      null,
      2
    )}\n`
  );

  process.stderr.write(
    `resolved   : ${Object.keys(map.byId).length}\n` +
      `ambiguous  : ${Object.keys(map.ambiguous).length}\n` +
      `unresolved : ${map.unresolved.length}\n` +
      `wrote ${out}\n`
  );
  return 0;
}

/**
 * True when `moduleUrl` names the module node was asked to run.
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
