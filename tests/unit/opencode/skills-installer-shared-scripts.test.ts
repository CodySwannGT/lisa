/**
 * The OpenCode skills emit must produce a self-contained tree
 * (CodySwannGT/lisa#4642).
 *
 * Skill scripts import shared modules through `../../../scripts/<m>.mjs`. In a
 * Lisa plugin that lands on the plugin's own `scripts/` directory; in the
 * emitted tree it lands on `.opencode/skills/scripts/`, which the emit must
 * therefore write. These cases cover:
 *   - the guard helper itself, on a synthetic tree with an escaping import;
 *   - the real Lisa emit resolving every relative import inside `.opencode/`;
 *   - `session-manager.mjs --help` loading from a scratch emitted tree;
 *   - the emitter's transitive copy, manifest tracking, stale cleanup, and
 *     refusal to merge two different modules onto one emitted path.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROJECT_TYPE_ORDER } from "../../../src/core/config.js";
import { installSkills } from "../../../src/opencode/skills-installer.js";
import {
  extractRelativeSpecifiers,
  findUnresolvedImports,
  formatUnresolvedImport,
} from "../../../src/opencode/relative-imports.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();

/** The Lisa repository root (the real emit source). */
const LISA_ROOT = path.resolve(__dirname, "../../..");
/** OpenCode config dir all artifacts land under. */
const OPENCODE_DIR = ".opencode";
/** Skill whose scripts import shared modules three levels up. */
const SESSION_MANAGER = "lisa-session-manager";
/** Shared-module specifier as skill scripts write it. */
const SHARED_SPEC = "../../../scripts/shared.mjs";
/** Emitted location of the synthetic shared module, relative to `.opencode/`. */
const SHARED_REL = path.join("skills", "scripts", "shared.mjs");
/** Skill folder name used by the synthetic emitter cases. */
const DEMO_SKILL = "demo-skill";
/** Minimal SKILL.md for synthetic skills. */
const DEMO_SKILL_MD = "---\nname: demo-skill\ndescription: Demo\n---\n";

/**
 * Assert a tree is self-contained, failing with one line per escaping import.
 * @param root - Absolute root of the emitted tree.
 */
async function expectSelfContained(root: string): Promise<void> {
  const unresolved = await findUnresolvedImports(root);
  expect(unresolved.map(formatUnresolvedImport).join("\n")).toBe("");
}

describe("opencode/relative-imports guard", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("extracts static, re-export, side-effect and dynamic relative specifiers only", () => {
    const source = [
      'import { a } from "./a.mjs";',
      "export { b } from '../b.mjs';",
      'import "./side.mjs";',
      'const c = await import("../../c.mjs");',
      'import fs from "node:fs";',
      'import pkg from "some-package";',
    ].join("\n");
    expect(extractRelativeSpecifiers(source)).toEqual([
      "./a.mjs",
      "../b.mjs",
      "./side.mjs",
      "../../c.mjs",
    ]);
  });

  it("fails naming the importing file and the missing module when an import escapes the tree", async () => {
    const root = path.join(tempDir, OPENCODE_DIR);
    const importer = path.join(
      "skills",
      "lisa",
      DEMO_SKILL,
      "scripts",
      "x.mjs"
    );
    await fs.outputFile(
      path.join(root, importer),
      `import { y } from "${SHARED_SPEC}";\nimport { z } from "./z.mjs";\n`
    );
    await fs.outputFile(path.join(root, path.dirname(importer), "z.mjs"), "");

    const unresolved = await findUnresolvedImports(root);

    expect(unresolved).toEqual([
      { importer, specifier: SHARED_SPEC, target: SHARED_REL },
    ]);
    expect(formatUnresolvedImport(unresolved[0]!)).toContain(importer);
    expect(formatUnresolvedImport(unresolved[0]!)).toContain(SHARED_REL);
  });
});

describe("opencode/skills-installer emit against the real Lisa root", () => {
  let tempDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    destDir = path.join(tempDir, "project");
    // Every stack plus the wiki marker, so the guard sees every plugin that
    // can reach a host's `.opencode/` tree, not only the base plugin.
    await fs.outputFile(
      path.join(destDir, "wiki", "lisa-wiki.config.json"),
      "{}\n"
    );
    await installSkills(LISA_ROOT, destDir, [], PROJECT_TYPE_ORDER);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("resolves every relative import of every emitted module inside .opencode/", async () => {
    await expectSelfContained(path.join(destDir, OPENCODE_DIR));
  });

  it("loads session-manager.mjs --help from the emitted tree", () => {
    const script = path.join(
      destDir,
      OPENCODE_DIR,
      "skills",
      "lisa",
      SESSION_MANAGER,
      "scripts",
      "session-manager.mjs"
    );
    const result = boundedSpawnSync({
      label: "node session-manager.mjs --help (emitted OpenCode tree)",
      command: process.execPath,
      args: [script, "--help"],
      cwd: destDir,
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: node session-manager.mjs");
  });
});

describe("opencode/skills-installer shared-script emit", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await fs.ensureDir(destDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Seed a plugin with one skill importing `scripts/shared.mjs`, which itself
   * imports a sibling `scripts/dep.mjs`.
   * @param pluginName - Plugin directory name.
   * @param skillName - Skill directory name.
   * @param sharedBody - Content of the plugin's shared module.
   */
  async function seedPlugin(
    pluginName: string,
    skillName: string,
    sharedBody = 'export { dep } from "./dep.mjs";\n'
  ): Promise<void> {
    const pluginDir = path.join(lisaDir, "plugins", pluginName);
    const skillDir = path.join(pluginDir, "skills", skillName);
    await fs.outputFile(path.join(skillDir, "SKILL.md"), DEMO_SKILL_MD);
    await fs.outputFile(
      path.join(skillDir, "scripts", "main.mjs"),
      `import { dep } from "${SHARED_SPEC}";\nconsole.log(dep);\n`
    );
    await fs.outputFile(
      path.join(pluginDir, "scripts", "shared.mjs"),
      sharedBody
    );
    await fs.outputFile(
      path.join(pluginDir, "scripts", "dep.mjs"),
      "export const dep = 1;\n"
    );
    await fs.outputFile(path.join(pluginDir, "scripts", "unused.mjs"), "");
  }

  it("copies imported shared modules transitively and tracks them as managed", async () => {
    await seedPlugin("lisa", DEMO_SKILL);

    const result = await installSkills(lisaDir, destDir, []);

    const opencode = path.join(destDir, OPENCODE_DIR);
    const depRel = path.join("skills", "scripts", "dep.mjs");
    expect(result.managedFiles).toEqual(
      expect.arrayContaining([SHARED_REL, depRel])
    );
    expect(await fs.pathExists(path.join(opencode, SHARED_REL))).toBe(true);
    expect(await fs.pathExists(path.join(opencode, depRel))).toBe(true);
    expect(
      await fs.pathExists(
        path.join(opencode, "skills", "scripts", "unused.mjs")
      )
    ).toBe(false);
    await expectSelfContained(opencode);
  });

  it("deletes a previously managed shared module that is no longer imported", async () => {
    await seedPlugin("lisa", DEMO_SKILL);
    const staleRel = path.join("skills", "scripts", "retired.mjs");
    const stalePath = path.join(destDir, OPENCODE_DIR, staleRel);
    await fs.outputFile(stalePath, "export {};\n");

    const result = await installSkills(lisaDir, destDir, [staleRel]);

    expect(await fs.pathExists(stalePath)).toBe(false);
    expect(result.managedFiles).not.toContain(staleRel);
    expect(result.deleted).toEqual(["skills/scripts/retired.mjs"]);
  });

  it("refuses to emit two different modules onto the same shared path", async () => {
    await seedPlugin("lisa", DEMO_SKILL);
    await seedPlugin("lisa-rails", "other-skill", "export const dep = 2;\n");

    await expect(
      installSkills(lisaDir, destDir, [], ["rails"])
    ).rejects.toThrow(/skills[/\\]scripts[/\\]shared\.mjs/);
  });
});
