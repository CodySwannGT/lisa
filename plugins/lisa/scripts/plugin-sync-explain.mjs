#!/usr/bin/env node
/**
 * Read-only plugin sync drift classifier.
 *
 * This helper intentionally uses committed git status as evidence instead of
 * rebuilding plugins. Rebuilding is the job of `bun run build:plugins`; this
 * diagnostic explains likely causes before an operator mutates the tree.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

export const PLUGIN_SYNC_CLASSIFICATIONS = [
  "SOURCE_NOT_BUILT",
  "GENERATED_ONLY",
  "MARKETPLACE_REGISTRATION_DRIFT",
  "OUT_OF_SYNC",
  "IN_SYNC",
];

const PLUGINS_DIR = "plugins";
const SOURCE_ROOT = "plugins/src";
const MARKETPLACE = ".claude-plugin/marketplace.json";
const GIT_BIN = "/usr/bin/git";

/**
 * @typedef {{
 *   readonly classification: string
 *   readonly path: string
 *   readonly counterpart?: string
 *   readonly likelyCause: string
 *   readonly nextAction: string
 * }} PluginSyncFinding
 *
 * @typedef {{
 *   readonly root: string
 *   readonly findings: readonly PluginSyncFinding[]
 *   readonly statusBefore: string
 *   readonly statusAfter: string
 *   readonly readOnly: boolean
 *   readonly text: string
 * }} PluginSyncReport
 */

/**
 * @param {string} root
 * @returns {PluginSyncReport}
 */
export function explainPluginSync(root = process.cwd()) {
  const repoRoot = path.resolve(root);
  const statusBefore = gitStatus(repoRoot);
  const statusEntries = parseGitStatus(statusBefore);
  const expectedGeneratedFiles = buildExpectedGeneratedFiles(repoRoot);
  const findings = [
    ...classifySourceGeneratedDrift(
      repoRoot,
      statusEntries,
      expectedGeneratedFiles
    ),
    ...classifyMarketplaceDrift(repoRoot),
  ];
  const statusAfter = gitStatus(repoRoot);
  const readOnly = statusAfter === statusBefore;

  return {
    root: repoRoot,
    findings,
    statusBefore,
    statusAfter,
    readOnly,
    text: renderPluginSyncReport({
      root: repoRoot,
      findings,
      statusBefore,
      statusAfter,
      readOnly,
    }),
  };
}

/**
 * @param {PluginSyncReport} report
 * @returns {string}
 */
export function renderPluginSyncReport(report) {
  const lines = [
    "Plugin sync explain",
    `Repo: ${report.root}`,
    `Read-only: ${report.readOnly ? "yes" : "no"}`,
  ];

  if (report.findings.length === 0) {
    lines.push(
      "Verdict: IN_SYNC",
      "No plugin source/generated or marketplace registration drift detected."
    );
    return `${lines.join("\n")}\n`;
  }

  lines.push(`Verdict: ${highestClassification(report.findings)}`, "Findings:");
  for (const finding of report.findings) {
    lines.push(
      `- ${finding.classification}: ${finding.path}`,
      `  Evidence: ${finding.counterpart ? `${finding.path} -> ${finding.counterpart}` : finding.path}`,
      `  Likely cause: ${finding.likelyCause}`,
      `  Next action: ${finding.nextAction}`
    );
  }

  return `${lines.join("\n")}\n`;
}

/**
 * @param {readonly PluginSyncFinding[]} findings
 * @returns {string}
 */
function highestClassification(findings) {
  if (findings.some(f => f.classification === "OUT_OF_SYNC")) {
    return "OUT_OF_SYNC";
  }
  if (
    findings.some(f => f.classification === "MARKETPLACE_REGISTRATION_DRIFT")
  ) {
    return "MARKETPLACE_REGISTRATION_DRIFT";
  }
  if (findings.some(f => f.classification === "GENERATED_ONLY")) {
    return "GENERATED_ONLY";
  }
  if (findings.some(f => f.classification === "SOURCE_NOT_BUILT")) {
    return "SOURCE_NOT_BUILT";
  }
  return "IN_SYNC";
}

/**
 * @param {readonly { readonly code: string, readonly file: string }[]} entries
 * @param {ReadonlyMap<string, Buffer> | undefined} expectedGeneratedFiles
 * @returns {PluginSyncFinding[]}
 */
function classifySourceGeneratedDrift(root, entries, expectedGeneratedFiles) {
  const changed = new Set(entries.map(entry => entry.file));
  const findings = [];

  for (const entry of entries) {
    const sourceCounterpart = sourceToBuilt(entry.file);
    if (sourceCounterpart) {
      const generatedChanged = changed.has(sourceCounterpart);
      if (expectedGeneratedFiles) {
        const expected = expectedGeneratedFiles.get(sourceCounterpart);
        const active = readOptionalFile(root, sourceCounterpart);
        const generatedMatchesSource =
          expected !== undefined &&
          active !== undefined &&
          expected.equals(active);
        if (generatedMatchesSource) {
          continue;
        }
      }
      findings.push({
        classification: generatedChanged ? "OUT_OF_SYNC" : "SOURCE_NOT_BUILT",
        path: entry.file,
        counterpart: sourceCounterpart,
        likelyCause: generatedChanged
          ? "Both source and generated artifacts changed, but the generated artifact does not match a fresh plugin build."
          : "A source plugin file changed, but its generated artifact was not rebuilt from plugins/src.",
        nextAction: generatedChanged
          ? "Review both source and generated changes, keep source authoritative, then run `bun run build:plugins && bun run check:plugins`."
          : "Run `bun run build:plugins`, then `bun run check:plugins`, and commit source plus regenerated artifacts.",
      });
      continue;
    }

    const builtCounterpart = builtToSource(entry.file);
    if (builtCounterpart && !changed.has(builtCounterpart)) {
      if (expectedGeneratedFiles) {
        const expected = expectedGeneratedFiles.get(entry.file);
        const active = readOptionalFile(root, entry.file);
        if (
          expected !== undefined &&
          active !== undefined &&
          expected.equals(active)
        ) {
          continue;
        }
      }
      findings.push({
        classification: "GENERATED_ONLY",
        path: entry.file,
        counterpart: builtCounterpart,
        likelyCause:
          "A generated plugin artifact changed without the matching plugins/src source change.",
        nextAction:
          "Move the edit to the matching plugins/src path, rebuild with `bun run build:plugins`, then run `bun run check:plugins`.",
      });
    }
  }

  return dedupeFindings(findings);
}

/**
 * @param {string} root
 * @returns {PluginSyncFinding[]}
 */
function classifyMarketplaceDrift(root) {
  const marketplacePath = path.join(root, MARKETPLACE);
  if (!existsSync(marketplacePath)) {
    return [];
  }

  const marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));
  const sources = new Set(
    (marketplace.plugins ?? [])
      .map(plugin => plugin.source)
      .filter(source => typeof source === "string")
  );
  const pluginsRoot = path.join(root, PLUGINS_DIR);
  if (!existsSync(pluginsRoot)) {
    return [];
  }

  const builtSources = readdirSync(pluginsRoot)
    .filter(name => name !== "src")
    .map(name => path.join(pluginsRoot, name))
    .filter(abs => statSync(abs).isDirectory())
    .map(abs => `./${path.relative(root, abs).split(path.sep).join("/")}`);

  const findings = [];
  for (const source of builtSources) {
    if (!sources.has(source)) {
      findings.push({
        classification: "MARKETPLACE_REGISTRATION_DRIFT",
        path: source.replace(/^\.\//, ""),
        counterpart: MARKETPLACE,
        likelyCause:
          "A built plugin directory exists but is not advertised by the marketplace manifest.",
        nextAction: `Add marketplace source "${source}" to \`${MARKETPLACE}\`, then run \`bun run check:plugins\`.`,
      });
    }
  }

  for (const source of sources) {
    if (!existsSync(path.join(root, source))) {
      findings.push({
        classification: "MARKETPLACE_REGISTRATION_DRIFT",
        path: MARKETPLACE,
        counterpart: source.replace(/^\.\//, ""),
        likelyCause:
          "The marketplace manifest points at a built plugin directory that is missing.",
        nextAction:
          "Either restore the built plugin directory or remove the stale marketplace source, then run `bun run check:plugins`.",
      });
    }
  }

  return findings;
}

/**
 * Build plugins in a disposable copy and return the generated bytes that source
 * changes should produce. If a minimal fixture cannot run the build script,
 * callers fall back to status-based classification without mutating the repo.
 * @param {string} root
 * @returns {ReadonlyMap<string, Buffer> | undefined}
 */
function buildExpectedGeneratedFiles(root) {
  if (!existsSync(path.join(root, "scripts/build-plugins.sh"))) {
    return undefined;
  }

  const tempRoot = mkdtempSync(path.join(tmpdir(), "lisa-plugin-sync-"));
  const scratchRoot = path.join(tempRoot, "repo");
  try {
    cpSync(root, scratchRoot, {
      recursive: true,
      filter: src => shouldCopyToScratch(root, src),
    });
    execFileSync("bash", ["scripts/build-plugins.sh"], {
      cwd: scratchRoot,
      encoding: "utf8",
      env: gitEnv(),
      stdio: "ignore",
    });
    return collectGeneratedFiles(scratchRoot);
  } catch {
    return undefined;
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}

/**
 * @param {string} root
 * @param {string} src
 * @returns {boolean}
 */
function shouldCopyToScratch(root, src) {
  const rel = path.relative(root, src).split(path.sep).join("/");
  if (rel === "") {
    return true;
  }
  return !(
    rel === ".git" ||
    rel.startsWith(".git/") ||
    rel === "node_modules" ||
    rel.startsWith("node_modules/") ||
    rel === "dist" ||
    rel.startsWith("dist/") ||
    rel === "coverage" ||
    rel.startsWith("coverage/")
  );
}

/**
 * @param {string} root
 * @returns {Map<string, Buffer>}
 */
function collectGeneratedFiles(root) {
  const files = new Map();
  const pluginsRoot = path.join(root, PLUGINS_DIR);
  if (!existsSync(pluginsRoot)) {
    return files;
  }
  for (const name of readdirSync(pluginsRoot)) {
    if (name === "src" || !name.startsWith("lisa")) {
      continue;
    }
    collectFiles(root, path.join(pluginsRoot, name), files);
  }
  return files;
}

/**
 * @param {string} root
 * @param {string} current
 * @param {Map<string, Buffer>} files
 */
function collectFiles(root, current, files) {
  const stats = statSync(current);
  if (stats.isDirectory()) {
    for (const child of readdirSync(current)) {
      collectFiles(root, path.join(current, child), files);
    }
    return;
  }
  if (stats.isFile()) {
    files.set(
      path.relative(root, current).split(path.sep).join("/"),
      readFileSync(current)
    );
  }
}

/**
 * @param {string} root
 * @param {string} rel
 * @returns {Buffer | undefined}
 */
function readOptionalFile(root, rel) {
  const abs = path.join(root, rel);
  return existsSync(abs) && statSync(abs).isFile()
    ? readFileSync(abs)
    : undefined;
}

/**
 * @param {string} root
 * @returns {string}
 */
function gitStatus(root) {
  return execFileSync(
    GIT_BIN,
    ["status", "--porcelain", "--", PLUGINS_DIR, MARKETPLACE],
    {
      cwd: root,
      encoding: "utf8",
      env: gitEnv(root),
    }
  );
}

/**
 * @param {string} status
 * @returns {{ readonly code: string, readonly file: string }[]}
 */
function parseGitStatus(status) {
  return status
    .split("\n")
    .filter(Boolean)
    .map(line => ({
      code: line.slice(0, 2),
      file: normalizeStatusPath(line.slice(3)),
    }));
}

/**
 * @param {string} file
 * @returns {string}
 */
function normalizeStatusPath(file) {
  const renamedPath = file.includes(" -> ") ? file.split(" -> ").at(-1) : file;
  return renamedPath.replace(/^"|"$/g, "");
}

/**
 * @param {string} file
 * @returns {string | undefined}
 */
function sourceToBuilt(file) {
  if (!file.startsWith(`${SOURCE_ROOT}/`)) {
    return undefined;
  }
  const [, , sourceName, ...rest] = file.split("/");
  if (!sourceName || rest.length === 0) {
    return undefined;
  }
  const builtName = sourceName === "base" ? "lisa" : `lisa-${sourceName}`;
  return [PLUGINS_DIR, builtName, ...rest].join("/");
}

/**
 * @param {string} file
 * @returns {string | undefined}
 */
function builtToSource(file) {
  if (!file.startsWith(`${PLUGINS_DIR}/lisa`)) {
    return undefined;
  }
  const [, builtName, ...rest] = file.split("/");
  if (!builtName || rest.length === 0) {
    return undefined;
  }
  const sourceName =
    builtName === "lisa" ? "base" : builtName.replace(/^lisa-/, "");
  return [SOURCE_ROOT, sourceName, ...rest].join("/");
}

/**
 * @param {PluginSyncFinding[]} findings
 * @returns {PluginSyncFinding[]}
 */
function dedupeFindings(findings) {
  const seen = new Set();
  return findings.filter(finding => {
    const key = `${finding.classification}:${finding.path}:${finding.counterpart ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Remove parent-hook Git environment so diagnostics inspect the requested repo.
 * Bare common-dir worktrees in Codex need explicit GIT_DIR/GIT_WORK_TREE.
 * @param {string} [root] Repository path the nested git command should inspect.
 * @returns {NodeJS.ProcessEnv} Process environment for nested git commands.
 */
function gitEnv(root) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  if (root) {
    const gitDir = linkedWorktreeGitDir(root);
    if (gitDir) {
      env.GIT_DIR = gitDir;
      env.GIT_WORK_TREE = root;
    }
  }
  return env;
}

/**
 * @param {string} root
 * @returns {string | undefined}
 */
function linkedWorktreeGitDir(root) {
  const dotGit = path.join(root, ".git");
  if (!existsSync(dotGit) || statSync(dotGit).isDirectory()) {
    return undefined;
  }
  const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
  if (!match) {
    return undefined;
  }
  const gitDir = match[1].trim();
  return path.isAbsolute(gitDir) ? gitDir : path.resolve(root, gitDir);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const report = explainPluginSync(process.argv[2] ?? process.cwd());
    process.stdout.write(report.text);
    process.exitCode = report.findings.length === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `plugin-sync-explain failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 2;
  }
}
