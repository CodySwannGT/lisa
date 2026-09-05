/**
 * Scratch-tree fixture for the hook-registration audit suite.
 *
 * The fixture is materialised FROM the live repository rather than hand-written.
 * A hand-written tree would freeze one shape of five different manifest schemas
 * on the day it was typed, and the audit's whole job is to keep reading the
 * shapes that are actually shipped — so a schema change has to reach these
 * tests rather than going around them. The pruning is asserted safe by the
 * un-perturbed clone being green before any test perturbs one.
 * @module tests/unit/plugins/support/hook-registration-fixture
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { REPO_ROOT } from "../../../../scripts/lib/hook-registration-audit.mjs";
import { boundedSpawnSync } from "../../../helpers/io-latency-budget.js";

/** Manifest basenames the agent runtimes read registrations out of. */
const MANIFESTS = ["plugin.json", "hooks.json"] as const;

/** Manifest-bearing directories inside a plugin root. */
const MANIFEST_DIRS = [".claude-plugin", ".codex-plugin", ""] as const;

/**
 * The pruned copy every per-test fixture is cloned from. A mutable holder
 * rather than a rebound binding: the tree is built once and released once, and
 * the holder is the sanctioned shape for that in this codebase.
 */
const pristine: { current: string | undefined } = { current: undefined };

/**
 * Whether a path is markdown, or a directory that might contain some.
 * @param source Absolute path being considered for the copy.
 * @returns True when the copy should descend into or take this path.
 */
function markdownOnly(source: string): boolean {
  return fs.statSync(source).isDirectory() || source.endsWith(".md");
}

/**
 * Copy one repository-relative path into the fixture root.
 * @param root Fixture root to copy into.
 * @param relative Repository-relative path to copy.
 * @param filter Optional per-entry filter passed to `fs.cpSync`.
 */
function copyInto(
  root: string,
  relative: string,
  filter?: (source: string) => boolean
): void {
  const source = path.join(REPO_ROOT, relative);
  if (!fs.existsSync(source)) return;
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, filter });
}

/**
 * Repository-relative directories under `plugins/`, split into generated ports
 * and generator sources.
 * @returns The two lists, each sorted by the directory walk.
 */
function pluginRoots(): { ports: string[]; stacks: string[] } {
  const pluginsDir = path.join(REPO_ROOT, "plugins");
  const ports = fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== "src")
    .map(entry => path.join("plugins", entry.name));
  const stacks = fs
    .readdirSync(path.join(pluginsDir, "src"), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join("plugins", "src", entry.name));
  return { ports, stacks };
}

/**
 * Build (once) the pruned copy of everything the audit reads: hook scripts,
 * plugin manifests, the host enforcement dispatcher, and the generator sources'
 * skill and command markdown.
 * @returns Absolute path to the pristine fixture root.
 */
function pristineFixture(): string {
  if (pristine.current) return pristine.current;
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "lisa-hook-registration-src-")
  );
  const { ports, stacks } = pluginRoots();
  for (const pluginRoot of [...ports, ...stacks]) {
    copyInto(root, path.join(pluginRoot, "hooks"));
    for (const dir of MANIFEST_DIRS) {
      for (const manifest of MANIFESTS) {
        copyInto(root, path.join(pluginRoot, dir, manifest));
      }
    }
  }
  // Only a generator source's own skills and commands are consulted for the
  // "a shipped skill invokes it" channel, so the ports' copies are not carried.
  for (const stack of stacks) {
    copyInto(root, path.join(stack, "skills"), markdownOnly);
    copyInto(root, path.join(stack, "commands"), markdownOnly);
  }
  copyInto(
    root,
    path.join(
      "all",
      "copy-overwrite",
      "scripts",
      "lisa-enforcement-fallback.sh"
    )
  );
  pristine.current = root;
  return root;
}

/**
 * Clone the pristine fixture into a fresh scratch tree the caller may perturb.
 * @param tempRoots Accumulator the caller removes after each test.
 * @returns Absolute path to the clone.
 */
export function materializeFixture(tempRoots: string[]): string {
  const clone = fs.mkdtempSync(
    path.join(os.tmpdir(), "lisa-hook-registration-")
  );
  const source = pristineFixture();
  tempRoots.push(clone);
  fs.cpSync(source, clone, { recursive: true });
  return clone;
}

/** Remove the shared pristine fixture once a suite has finished with it. */
export function releaseFixtures(): void {
  const root = pristine.current;
  pristine.current = undefined;
  if (root) fs.rmSync(root, { recursive: true, force: true });
}

/**
 * Strip every string mentioning `hook` out of a JSON manifest — the shape a
 * list-append merge resolution leaves behind when it keeps one appended entry
 * and drops the other.
 * @param manifestPath Absolute path to the manifest to rewrite.
 * @param hook Hook basename to remove every mention of.
 */
export function dropRegistration(manifestPath: string, hook: string): void {
  const prune = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value.includes(hook) ? undefined : value;
    }
    if (Array.isArray(value)) {
      return value.map(prune).filter(entry => entry !== undefined);
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .map(([key, nested]) => [key, prune(nested)] as const)
          .filter(([, nested]) => nested !== undefined)
      );
    }
    return value;
  };
  const pruned = prune(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  fs.writeFileSync(manifestPath, `${JSON.stringify(pruned, null, 2)}\n`);
}

/**
 * Append a hook entry to a manifest's first `PreToolUse` matcher group — the
 * array a concurrent pair of branches both append to.
 * @param manifestPath Absolute path to the manifest to rewrite.
 * @param script Hook basename to register.
 */
export function addPreToolUseRegistration(
  manifestPath: string,
  script: string
): void {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    hooks: Record<string, { hooks: unknown[] }[]>;
  };
  const group = parsed.hooks.PreToolUse?.[0];
  if (!group) throw new Error(`${manifestPath} has no PreToolUse group`);
  group.hooks.push({
    type: "command",
    command: `\${CLAUDE_PLUGIN_ROOT}/hooks/${script}`,
  });
  fs.writeFileSync(manifestPath, `${JSON.stringify(parsed, null, 2)}\n`);
}

/**
 * Run the Antigravity generator over a built Claude plugin and return the
 * manifest it emits.
 *
 * Reading the COMMITTED `plugins/lisa-agy/hooks.json` proves a hook is present
 * in an artifact. Only regenerating proves the generator's own hook table is
 * LIVE — an entry present in the table that emits nothing is the exact shape
 * that produced zero Antigravity files while the build reported success.
 * @param sourcePluginDir Built Claude plugin to generate from.
 * @param outDir Directory the variant is written to.
 * @returns The parsed emitted `hooks.json`, or undefined when none was emitted.
 */
export function regenerateAgyManifest(
  sourcePluginDir: string,
  outDir: string
): Record<string, unknown> | undefined {
  const outcome = boundedSpawnSync({
    label: "generate-agy-plugin-artifacts.mjs",
    command: process.execPath,
    args: [
      path.join(REPO_ROOT, "scripts", "generate-agy-plugin-artifacts.mjs"),
      sourcePluginDir,
      outDir,
      "0.0.0-test",
    ],
    cwd: REPO_ROOT,
  });
  if (outcome.status !== 0) {
    throw new Error(
      `agy generator exited ${String(outcome.status)}: ${outcome.stderr}`
    );
  }
  const emitted = path.join(outDir, "hooks.json");
  if (!fs.existsSync(emitted)) return undefined;
  return JSON.parse(fs.readFileSync(emitted, "utf8")) as Record<
    string,
    unknown
  >;
}

/**
 * Every hook script basename an emitted Antigravity manifest points a command
 * at.
 * @param manifest A parsed Antigravity `hooks.json`.
 * @returns The basenames it registers.
 */
export function agyRegisteredScripts(
  manifest: Record<string, unknown> | undefined
): Set<string> {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      const match = /hooks\/([^/"\s]+\.sh)/.exec(value);
      if (match?.[1]) found.add(match[1]);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(walk);
    }
  };
  walk(manifest);
  return found;
}
