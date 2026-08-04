#!/usr/bin/env node
/**
 * Find the command-line tools a project needs but never declares.
 *
 * Lisa provisions tooling through several unrelated mechanisms — npm
 * devDependencies from a stack template, MCP servers, a dedicated installer for
 * Sonar, and the pinned `remoteEnv.tools` manifest. Only the last one puts a
 * binary on PATH, and nothing populates it. So a project can ship npm scripts
 * that invoke `maestro`, wire an MCP server whose CLI it also shells out to, and
 * declare Playwright coverage thresholds, while the manifest that actually
 * provisions binaries stays empty and every one of those fails at the moment of
 * use rather than at setup.
 *
 * This program only ever *proposes*. It writes nothing, installs nothing, and
 * emits manifest entries with the fields a human still has to fill — a pinned
 * version, a URL, a checksum. That boundary is the point: a tool should reach a
 * machine because someone reviewed a pinned entry, never because a detector was
 * confident. Detection is evidence; the manifest is the decision.
 *
 * Usage:
 *   detect-tooling.mjs [--json]
 * @module detect-tooling
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tools Lisa or its templates invoke, and how to recognise a need for them.
 *
 * Deliberately conservative. A false positive costs a human a moment's review;
 * a false negative is the failure this exists to prevent, so the signals are
 * ones that only appear when the tool is genuinely used.
 */
const KNOWN_TOOLS = Object.freeze({
  maestro: {
    why: "Expo's template ships npm scripts that invoke `maestro`, and nothing installs the binary.",
    mcpFallback: "maestro",
  },
  gh: {
    why: "The work-item guardrails shell out to `gh` for every tracker read.",
  },
  bws: {
    why: "The Bitwarden CLI is how every secret is resolved.",
  },
  "sonar-scanner": {
    why: "Sonar analysis runs a scanner binary, which the Sonar installer configures but does not place on PATH.",
  },
  playwright: {
    why: "Playwright drives browser E2E and its coverage thresholds are configured.",
    viaNpm: "@playwright/test",
  },
  linear: {
    why: "Linear is wired as an MCP server, which needs browser OAuth and so cannot authenticate in a container.",
    mcpFallback: "linear-server",
  },
});

/**
 * Read a JSON file, treating absence or damage as "no signal".
 *
 * A detector that throws on a malformed config is worse than one that misses a
 * signal: it blocks the very command an operator runs to find out what is wrong.
 * @param {string} path File to read.
 * @returns {object|null} Parsed contents, or null.
 */
function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Tools named by npm scripts, which is the strongest signal there is.
 *
 * A script that runs `maestro test` is a project stating it needs Maestro, in
 * executable form. Word-boundary matched so `maestro:test` as a script *name*
 * does not count while `maestro test` as its body does — the name is a label,
 * the body is a dependency.
 * @param {object|null} pkg Parsed package.json.
 * @returns {Map<string, string>} Tool name to the script that proves it.
 */
export function toolsFromScripts(pkg) {
  const found = new Map();
  const scripts = pkg?.scripts ?? {};
  for (const [name, body] of Object.entries(scripts)) {
    if (typeof body !== "string") continue;
    for (const tool of Object.keys(KNOWN_TOOLS)) {
      const pattern = new RegExp(`(^|[\\s;&|(])${tool}(\\s|$)`, "u");
      if (pattern.test(body) && !found.has(tool)) {
        found.set(tool, `npm script "${name}": ${body.trim().slice(0, 60)}`);
      }
    }
  }
  return found;
}

/**
 * Tools implied by MCP servers that also have a CLI.
 *
 * An MCP server is not a substitute for the binary. Several authenticate by
 * browser OAuth, which a container cannot do at all, so a project relying on one
 * remotely has no integration rather than a degraded one — the CLI is the form
 * that survives the trip.
 * @param {object|null} mcp Parsed .mcp.json.
 * @returns {Map<string, string>} Tool name to the server that implies it.
 */
export function toolsFromMcp(mcp) {
  const found = new Map();
  const servers = Object.keys(mcp?.mcpServers ?? {});
  for (const [tool, meta] of Object.entries(KNOWN_TOOLS)) {
    if (!meta.mcpFallback) continue;
    const server = servers.find(name => name.includes(meta.mcpFallback));
    if (server) {
      found.set(
        tool,
        `MCP server "${server}" (browser OAuth cannot run remotely)`
      );
    }
  }
  return found;
}

/**
 * Tools named in credential usage notes.
 *
 * A note explaining what a token is *for* usually names the program that
 * consumes it, and those notes are already readable without touching a value —
 * `read-secret-note.mjs` exists precisely so an agent can learn a credential's
 * blast radius safely. That makes them a first-class detection input rather than
 * a clever trick.
 * @param {object|null} notes Parsed secret-notes.json.
 * @returns {Map<string, string>} Tool name to the credential that names it.
 */
export function toolsFromSecretNotes(notes) {
  const found = new Map();
  const entries = Object.entries(notes?.notes ?? notes ?? {});
  for (const [secret, note] of entries) {
    const text = typeof note === "string" ? note : JSON.stringify(note ?? "");
    for (const tool of Object.keys(KNOWN_TOOLS)) {
      const pattern = new RegExp(
        `(^|[^A-Za-z0-9-])${tool}([^A-Za-z0-9-]|$)`,
        "iu"
      );
      if (pattern.test(text) && !found.has(tool)) {
        found.set(tool, `usage note on credential "${secret}"`);
      }
    }
  }
  return found;
}

/**
 * Tools implied by quality configuration.
 * @param {object|null} config Parsed .lisa.config.json.
 * @returns {Map<string, string>} Tool name to the setting that implies it.
 */
export function toolsFromQuality(config) {
  const found = new Map();
  if (config?.quality?.e2eCoverage?.playwright) {
    found.set("playwright", "quality.e2eCoverage.playwright is configured");
  }
  if (config?.quality?.sonar || config?.sonar) {
    found.set("sonar-scanner", "Sonar analysis is configured");
  }
  return found;
}

/**
 * Everything already declared, by name, so proposals exclude them.
 * @param {object|null} config Parsed .lisa.config.json.
 * @returns {Set<string>} Declared tool names.
 */
export function declaredTools(config) {
  const tools = config?.remoteEnv?.tools ?? {};
  return new Set(
    [...(tools.require ?? []), ...(tools.install ?? [])].map(t => t.name)
  );
}

/**
 * Collect every signal and subtract what the manifest already covers.
 * @param {string} [cwd] Project root.
 * @returns {Array<{name: string, why: string, evidence: string[]}>} Proposals.
 */
export function detectTooling(cwd = process.cwd()) {
  const config = readJson(join(cwd, ".lisa.config.json"));
  const pkg = readJson(join(cwd, "package.json"));
  const mcp = readJson(join(cwd, ".mcp.json"));
  const notes = readJson(join(cwd, ".lisa", "secret-notes.json"));

  const declared = declaredTools(config);
  const signals = [
    toolsFromScripts(pkg),
    toolsFromMcp(mcp),
    toolsFromSecretNotes(notes),
    toolsFromQuality(config),
  ];

  const merged = new Map();
  for (const signal of signals) {
    for (const [tool, evidence] of signal) {
      if (declared.has(tool)) continue;
      const entry = merged.get(tool) ?? { evidence: [] };
      entry.evidence.push(evidence);
      merged.set(tool, entry);
    }
  }

  return [...merged.entries()]
    .map(([name, entry]) => ({
      name,
      why: KNOWN_TOOLS[name]?.why ?? "",
      evidence: entry.evidence,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A manifest entry an operator can paste, with the parts only they can supply.
 * @param {{name: string}} proposal One detected tool.
 * @returns {object} A `remoteEnv.tools.install` skeleton.
 */
export function proposedEntry(proposal) {
  const viaNpm = KNOWN_TOOLS[proposal.name]?.viaNpm;
  return viaNpm
    ? {
        name: proposal.name,
        install: "npm-global",
        package: viaNpm,
        version: "<pin>",
      }
    : {
        name: proposal.name,
        version: "<pin>",
        install: "release-tar",
        url: "<release url for this exact version>",
        sha256: "<sha256 published with that release>",
        surfaces: ["remote"],
      };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const proposals = detectTooling();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(proposals, null, 2));
  } else if (proposals.length === 0) {
    console.log(
      "Every tool this project appears to use is already declared in remoteEnv.tools."
    );
  } else {
    console.log(
      `${proposals.length} tool(s) look required but are not declared:\n`
    );
    for (const proposal of proposals) {
      console.log(`  ${proposal.name}`);
      console.log(`    why: ${proposal.why}`);
      for (const evidence of proposal.evidence) {
        console.log(`    evidence: ${evidence}`);
      }
      console.log(`    proposed: ${JSON.stringify(proposedEntry(proposal))}\n`);
    }
    console.log(
      "Nothing has been written or installed. Confirm each entry, supply the\n" +
        "pin and checksum, and add it to remoteEnv.tools in .lisa.config.json."
    );
  }
}
