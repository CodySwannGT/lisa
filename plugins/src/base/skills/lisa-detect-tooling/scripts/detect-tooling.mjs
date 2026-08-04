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

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { commandsIn } from "./commands.mjs";

/** The tool named by the Expo template's scripts and its flows directory. */
const MAESTRO = "maestro";

/**
 * Tools Lisa or its templates invoke, and how to recognise a need for them.
 *
 * Deliberately conservative. A false positive costs a human a moment's review;
 * a false negative is the failure this exists to prevent, so the signals are
 * ones that only appear when the tool is genuinely used.
 */
const KNOWN_TOOLS = Object.freeze({
  [MAESTRO]: {
    // A flows directory is the artifact maestro consumes; its presence is
    // usage, where a synced threshold default is not.
    artifacts: ".maestro",
    why: "Expo's template ships npm scripts that invoke `maestro`, and nothing installs the binary.",
    mcpFallback: MAESTRO,
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

/** Where git hooks live, strongest signal first. */
const HOOK_DIRECTORIES = [".husky", join(".git", "hooks")];

/**
 * Coding agents, which a PROJECT manifest must never try to provision.
 *
 * A hook that shells out to `claude` is real evidence of a real dependency, but
 * `remoteEnv.tools` is the wrong place to answer it: agents belong to the
 * machine, not the checkout, and each is installed by its vendor's own method
 * into a version directory it manages itself. Pinning one as a release archive
 * would fight the self-updater that owns that directory.
 *
 * That layer is `lisa-setup-workstation`. Named here rather than imported from
 * it, because a detector that stops working when a sibling skill is absent is
 * worse than one carrying six strings.
 *
 * Deliberately NOT extended to `gh`, `bws`, `aws` or `sonar`: those genuinely
 * belong in a project manifest, and `gh` going undeclared is the incident this
 * skill was written after.
 */
const WORKSTATION_PROVISIONED = new Set([
  "claude",
  "codex",
  "cursor-agent",
  "opencode",
  "agy",
  "copilot",
]);

/**
 * Tools a git hook runs — the strongest signal a project can give.
 *
 * Stronger than an npm script, because a hook runs on EVERY commit and push
 * whether anyone asked or not. A container missing one of these cannot commit at
 * all; the failure arrives mid-task, unattended, at the moment of use.
 *
 * The worst shape is the guarded one. This repository's pre-commit hook wraps
 * its secret scan in `command -v gitleaks`, so on a machine without gitleaks the
 * scan is SKIPPED SILENTLY — the hook passes, the commit succeeds, and nothing
 * was scanned. A guard makes the absence invisible exactly where it matters
 * most, which is why a probed name counts as evidence rather than being read as
 * "optional".
 * @param {string} cwd Project root.
 * @returns {Map<string, string>} Tool name to the hook that proves it.
 */
export function toolsFromGitHooks(cwd) {
  const found = new Map();
  for (const directory of HOOK_DIRECTORIES) {
    const full = join(cwd, directory);
    let names = [];
    try {
      names = readdirSync(full);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      // `.sample` files ship with git and run nothing.
      if (name.endsWith(".sample")) continue;
      let body;
      try {
        body = readFileSync(join(full, name), "utf8");
      } catch {
        continue;
      }
      for (const tool of commandsIn(body)) {
        if (!found.has(tool)) found.set(tool, `git hook ${directory}/${name}`);
      }
    }
  }
  return found;
}

/**
 * Tools an npm script invokes, discovered rather than matched against a list.
 *
 * `toolsFromScripts` answers "which of the tools I already know about appear
 * here". This answers the open question — what does this project actually RUN —
 * which is the one that finds a tool nobody thought to add. An Expo project
 * invoking `eas` from eight scripts produced nothing under the old shape,
 * because `eas` was not in `KNOWN_TOOLS`.
 * @param {object|null} pkg Parsed package.json.
 * @returns {Map<string, string>} Tool name to the script that proves it.
 */
export function toolsDiscoveredInScripts(pkg) {
  const found = new Map();
  for (const [name, body] of Object.entries(pkg?.scripts ?? {})) {
    if (typeof body !== "string") continue;
    for (const tool of commandsIn(body)) {
      if (found.has(tool)) continue;
      found.set(tool, `npm script "${name}": ${body.trim().slice(0, 60)}`);
    }
  }
  return found;
}

/**
 * Whether the package manager already puts this binary on the local path.
 *
 * A dependency's binary lands in `node_modules/.bin`, where npm scripts resolve
 * it without it ever being on PATH. Proposing a manifest entry for one is noise,
 * and noise is how a detector teaches people to skim it.
 *
 * Only meaningful once dependencies are installed, which is why
 * `dependenciesInstalled` exists rather than this quietly returning false on a
 * fresh clone and over-proposing every dev tool in the project.
 * @param {string} cwd Project root.
 * @param {string} tool Tool name.
 * @returns {boolean} Whether npm already provides it.
 */
export function providedByNodeModules(cwd, tool) {
  return existsSync(join(cwd, "node_modules", ".bin", tool));
}

/**
 * Whether `node_modules` is populated, so its absence can be reported.
 * @param {string} cwd Project root.
 * @returns {boolean} Whether dependencies are installed.
 */
export function dependenciesInstalled(cwd) {
  return existsSync(join(cwd, "node_modules", ".bin"));
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
 * Whether anything in the project actually reaches for this tool.
 *
 * Corroboration for a threshold, which on its own says only that a default was
 * synced. Two independent witnesses: a script that names the binary, or the
 * directory of artifacts the tool consumes.
 * @param {string} tool Tool name.
 * @param {object|null} pkg Parsed package.json.
 * @param {string} cwd Project root.
 * @returns {boolean} Whether the project uses it.
 */
function usedByProject(tool, pkg, cwd) {
  const invoked = [...toolsFromScripts(pkg).keys()].includes(tool);
  if (invoked) return true;
  const artifacts = KNOWN_TOOLS[tool]?.artifacts;
  if (!artifacts) return false;
  // A DIRECTORY, not merely an entry with that name. `existsSync` is true for a
  // regular file too, so a stray `.maestro` note or editor artifact would have
  // corroborated the threshold and reintroduced the 300MB proposal this check
  // exists to prevent — a false positive arriving through the very guard added
  // to stop one.
  try {
    return statSync(join(cwd, artifacts)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Tools a project's quality configuration CORROBORATES — never establishes.
 *
 * A threshold is not usage. `quality.e2eCoverage` defaults are synced into
 * every project by `src/sync/registry.ts`, so this repository carries a
 * `maestro` entry while having no `.maestro` directory and no script that
 * invokes it. Treating that as evidence proposed pinning a 300MB JVM
 * application into a container for a tool nothing runs.
 *
 * Evidence that a tool is CONFIGURED is not evidence that it is NEEDED — the
 * same mistake as proposing a binary npm already provides. So a threshold only
 * counts when something corroborates it: a script that invokes the tool, or the
 * artifacts it consumes. In a real Expo project the script signal fires and
 * this adds nothing; in a project that merely inherited the defaults, it
 * correctly stays quiet.
 * @param {object|null} config Parsed .lisa.config.json.
 * @param {object|null} [pkg] Parsed package.json, for corroboration.
 * @param {string} [cwd] Project root, for artifact corroboration.
 * @returns {Map<string, string>} Tool name to the setting that implies it.
 */
export function toolsFromQuality(config, pkg = null, cwd = process.cwd()) {
  const found = new Map();
  for (const runner of Object.keys(config?.quality?.e2eCoverage ?? {})) {
    if (!Object.hasOwn(KNOWN_TOOLS, runner)) continue;
    if (!usedByProject(runner, pkg, cwd)) continue;
    found.set(
      runner,
      `quality.e2eCoverage.${runner} is configured, and the project uses it`
    );
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
  // Curated signals carry a vetted `why`. Discovered ones carry only the fact
  // that the project runs the thing — weaker prose, identical standing as
  // evidence, and the only kind that can find a tool nobody listed.
  const hooks = toolsFromGitHooks(cwd);
  const signals = [
    hooks,
    toolsFromScripts(pkg),
    toolsDiscoveredInScripts(pkg),
    toolsFromMcp(mcp),
    toolsFromSecretNotes(notes),
    toolsFromQuality(config, pkg, cwd),
  ];

  const merged = new Map();
  for (const signal of signals) {
    for (const [tool, evidence] of signal) {
      if (declared.has(tool)) continue;
      // Already provided by the package manager, so there is nothing to pin.
      if (satisfiedByNpm(pkg, tool)) continue;
      if (providedByNodeModules(cwd, tool)) continue;
      // Real dependency, wrong manifest — the workstation layer owns it.
      if (WORKSTATION_PROVISIONED.has(tool)) continue;
      const entry = merged.get(tool) ?? { evidence: [] };
      if (!entry.evidence.includes(evidence)) entry.evidence.push(evidence);
      merged.set(tool, entry);
    }
  }

  return [...merged.entries()]
    .map(([name, entry]) => ({
      name,
      why: KNOWN_TOOLS[name]?.why ?? discoveredWhy(name, hooks.has(name)),
      evidence: entry.evidence,
      // Says which vocabulary the `why` came from, so a reader can weigh it.
      // A curated entry has been thought about; a discovered one has only been
      // observed.
      source: Object.hasOwn(KNOWN_TOOLS, name) ? "curated" : "discovered",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The `why` for a tool nobody wrote prose for.
 *
 * Every proposal must carry one — a proposal without a reason is an assertion,
 * and this program's whole boundary is that it asserts nothing. So a discovered
 * tool states the observation plainly rather than borrowing confidence it has
 * not earned.
 * @param {string} name Tool name.
 * @param {boolean} fromHook Whether a git hook runs it.
 * @returns {string} A reason a reader can check.
 */
export function discoveredWhy(name, fromHook) {
  return fromHook
    ? `A git hook runs \`${name}\` on every commit or push, and nothing ` +
        `declares it — a machine without it fails at commit time, or skips the ` +
        `check silently if the hook guards it.`
    : `An npm script invokes \`${name}\`, and nothing puts it on PATH.`;
}

/**
 * The manifest entries an operator can paste, with the parts only they supply.
 *
 * A release archive is proposed as a `platforms` map rather than a single URL
 * plus `surfaces: ["remote"]`. The old shape could express only one artifact, so
 * keeping a Linux binary off a laptop meant excluding the tool from laptops
 * altogether — which is how `bws` and `gh` came to be required on a developer
 * machine and installable only in a container.
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
  // A release archive is built for one platform, so every platform the project
  // is developed or built on needs its own block — with its own install method,
  // because a vendor may ship a tarball for one and a zip for another, as gh
  // does. Both containers and laptops are proposed: a tool the manifest can
  // only install remotely is one every developer installs by hand or does
  // without.
  //
  // The placeholders stay unresolved on purpose. A guessed URL is an artifact
  // the checksum cannot vouch for, which is the one property that makes a
  // pinned entry worth reviewing.
  const archive = platform => ({
    install: "<release-tar or release-zip, whichever this platform ships>",
    url: `<release url for this exact version, for ${platform}>`,
    sha256: `<sha256 published with the ${platform} release>`,
  });
  return {
    install: [
      {
        name: proposal.name,
        version: "<pin>",
        platforms: {
          "linux-x64": archive("linux-x64"),
          "darwin-arm64": archive("darwin-arm64"),
        },
      },
    ],
    require: [],
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
    if (!dependenciesInstalled(process.cwd())) {
      // Without node_modules there is no way to tell a tool that needs PATH
      // from one npm already provides, so every dev dependency looks missing.
      // Said out loud rather than silently over-proposing.
      console.log(
        "note: dependencies are not installed, so binaries npm would provide " +
          "cannot be\n      excluded. Run the install first for a shorter, " +
          "more accurate list.\n"
      );
    }
    for (const proposal of proposals) {
      console.log(`  ${proposal.name}  [${proposal.source}]`);
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
