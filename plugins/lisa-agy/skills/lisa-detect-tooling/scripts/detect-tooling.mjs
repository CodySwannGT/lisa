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
    why: "Linear reaches a container through lisa-linear-access with LINEAR_API_KEY; only the MCP path needs browser OAuth, and there is no official CLI to pin.",
    mcpFallback: "linear-server",
    // No official Linear CLI exists, so no proposal can name one. Kept even
    // though the substrate allowlist normally removes Linear before this
    // point: a second signal reaching here must not resurrect a binary that
    // does not exist.
    noCli: true,
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
 * MCP servers that are access substrates rather than evidence for a CLI.
 *
 * Linear is the important case: Lisa's `lisa-linear-access` skill owns the
 * headless path through `LINEAR_API_KEY` + GraphQL. There is no official Linear
 * CLI to pin, and the unrelated `linear` npm package is not a tracker binary.
 * Treating the MCP server as CLI evidence would push operators toward an
 * arbitrary third-party executable instead of the access-layer contract.
 */
/** Prefix marking evidence that shows a path is missing, not what fills it. */
const MCP_EVIDENCE = "MCP";

/** What to ask when the only evidence is an MCP-only integration. */
const REMOTE_PATH_QUESTION =
  "no manifest entry proposed — confirm how this reaches a container: a CLI, " +
  "a key-authenticated API call, or deliberately local-only";

const MCP_ACCESS_LAYER_SUBSTRATES = Object.freeze({
  "linear-server":
    "lisa-linear-access uses LINEAR_API_KEY in headless sessions",
});

/**
 * Integrations wired only as an MCP server — the weakest signal here, and the
 * easiest to over-read.
 *
 * True: an MCP server that authenticates interactively cannot authenticate in a
 * container, so THAT path does not survive the trip.
 *
 * Not implied: that the integration is unavailable, or that a CLI is the
 * answer. Linear proves both halves — its MCP server needs browser OAuth, and
 * its GraphQL API is key-authenticated, so `lisa-linear-access` already reaches
 * it headlessly with LINEAR_API_KEY and there is no official CLI to pin at all.
 * A server whose access layer owns headless auth is skipped entirely.
 *
 * For anything else, this raises a QUESTION rather than asserting a need: this
 * integration has no remote path as configured, confirm it has one. The answer
 * may be a CLI, may be a direct API call, and may be "local-only on purpose".
 * @param {object|null} mcp Parsed .mcp.json.
 * @returns {Map<string, string>} Tool name to the server that implies it.
 */
export function toolsFromMcp(mcp) {
  const found = new Map();
  const servers = Object.keys(mcp?.mcpServers ?? {});
  for (const [tool, meta] of Object.entries(KNOWN_TOOLS)) {
    if (!meta.mcpFallback) continue;
    const server = servers.find(name => name.includes(meta.mcpFallback));
    if (
      server &&
      Object.keys(MCP_ACCESS_LAYER_SUBSTRATES).some(substrate =>
        server.includes(substrate)
      )
    ) {
      continue;
    }
    if (server) {
      found.set(
        tool,
        `${MCP_EVIDENCE} server "${server}" — an interactively authenticated ` +
          `MCP server has no remote path; confirm this integration has one`
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
  // Every runner under e2eCoverage, not a hardcoded one. Naming `playwright`
  // explicitly meant `quality.e2eCoverage.maestro` — configured in this very
  // repository — produced no signal at all, so the one tool that genuinely
  // needs a pinned binary and genuinely was not declared stayed invisible to
  // the detector built to find it. A gate that reports "nothing outstanding"
  // while the gap is right there is worse than no gate.
  for (const runner of Object.keys(config?.quality?.e2eCoverage ?? {})) {
    if (Object.hasOwn(KNOWN_TOOLS, runner)) {
      found.set(runner, `quality.e2eCoverage.${runner} is configured`);
    }
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
export function declaredTools(config, surface = "remote") {
  const tools = config?.remoteEnv?.tools ?? {};
  const applies = tool => {
    const surfaces = tool.surfaces;
    if (!Array.isArray(surfaces) || surfaces.length === 0) return true;
    return surfaces.includes(surface);
  };
  // Filtered by surface, because a declaration that applies somewhere else is
  // not coverage here. A local-only `require` entry would otherwise suppress
  // the proposal for a tool genuinely missing from the remote manifest — the
  // detector reporting "already declared" about the one surface where it is
  // not.
  return new Set(
    [...(tools.require ?? []), ...(tools.install ?? [])]
      .filter(applies)
      .map(tool => tool.name)
  );
}

/**
 * Whether a tool already reaches this project as an npm dependency.
 *
 * A package that declares `@playwright/test` gets the `playwright` binary in
 * `node_modules/.bin`, and its npm scripts resolve it from there. It never
 * needs to be on PATH, so proposing a manifest entry for it is noise — and
 * noise is how a detector teaches people to skim it, which is the one failure
 * this skill's own documentation warns about.
 *
 * Only the CLI is covered by this. Anything else the tool needs at runtime —
 * Playwright's browsers, for instance — is a separate concern that a package
 * manager does not solve and this function does not claim to.
 * @param {object|null} pkg Parsed package.json.
 * @param {string} tool Tool name.
 * @returns {boolean} Whether npm already provides the binary.
 */
export function satisfiedByNpm(pkg, tool) {
  const viaNpm = KNOWN_TOOLS[tool]?.viaNpm;
  if (!viaNpm) return false;
  const declared = {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
  };
  return Object.hasOwn(declared, viaNpm);
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
      // Already provided by the package manager, so there is nothing to pin.
      if (satisfiedByNpm(pkg, tool)) continue;
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
 * The manifest entries an operator can paste, with the parts only they supply.
 *
 * Returns both lists because a platform-specific archive needs both: an
 * `install` entry for the surface it is built for, and a `require` entry so the
 * other surface still asserts the tool instead of silently ignoring it.
 * @param {{name: string}} proposal One detected tool.
 * @returns {{install: object[], require: object[]}} Manifest skeletons.
 */
export function proposedEntries(proposal) {
  // Whether a binary can be proposed is a fact about the TOOL, not about how it
  // was detected. Keying this on "the evidence was an MCP server" suppressed
  // exactly the wrong case: the substrate allowlist already removes Linear
  // before it becomes evidence, so the only tools reaching that branch were
  // ones like Maestro that genuinely do have a CLI — the binary the Expo
  // template invokes and nothing installs.
  //
  // So the question is asked only where there is no pinnable CLI to name.
  if (KNOWN_TOOLS[proposal.name]?.noCli) {
    return { install: [], require: [], question: REMOTE_PATH_QUESTION };
  }
  const viaNpm = KNOWN_TOOLS[proposal.name]?.viaNpm;
  if (viaNpm) {
    // npm resolves per platform, so one entry serves every surface.
    return {
      install: [
        {
          name: proposal.name,
          install: "npm-global",
          package: viaNpm,
          version: "<pin>",
        },
      ],
      require: [],
    };
  }
  // A release archive is built for one platform, so it is proposed as
  // remote-install plus a local `require`. Proposing only the install entry
  // produced a manifest that either offered a Linux binary to a laptop or —
  // once narrowed to remote — stopped checking for the tool locally at all.
  // Both halves or neither.
  return {
    install: [
      {
        name: proposal.name,
        version: "<pin>",
        install: "release-tar",
        url: "<release url for this exact version, for the remote platform>",
        sha256: "<sha256 published with that release>",
        surfaces: ["remote"],
      },
    ],
    require: [{ name: proposal.name, surfaces: ["local"] }],
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
      const entries = proposedEntries(proposal);
      if (entries.question) console.log(`    ${entries.question}`);
      for (const entry of entries.install) {
        console.log(`    tools.install: ${JSON.stringify(entry)}`);
      }
      for (const entry of entries.require) {
        console.log(`    tools.require: ${JSON.stringify(entry)}`);
      }
      console.log("");
    }
    console.log(
      "Nothing has been written or installed. Confirm each entry, supply the\n" +
        "pin and checksum, and add it to remoteEnv.tools in .lisa.config.json."
    );
  }
}
