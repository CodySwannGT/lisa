#!/usr/bin/env node
/**
 * Deterministic validator for the plugin-parity routing artifacts written by the
 * `analyze-plugin` skill (issue #1059, productionized in #12).
 *
 * It gates `parity/plugin-routing/*.json` against the analyze-plugin schema and
 * a set of anti-pattern checks so the parity gaps fixed during review cannot
 * silently regress. `analyze-plugin` runs it as a Definition-of-Done gate and
 * `implement-plugin-parity` runs it pre-flight before acting on an approved
 * artifact.
 *
 * Determinism guarantees (so the unit test is reproducible and CI is stable):
 *   - zero third-party dependencies (Node built-ins only),
 *   - no network access,
 *   - no `Date` / `Math.random` — the upstream version is resolved purely from
 *     the installed plugin cache (manifest `version`, else a semver dir name).
 *
 * The routing dir and cache root are injectable via flags so tests point at a
 * committed fixture instead of the machine's real `~/.claude/plugins/cache`.
 *
 * CLI:
 *   node scripts/plugin-routing-validate.mjs [--routing-dir <dir>] [--cache-root <dir>] [--json]
 *
 * Exit codes:
 *   0 — every artifact is valid.
 *   1 — ≥1 artifact failed validation.
 *   2 — operational/usage error: unknown flag, a flag missing its value, the
 *       routing dir absent, or a filesystem error during the scan.
 *
 * The semver primitives are shared with the drift detector to keep a single
 * source of truth for version parsing/comparison.
 *
 * @module scripts/plugin-routing-validate
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  compareSemver,
  isDirectory,
  isValidSemver,
  resolveCurrentVersion,
} from "./lib/plugin-cache-resolution.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** The non-Claude-native agents that every routing block must cover, exactly. */
const AGENTS = ["agy", "codex", "copilot", "cursor"];

/** The locked routing-outcome enum. */
const OUTCOMES = new Set([
  "already-native",
  "claude-only",
  "enable-vendor-equivalent",
  "re-point-mcp-lsp",
  "reimplement",
]);

/** Valid component `kind` values. */
const KINDS = new Set(["agent", "command", "hook", "lsp", "mcp", "skill"]);

/** Valid component `classification` values. */
const CLASSES = new Set([
  "claude-agent",
  "claude-command",
  "claude-skill",
  "hook",
  "lsp-server",
  "mcp-server",
]);

/** Valid artifact `status` values. */
const STATUSES = new Set(["approved", "proposed"]);

/** Max characters of an offending action quoted back in an error message. */
const QUOTE_LEN = 60;

/**
 * Usage error — thrown by `parseArgs` for an invalid invocation so `main` can
 * distinguish it (exit 2) from a validation failure (exit 1).
 */
export class UsageError extends Error {}

/**
 * The max semver across a plugin's LIVE cache version subdirs, or `null`.
 *
 * This used to walk the cache itself while importing only the semver helpers
 * from the drift detector, which made the two scripts look like one resolver
 * and behave like two. They disagreed about orphans: the detector was fixed to
 * skip `.orphaned_at` directories (CodySwannGT/lisa#3085) and this walk was
 * not, so it went on resolving a "current" version out of directories that were
 * uninstalled ten days earlier — and the import argued the fix was already
 * applied here (CodySwannGT/lisa#3093).
 *
 * It now calls the one resolver. `dirNameFallback` is this caller's single
 * genuine difference, and it is named rather than implied: a semver DIRECTORY
 * NAME stands in when a live version's manifest carries no usable `version`,
 * which the drift detector deliberately does not do.
 *
 * ## Why both non-`ok` statuses collapse to `null` here
 *
 * The resolver distinguishes `not-installed` (no live directory at all) from
 * `unresolved` (a live directory whose manifest will not parse), and that
 * distinction is load-bearing in the detector's report. This caller has one
 * question — "is there a version to compare against?" — and both answers are
 * "no". The collapse is deliberate and local; the states stay distinct in the
 * resolver so the detector can keep telling them apart.
 *
 * @param {string} cacheRoot - the installed-plugin cache root.
 * @param {string} name - plugin name.
 * @param {string} marketplace - marketplace id.
 * @returns {string | null} the max live semver, or `null`.
 */
export function cacheMaxVersion(cacheRoot, name, marketplace) {
  const resolved = resolveCurrentVersion(cacheRoot, name, marketplace, {
    dirNameFallback: true,
  });
  return resolved.status === "ok" ? resolved.version : null;
}

/**
 * Validate the `upstreamVersion` against the resolved cache max (§ version
 * contract): a semver value must equal the cache max; `"unknown"` is valid only
 * when the cache has no semver anywhere.
 *
 * A semver `upstreamVersion` with NO semver in the cache is deliberately not an
 * error. It means THIS machine cannot see the plugin (fresh clone, CI runner,
 * plugin uninstalled) — not that the artifact is wrong. `isVersionUnverifiable`
 * reports that state separately so the caller can warn instead of blocking,
 * mirroring how the drift detector treats `not-installed` (issue #2552). Every
 * other gate — schema, routing, coverage, anti-patterns — still runs, so a
 * cacheless machine validates strictly more than it used to.
 *
 * @param {unknown} upstreamVersion - the artifact's `upstreamVersion`.
 * @param {string | null} cacheMax - resolved max semver, or null.
 * @returns {string[]} validation error messages (empty when valid).
 */
function validateVersion(upstreamVersion, cacheMax) {
  if (upstreamVersion === "unknown") {
    return cacheMax === null
      ? []
      : [`upstreamVersion "unknown" but the cache has semver ${cacheMax}`];
  }
  if (typeof upstreamVersion !== "string" || !isValidSemver(upstreamVersion)) {
    return [
      `upstreamVersion must be semver or "unknown" (got ${String(upstreamVersion)})`,
    ];
  }
  if (cacheMax === null) {
    return [];
  }
  if (compareSemver(upstreamVersion, cacheMax) !== 0) {
    return [`upstreamVersion ${upstreamVersion} != cache max ${cacheMax}`];
  }
  return [];
}

/**
 * True iff the artifact pins a semver `upstreamVersion` that this machine has
 * no cached copy to confirm against. A cache-visibility fact, not a contract
 * violation — reported so the push gate can warn without blocking.
 *
 * @param {unknown} upstreamVersion - the artifact's `upstreamVersion`.
 * @param {string | null} cacheMax - resolved max semver, or null.
 * @returns {boolean} whether the version claim is unverifiable here.
 */
export function isVersionUnverifiable(upstreamVersion, cacheMax) {
  return cacheMax === null && isValidSemver(upstreamVersion);
}

/**
 * Validate one component entry.
 *
 * @param {Record<string, unknown>} component - a `components[]` entry.
 * @returns {string[]} validation error messages (empty when valid).
 */
function validateComponent(component) {
  const errors = [];
  if (component === null || typeof component !== "object") {
    return ["component is not an object"];
  }
  if (!KINDS.has(component.kind)) {
    errors.push(`component kind invalid: ${String(component.kind)}`);
  }
  if (!CLASSES.has(component.classification)) {
    errors.push(
      `component classification invalid: ${String(component.classification)}`
    );
  }
  if (
    typeof component.id !== "string" ||
    component.id === "" ||
    typeof component.path !== "string" ||
    component.path === ""
  ) {
    errors.push("component is missing a non-empty id and path");
  }
  return errors;
}

/**
 * Validate one agent's action list: no unparseable `@unknown` pin, no
 * "not addressed" cop-out, and a `reimplement` with a semver upstream must carry
 * the `synced-from` stamp.
 *
 * @param {string} agent - the agent key.
 * @param {Record<string, unknown>} entry - the routing entry.
 * @param {string} plugin - the canonical plugin id.
 * @param {unknown} upstreamVersion - the artifact's `upstreamVersion`.
 * @returns {string[]} validation error messages (empty when valid).
 */
function validateActions(agent, entry, plugin, upstreamVersion) {
  const errors = [];
  const actions = Array.isArray(entry.actions) ? entry.actions : [];
  for (const action of actions) {
    const text = String(action);
    if (/@unknown\b/.test(text)) {
      errors.push(
        `routing.${agent} action carries an unparseable @unknown pin: "${truncate(text)}"`
      );
    }
    if (/not\s+addressed/i.test(text)) {
      errors.push(
        `routing.${agent} action flags a component "not addressed" (cover it, do not flag): "${truncate(text)}"`
      );
    }
  }
  if (entry.outcome === "reimplement" && upstreamVersion !== "unknown") {
    const stamp = `synced-from: ${plugin}@${String(upstreamVersion)}`;
    if (!actions.some(action => String(action).includes(stamp))) {
      errors.push(
        `routing.${agent} reimplement actions must include the stamp "${stamp}"`
      );
    }
  }
  return errors;
}

/**
 * Validate the routing block: exactly the four agent keys, each with a valid
 * outcome, an actions array, a non-empty rationale, and clean actions.
 *
 * @param {unknown} routing - the artifact's `routing` object.
 * @param {string} plugin - the canonical plugin id.
 * @param {unknown} upstreamVersion - the artifact's `upstreamVersion`.
 * @returns {string[]} validation error messages (empty when valid).
 */
function validateRouting(routing, plugin, upstreamVersion) {
  if (routing === null || typeof routing !== "object") {
    return ["routing must be an object covering agy,codex,copilot,cursor"];
  }
  const errors = [];
  const keys = Object.keys(routing).sort();
  if (keys.join(",") !== [...AGENTS].sort().join(",")) {
    errors.push(
      `routing must have exactly agy,codex,copilot,cursor (got ${keys.join(",") || "none"})`
    );
  }
  for (const agent of AGENTS) {
    const entry = routing[agent];
    if (entry === null || entry === undefined || typeof entry !== "object") {
      errors.push(`routing.${agent} is missing`);
      continue;
    }
    if (!OUTCOMES.has(entry.outcome)) {
      errors.push(`routing.${agent} outcome invalid: ${String(entry.outcome)}`);
    }
    if (!Array.isArray(entry.actions)) {
      errors.push(`routing.${agent}.actions must be an array`);
    }
    if (typeof entry.rationale !== "string" || entry.rationale === "") {
      errors.push(`routing.${agent}.rationale must be a non-empty string`);
    }
    errors.push(...validateActions(agent, entry, plugin, upstreamVersion));
  }
  return errors;
}

/**
 * True iff at least one of `lowerActions` references `kind` — either by the kind
 * keyword itself (case-insensitive) or by the id of any component of that kind.
 *
 * @param {string} kind - the component kind (e.g. "mcp", "agent").
 * @param {ReadonlyArray<Record<string, unknown>>} typedComponents - components with a string kind.
 * @param {readonly string[]} lowerActions - the agent's actions, lowercased.
 * @returns {boolean} whether the kind group is referenced.
 */
function isKindCovered(kind, typedComponents, lowerActions) {
  const kindLower = kind.toLowerCase();
  const ids = typedComponents
    .filter(c => c.kind === kind)
    .map(c => c.id)
    .filter(id => typeof id === "string" && id !== "")
    .map(id => id.toLowerCase());
  return lowerActions.some(
    action => action.includes(kindLower) || ids.some(id => action.includes(id))
  );
}

/**
 * Positively enforce the "drop nothing" rule: every distinct component kind must
 * be covered by each agent that actually has to act on it. Agents whose outcome
 * is `already-native` (covered by the existing fan-out) or `claude-only`
 * (intentionally nothing) are exempt; every other outcome must reference every
 * component group in its actions.
 *
 * @param {unknown} components - the artifact's `components` array.
 * @param {unknown} routing - the artifact's `routing` object.
 * @returns {string[]} validation error messages (empty when valid).
 */
function validateCoverage(components, routing) {
  if (
    !Array.isArray(components) ||
    routing === null ||
    typeof routing !== "object"
  ) {
    return [];
  }
  const typed = components.filter(
    c => c !== null && typeof c === "object" && typeof c.kind === "string"
  );
  const distinctKinds = [...new Set(typed.map(c => c.kind))];
  const errors = [];
  for (const agent of AGENTS) {
    const entry = routing[agent];
    if (entry === null || entry === undefined || typeof entry !== "object") {
      continue;
    }
    if (entry.outcome === "already-native" || entry.outcome === "claude-only") {
      continue;
    }
    const lowerActions = (
      Array.isArray(entry.actions) ? entry.actions : []
    ).map(action => String(action).toLowerCase());
    for (const kind of distinctKinds) {
      if (!isKindCovered(kind, typed, lowerActions)) {
        errors.push(
          `routing.${agent}: no action covers component group ${kind}`
        );
      }
    }
  }
  return errors;
}

/**
 * Validate a parsed routing artifact against the analyze-plugin schema + the
 * version contract + anti-pattern gates. Pure — all filesystem facts are passed
 * in via `context`, so it is directly unit-testable.
 *
 * @param {unknown} artifact - the parsed JSON artifact.
 * @param {{ filename?: string, cacheMax: string | null, mdExists: boolean }} context
 *   the resolved filesystem facts.
 * @returns {string[]} validation error messages (empty when valid).
 */
export function validateArtifact(artifact, context) {
  if (artifact === null || typeof artifact !== "object") {
    return ["artifact is not a JSON object"];
  }
  const { cacheMax, filename, mdExists } = context;
  const errors = [];
  if (artifact.schemaVersion !== 1) {
    errors.push(
      `schemaVersion must be 1 (got ${String(artifact.schemaVersion)})`
    );
  }
  if (!STATUSES.has(artifact.status)) {
    errors.push(
      `status must be one of proposed|approved (got ${String(artifact.status)})`
    );
  }
  if (artifact.plugin !== `${artifact.pluginName}@${artifact.marketplace}`) {
    errors.push("plugin must equal pluginName@marketplace");
  }
  if (filename !== undefined && `${artifact.plugin}.json` !== filename) {
    errors.push(`filename must equal <plugin>.json (file is ${filename})`);
  }
  errors.push(...validateVersion(artifact.upstreamVersion, cacheMax));
  if (!Array.isArray(artifact.components) || artifact.components.length === 0) {
    errors.push("components must be a non-empty array");
  } else {
    for (const component of artifact.components) {
      errors.push(...validateComponent(component));
    }
  }
  errors.push(
    ...validateRouting(
      artifact.routing,
      artifact.plugin,
      artifact.upstreamVersion
    )
  );
  errors.push(...validateCoverage(artifact.components, artifact.routing));
  if (mdExists === false) {
    errors.push("paired .md companion file is missing");
  }
  return errors;
}

/**
 * Truncate a string for inclusion in an error message.
 *
 * @param {string} text - the source string.
 * @returns {string} `text` clipped to QUOTE_LEN characters.
 */
function truncate(text) {
  return text.length > QUOTE_LEN ? `${text.slice(0, QUOTE_LEN)}…` : text;
}

/**
 * Validate a single artifact file: parse it, resolve its cache max + paired-md
 * existence, and return the per-file result.
 *
 * @param {string} routingDir - the routing directory.
 * @param {string} file - the artifact filename (`*.json`).
 * @param {string} cacheRoot - the installed-plugin cache root.
 * @returns {{ file: string, errors: string[], unverifiable: boolean }}
 *   the per-file result. `unverifiable` means the version claim could not be
 *   confirmed on this machine; it never blocks.
 */
function validateFile(routingDir, file, cacheRoot) {
  let artifact;
  try {
    artifact = JSON.parse(fs.readFileSync(path.join(routingDir, file), "utf8"));
  } catch (error) {
    return {
      errors: [`invalid JSON: ${error.message}`],
      file,
      unverifiable: false,
    };
  }
  const hasIds =
    artifact !== null &&
    typeof artifact === "object" &&
    typeof artifact.pluginName === "string" &&
    typeof artifact.marketplace === "string";
  const cacheMax = hasIds
    ? cacheMaxVersion(cacheRoot, artifact.pluginName, artifact.marketplace)
    : null;
  const mdExists = fs.existsSync(
    path.join(routingDir, file.replace(/\.json$/, ".md"))
  );
  const errors = validateArtifact(artifact, {
    cacheMax,
    filename: file,
    mdExists,
  });
  const upstreamVersion =
    artifact !== null && typeof artifact === "object"
      ? artifact.upstreamVersion
      : undefined;
  return {
    errors,
    file,
    unverifiable: isVersionUnverifiable(upstreamVersion, cacheMax),
  };
}

/**
 * Assemble the machine-readable report.
 *
 * @param {ReadonlyArray<{ file: string, errors: string[], unverifiable?: boolean }>} results - per-file results.
 * @param {{ cacheRoot: string, routingDir: string }} opts - resolved options.
 * @returns {Record<string, unknown>} the report object.
 */
export function buildReport(results, opts) {
  const invalid = results.filter(r => r.errors.length > 0).length;
  return {
    cacheRoot: opts.cacheRoot,
    results,
    routingDir: opts.routingDir,
    schemaVersion: 1,
    summary: {
      invalid,
      scanned: results.length,
      unverifiable: results.filter(r => r.unverifiable === true).length,
      valid: results.length - invalid,
    },
  };
}

/**
 * Render the human-readable report.
 *
 * @param {{ results: ReadonlyArray<{ file: string, errors: string[], unverifiable?: boolean }>, summary: { scanned: number, valid: number, invalid: number, unverifiable: number } }} report - report object.
 * @returns {string} the rendered report.
 */
function humanReport(report) {
  const lines = report.results.map(r => {
    if (r.errors.length > 0) {
      return `✗ ${r.file}\n${r.errors.map(e => `    - ${e}`).join("\n")}`;
    }
    return r.unverifiable === true
      ? `⚠ ${r.file} (version unverifiable: plugin not in this machine's cache)`
      : `✓ ${r.file}`;
  });
  const s = report.summary;
  const unverifiable =
    s.unverifiable > 0
      ? `, ${s.unverifiable} unverifiable on this machine`
      : "";
  return [
    ...lines,
    "",
    `${s.valid}/${s.scanned} routing artifacts valid, ${s.invalid} invalid${unverifiable}`,
  ].join("\n");
}

/**
 * Render a report to the chosen stream.
 *
 * @param {{ write(s: string): void }} out - the output stream.
 * @param {Record<string, unknown>} report - the report object.
 * @param {boolean} json - whether to emit JSON instead of the human report.
 * @returns {void}
 */
function emitReport(out, report, json) {
  out.write(
    `${json ? JSON.stringify(report, null, 2) : humanReport(report)}\n`
  );
}

/**
 * Parse argv into resolved options. Throws `UsageError` on a bad invocation.
 *
 * @param {readonly string[]} argv - arguments (without node/script prefix).
 * @returns {{ routingDir: string, cacheRoot: string, json: boolean }} options.
 */
export function parseArgs(argv) {
  let routingDir = null;
  let cacheRoot = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--routing-dir") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError("--routing-dir requires a value");
      }
      routingDir = next;
      i += 1;
    } else if (arg === "--cache-root") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError("--cache-root requires a value");
      }
      cacheRoot = next;
      i += 1;
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  const resolvedCache =
    cacheRoot ??
    process.env.CLAUDE_PLUGIN_CACHE ??
    path.join(os.homedir(), ".claude", "plugins", "cache");
  const resolvedRouting =
    routingDir ?? path.join(REPO_ROOT, "parity", "plugin-routing");
  return {
    cacheRoot: path.resolve(resolvedCache),
    json,
    routingDir: path.resolve(resolvedRouting),
  };
}

/**
 * Run the validator. Returns the process exit code (does not call `exit`).
 *
 * @param {readonly string[]} argv - arguments (without node/script prefix).
 * @param {{ stdout?: { write(s: string): void }, stderr?: { write(s: string): void } }} [io]
 *   injectable streams (defaults to process streams).
 * @returns {number} the exit code (0 valid, 1 invalid, 2 usage error).
 */
export function main(argv, io = {}) {
  const out = io.stdout ?? process.stdout;
  const err = io.stderr ?? process.stderr;
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    err.write(`error: ${error.message}\n`);
    return 2;
  }
  if (!isDirectory(opts.routingDir)) {
    err.write(`error: --routing-dir is not a directory: ${opts.routingDir}\n`);
    return 2;
  }
  let results;
  try {
    const files = fs
      .readdirSync(opts.routingDir)
      .filter(f => f.endsWith(".json"))
      .sort();
    results = files.map(file =>
      validateFile(opts.routingDir, file, opts.cacheRoot)
    );
  } catch (error) {
    err.write(`error: failed to validate routing dir: ${error.message}\n`);
    return 2;
  }
  emitReport(out, buildReport(results, opts), opts.json);
  return results.every(r => r.errors.length === 0) ? 0 : 1;
}

if (invokedAsScript(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
