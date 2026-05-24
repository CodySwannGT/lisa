/**
 * Regression tests for issue #549 — the Codex artifact generator
 * (scripts/generate-codex-plugin-artifacts.mjs) must be a clean no-op for
 * plugins that ship no skills/ directory, and must never touch commands/.
 *
 * The sibling skill-agents-walk.test.ts already exercises the writeSkillAgents
 * walk against synthetic temp-dir plugins (unit level). These tests close the
 * gap #549 specifically asks to codify: assert the *actual* built and source
 * plugin trees that ship in this repo satisfy the acceptance criteria, so a
 * future regression in the generator (or a stray hand-authored file) is caught:
 *
 *   AC1 — a skills-less built plugin (lisa-cdk, lisa-typescript) produces zero
 *         agents/openai.yaml.
 *   AC2 — no openai.yaml exists under ANY commands/ directory, across both the
 *         source-of-truth tree (plugins/src/base) and every generated plugin
 *         (plugins/lisa, plugins/lisa-*).
 *
 * Beyond scanning the shipped tree, these tests also drive the generator's
 * writeSkillAgents directly against a built plugin dir to prove the no-op is a
 * property of the code, not just of the current checked-in artifacts.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { writeSkillAgents } from "../../../scripts/generate-codex-plugin-artifacts.mjs";

/** Repo root, resolved from this test file's location. */
const REPO_ROOT = path.resolve(__dirname, "../../..");
/** The built-plugins directory that build:plugins writes into. */
const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");
/** The artifact filename the generator emits per skill. */
const OPENAI_YAML = "openai.yaml";
/** Built plugins that ship no skills/ directory (hooks-/rules-only). */
const SKILLS_LESS_BUILT_PLUGINS = ["lisa-cdk", "lisa-typescript"] as const;

/**
 * Recursively collect every file path under `dir` whose basename equals `name`.
 *
 * @param dir Absolute directory to walk (returns [] if it does not exist).
 * @param name Exact basename to match.
 * @returns Absolute paths of every matching file in the subtree.
 */
async function findByBasename(dir: string, name: string): Promise<string[]> {
  if (!(await fs.pathExists(dir))) {
    return [];
  }
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return findByBasename(full, name);
      }
      return entry.isFile() && entry.name === name ? [full] : [];
    })
  );
  return nested.flat();
}

/**
 * List the immediate child directory names of `dir`.
 *
 * @param dir Absolute directory to list (returns [] if it does not exist).
 * @returns Sorted directory names directly under `dir`.
 */
async function childDirs(dir: string): Promise<string[]> {
  if (!(await fs.pathExists(dir))) {
    return [];
  }
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

describe("codex/skills-less-plugin-noop (#549)", () => {
  describe("AC1: skills-less built plugins emit zero openai.yaml", () => {
    it.each(SKILLS_LESS_BUILT_PLUGINS)(
      "%s has no skills/ directory",
      async pluginName => {
        const skillsDir = path.join(PLUGINS_DIR, pluginName, "skills");
        expect(await fs.pathExists(skillsDir)).toBe(false);
      }
    );

    it.each(SKILLS_LESS_BUILT_PLUGINS)(
      "%s contains zero openai.yaml files",
      async pluginName => {
        const pluginDir = path.join(PLUGINS_DIR, pluginName);
        expect(await fs.pathExists(pluginDir)).toBe(true);
        const yamls = await findByBasename(pluginDir, OPENAI_YAML);
        expect(yamls).toEqual([]);
      }
    );

    it.each(SKILLS_LESS_BUILT_PLUGINS)(
      "running writeSkillAgents on %s creates nothing",
      async pluginName => {
        const pluginDir = path.join(PLUGINS_DIR, pluginName);
        const before = await findByBasename(pluginDir, OPENAI_YAML);
        expect(() => writeSkillAgents(pluginDir)).not.toThrow();
        const after = await findByBasename(pluginDir, OPENAI_YAML);
        // The generator must not have written (or removed) any artifact.
        expect(after).toEqual(before);
        expect(after).toEqual([]);
      }
    );
  });

  describe("AC2: no openai.yaml under any commands/ directory", () => {
    /**
     * Every plugin tree #549 cares about: the source-of-truth base plugin and
     * every generated plugin directory (plugins/lisa, plugins/lisa-*).
     * @returns Absolute paths of plugin roots to scan.
     */
    async function pluginRootsToScan(): Promise<string[]> {
      const generated = (await childDirs(PLUGINS_DIR))
        .filter(name => name === "lisa" || name.startsWith("lisa-"))
        .map(name => path.join(PLUGINS_DIR, name));
      const sourceBase = path.join(PLUGINS_DIR, "src", "base");
      return [sourceBase, ...generated];
    }

    it("plugins/src/base has at least one commands/ dir but no openai.yaml in it", async () => {
      // Sanity: the source base plugin genuinely ships commands/, so the
      // "no openai.yaml under commands/" assertion below is meaningful and not
      // vacuously true.
      const sourceBase = path.join(PLUGINS_DIR, "src", "base");
      const commandsDir = path.join(sourceBase, "commands");
      expect(await fs.pathExists(commandsDir)).toBe(true);
      const yamls = await findByBasename(commandsDir, OPENAI_YAML);
      expect(yamls).toEqual([]);
    });

    it("no openai.yaml exists under any commands/ directory across source and generated plugins", async () => {
      const roots = await pluginRootsToScan();
      expect(roots.length).toBeGreaterThan(0);

      const offenders: string[] = [];
      for (const root of roots) {
        const allYamls = await findByBasename(root, OPENAI_YAML);
        for (const yamlPath of allYamls) {
          const rel = path.relative(REPO_ROOT, yamlPath);
          // path.sep-aware check that the artifact lives under a commands/ dir.
          if (rel.split(path.sep).includes("commands")) {
            offenders.push(rel);
          }
        }
      }

      expect(offenders).toEqual([]);
    });
  });
});
