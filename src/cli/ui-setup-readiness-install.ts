/** Truthful, harness-aware installation evidence for Setup readiness. */
/* eslint-disable jsdoc/require-param, jsdoc/require-returns -- typed evidence helpers are self-describing */
import path from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  discoverLisaAgents,
  LISA_AGENTS_SUBDIR,
} from "../codex/agent-installer.js";
import {
  DEFAULT_HARNESS,
  harnessIncludesAgent,
  type Harness,
} from "../core/config.js";
import {
  projectPluginFilter,
  selectProjectLisaPluginsFromState,
} from "../core/lisa-plugin-selection.js";
import { normalizeHarness } from "../core/project-config.js";
import type { HealthResult } from "../health/contract.js";
import {
  projectPathKind,
  projectRegularFileExists,
  readProjectJsonObject,
  readProjectText,
} from "../health/read-only-fs.js";
import type { JsonObject } from "../sync/json-path.js";
import {
  setupFinding,
  type SetupReadinessFinding,
} from "./ui-setup-readiness-contract.js";
import { healthEvidenceFinding } from "./ui-setup-readiness-local.js";
import { readConfinedDetectedStacks } from "./ui-detected-stacks.js";

/** Fixed Health checks that establish common project-owned apply surfaces. */
export const INSTALL_HEALTH_CHECKS = [
  "project.state",
  "templates.managed",
  "package.conformance",
  "hooks.managed",
] as const;

const MAX_MANAGED_FILES = 2_048;
const INSTALL_CHECK = "setup.install";
const EXTERNAL_ONLY_HARNESSES = new Set<Harness>([
  "cursor",
  "agy",
  "copilot",
  "fleet",
]);

/** Resolve the configured harness without accepting a malformed value. */
function configuredHarness(config: JsonObject): Harness | undefined {
  const raw = config.harness ?? DEFAULT_HARNESS;
  return typeof raw === "string" ? normalizeHarness(raw) : undefined;
}

/** Require one non-empty, confined regular project file. */
async function nonemptyProjectFile(
  root: string,
  relativePath: string
): Promise<boolean> {
  const text = await readProjectText(root, relativePath);
  return text !== undefined && text.trim().length > 0;
}

/** Validate one normalized path relative to an agent-owned manifest directory. */
function validManifestEntry(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    path.posix.isAbsolute(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return (
    segments.every(
      segment => segment !== "" && segment !== "." && segment !== ".."
    ) && path.posix.normalize(value) === value
  );
}

/** Refuse symlinked/special parents and final entries for one manifest file. */
async function manifestEntryIsRegular(
  root: string,
  configDir: string,
  entry: string
): Promise<boolean> {
  const segments = [configDir, ...entry.split("/")];
  const parents = segments
    .slice(0, -1)
    .map((_, index) => segments.slice(0, index + 1).join("/"));
  const kinds = await Promise.all(
    parents.map(parent => projectPathKind(root, parent))
  );
  return (
    kinds.every(kind => kind === "directory") &&
    (await projectRegularFileExists(root, `${configDir}/${entry}`))
  );
}

/** Validate a bounded managed-artifact manifest and every file it names. */
async function managedManifestIsComplete(
  root: string,
  configDir: ".codex" | ".opencode",
  expectedFiles?: readonly string[]
): Promise<boolean> {
  const manifest = await readProjectJsonObject(
    root,
    `${configDir}/.lisa-managed.json`
  );
  const files = manifest?.files;
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    files.length > MAX_MANAGED_FILES ||
    !files.every(validManifestEntry) ||
    new Set(files).size !== files.length
  ) {
    return false;
  }
  if (expectedFiles !== undefined) {
    const observed = [...files].sort((left, right) =>
      left.localeCompare(right)
    );
    const expected = [...expectedFiles].sort((left, right) =>
      left.localeCompare(right)
    );
    if (
      observed.length !== expected.length ||
      observed.some((entry, index) => entry !== expected[index])
    ) {
      return false;
    }
  }
  const present = await Promise.all(
    files.map(entry => manifestEntryIsRegular(root, configDir, entry))
  );
  return present.every(Boolean);
}

/**
 * Derive Codex's exact current managed-file set from the same selected plugin
 * and agent discovery contract used by apply. No project file is trusted as a
 * declaration of completeness.
 */
export async function expectedCodexManagedFiles(
  projectRoot: string,
  config: JsonObject
): Promise<readonly string[]> {
  const root = await realpath(projectRoot);
  const lisaRoot = await realpath(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
  );
  const [detectedTypes, wikiKind] = await Promise.all([
    readConfinedDetectedStacks(root),
    projectPathKind(root, "wiki/lisa-wiki.config.json"),
  ]);
  const plugins = selectProjectLisaPluginsFromState(
    config,
    detectedTypes,
    wikiKind === "file"
  );
  const agents = await discoverLisaAgents(
    lisaRoot,
    projectPluginFilter(plugins)
  );
  return Object.freeze([
    ...agents.map(agent =>
      path.posix.join(LISA_AGENTS_SUBDIR, `${agent.id}.toml`)
    ),
    "config.toml",
  ]);
}

/** Convert one boolean observation into a stable drift label. */
async function evidenceDrift(
  applicable: boolean,
  label: string,
  observe: () => Promise<boolean>
): Promise<readonly string[]> {
  if (!applicable) return [];
  return (await observe()) ? [] : [label];
}

/** Collect missing or unsafe project-owned surfaces for one harness. */
async function projectSurfaceDrift(
  root: string,
  harness: Harness,
  config: JsonObject
): Promise<readonly string[]> {
  const includes = (agent: Exclude<Harness, "cursor" | "fleet">): boolean =>
    harnessIncludesAgent(harness, agent);
  const needsAgents =
    includes("claude") ||
    includes("codex") ||
    includes("agy") ||
    includes("copilot") ||
    includes("opencode");
  const codexFiles = includes("codex")
    ? await expectedCodexManagedFiles(root, config)
    : undefined;

  const observations = await Promise.all([
    evidenceDrift(
      needsAgents,
      "AGENTS.md",
      async () => await nonemptyProjectFile(root, "AGENTS.md")
    ),
    evidenceDrift(
      includes("claude"),
      "CLAUDE.md canonical AGENTS.md pointer",
      async () =>
        (await readProjectText(root, "CLAUDE.md"))?.includes("@AGENTS.md") ===
        true
    ),
    evidenceDrift(
      includes("codex"),
      ".codex managed-artifact manifest",
      async () => await managedManifestIsComplete(root, ".codex", codexFiles)
    ),
    evidenceDrift(
      includes("copilot"),
      ".github/copilot-instructions.md",
      async () =>
        await nonemptyProjectFile(root, ".github/copilot-instructions.md")
    ),
    evidenceDrift(
      includes("opencode"),
      ".opencode managed-artifact manifest",
      async () => await managedManifestIsComplete(root, ".opencode")
    ),
    evidenceDrift(
      includes("opencode"),
      "opencode.json",
      async () => await nonemptyProjectFile(root, "opencode.json")
    ),
  ]);
  return observations.flat();
}

/**
 * Establish only installation state that Lisa can observe authoritatively.
 * External plugin/runtime state remains non-pass when no bounded reader exists.
 */
export async function installFinding(
  projectRoot: string,
  config: JsonObject,
  health: HealthResult | undefined
): Promise<SetupReadinessFinding> {
  const common = healthEvidenceFinding(
    INSTALL_CHECK,
    health,
    INSTALL_HEALTH_CHECKS,
    "Lisa's common project templates, package, and git hooks are current.",
    "fail"
  );
  if (common.status !== "pass") return common;

  const harness = configuredHarness(config);
  if (harness === undefined) {
    return setupFinding(
      INSTALL_CHECK,
      "fail",
      "The configured Lisa harness is missing or invalid; run lisa sync and lisa apply."
    );
  }

  try {
    const root = await realpath(projectRoot);
    const drift = await projectSurfaceDrift(root, harness, config);
    if (drift.length > 0) {
      return setupFinding(
        INSTALL_CHECK,
        "fail",
        `Configured-harness project surfaces are missing or unsafe: ${drift.join(", ")}. Run lisa apply.`
      );
    }
  } catch {
    return setupFinding(
      INSTALL_CHECK,
      "fail",
      "Configured-harness project surfaces could not be inspected safely; replace symlinks, special files, or oversized files and run lisa apply."
    );
  }

  if (harnessIncludesAgent(harness, "claude")) {
    const claudePlugins = healthEvidenceFinding(
      INSTALL_CHECK,
      health,
      ["plugins.current"],
      "Claude's enabled and installed Lisa plugins are current.",
      "warn"
    );
    if (claudePlugins.status !== "pass") return claudePlugins;
  }

  if (harnessIncludesAgent(harness, "opencode")) {
    return setupFinding(
      INSTALL_CHECK,
      "warn",
      "OpenCode's declared managed files are present, but their completeness against the current emit catalog cannot yet be established authoritatively."
    );
  }

  if (EXTERNAL_ONLY_HARNESSES.has(harness)) {
    return setupFinding(
      INSTALL_CHECK,
      "warn",
      `Lisa's project-owned ${harness} surfaces are current, but external ${harness} plugin/runtime installation cannot yet be observed authoritatively.`
    );
  }

  return setupFinding(
    INSTALL_CHECK,
    "pass",
    `Lisa's required project-owned ${harness} installation surfaces are present and complete.`
  );
}
/* eslint-enable jsdoc/require-param, jsdoc/require-returns -- restore repository documentation defaults */
