/**
 * The generated Codex plugin tree must be self-contained
 * (CodySwannGT/lisa#4730).
 *
 * Codex loads skills from `plugins/<p>/.codex-plugin/skills/`, and skill
 * scripts import shared modules through `../../../scripts/<m>.mjs`. From an
 * emitted skill that specifier lands on `plugins/<p>/.codex-plugin/scripts/`,
 * which the generator must therefore write. These cases cover:
 *   - every committed `.codex-plugin/` tree resolving each relative import of
 *     each module inside itself (transitive by construction: emitted shared
 *     modules are themselves checked);
 *   - the guard failing, naming importer and missing target, once the
 *     generator stops emitting one shared module;
 *   - `session-manager.mjs --help` starting from the committed Codex tree;
 *   - the emitter's transitive copy, stale cleanup, determinism, and loud
 *     failure on a missing source.
 *
 * The import parse is the shared checker from the OpenCode twin (#4642) —
 * deliberately not the generator's own copy, so the guard is an independent
 * oracle for what the generator emits.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emitCodexSharedScripts,
  emitCodexSkillVariants,
} from "../../../scripts/generate-codex-plugin-artifacts.mjs";
import { extractRelativeSpecifiers as extractEmitterSpecifiers } from "../../../scripts/lib/codex-shared-scripts.mjs";
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

/** The Lisa repository root. */
const LISA_ROOT = path.resolve(__dirname, "../../..");
/** Built plugin directories. */
const PLUGINS_ROOT = path.join(LISA_ROOT, "plugins");
/** Codex artifact directory inside a built plugin. */
const CODEX_DIR = ".codex-plugin";
/** Shared-module specifier as skill scripts write it. */
const SHARED_SPEC = "../../../scripts/shared.mjs";
/** Synthetic skill name. */
const DEMO_SKILL = "demo-skill";
/** Emitted synthetic importer, relative to `.codex-plugin/`. */
const DEMO_IMPORTER = path.join("skills", DEMO_SKILL, "scripts", "main.mjs");
/** Emitted shared module, relative to `.codex-plugin/`. */
const SHARED_REL = path.join("scripts", "shared.mjs");
/** Emitted transitive dependency, relative to `.codex-plugin/`. */
const DEP_REL = path.join("scripts", "dep.mjs");

/**
 * Render every unresolved import under a tree, one line each.
 * @param root - Absolute root of the emitted tree.
 * @returns Diagnostic lines joined by newlines; empty when self-contained.
 */
async function unresolvedReport(root: string): Promise<string> {
  const unresolved = await findUnresolvedImports(root);
  return unresolved.map(formatUnresolvedImport).join("\n");
}

/**
 * List every built plugin that ships Codex skills.
 * @returns Absolute `.codex-plugin/` directories, sorted.
 */
function codexTreesWithSkills(): readonly string[] {
  return fs
    .readdirSync(PLUGINS_ROOT)
    .sort((a, b) => a.localeCompare(b))
    .map(name => path.join(PLUGINS_ROOT, name, CODEX_DIR))
    .filter(dir => fs.existsSync(path.join(dir, "skills")));
}

describe("committed Codex plugin trees", () => {
  it("finds at least the base plugin's Codex skills", () => {
    expect(codexTreesWithSkills()).toContain(
      path.join(PLUGINS_ROOT, "lisa", CODEX_DIR)
    );
  });

  it.each(codexTreesWithSkills().map(dir => [path.relative(LISA_ROOT, dir)]))(
    "%s resolves every relative import inside itself",
    async relDir => {
      expect(await unresolvedReport(path.join(LISA_ROOT, relDir))).toBe("");
    }
  );

  it("starts session-manager.mjs --help from the Codex tree", () => {
    const script = path.join(
      PLUGINS_ROOT,
      "lisa",
      CODEX_DIR,
      "skills",
      "lisa-session-manager",
      "scripts",
      "session-manager.mjs"
    );
    const result = boundedSpawnSync({
      label: "node session-manager.mjs --help (committed Codex tree)",
      command: process.execPath,
      args: [script, "--help"],
      cwd: LISA_ROOT,
    });
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: node session-manager.mjs");
  });
});

describe("generate-codex-plugin-artifacts shared-script emit", () => {
  let pluginDir: string;
  let codexDir: string;

  beforeEach(async () => {
    pluginDir = await createTempDir();
    codexDir = path.join(pluginDir, CODEX_DIR);
    const skillDir = path.join(pluginDir, "skills", DEMO_SKILL);
    await fs.outputFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: demo-skill\ndescription: Demo\n---\n"
    );
    await fs.outputFile(
      path.join(skillDir, "scripts", "main.mjs"),
      `import { dep } from "${SHARED_SPEC}";\nimport "./local.mjs";\nconsole.log(dep);\n`
    );
    await fs.outputFile(path.join(skillDir, "scripts", "local.mjs"), "");
    await fs.outputFile(
      path.join(pluginDir, "scripts", "shared.mjs"),
      'export { dep } from "./dep.mjs";\n'
    );
    await fs.outputFile(
      path.join(pluginDir, "scripts", "dep.mjs"),
      "export const dep = 1;\n"
    );
    await fs.outputFile(path.join(pluginDir, "scripts", "unused.mjs"), "");
  });

  afterEach(async () => cleanupTempDir(pluginDir));

  it("copies imported shared modules transitively and nothing else", async () => {
    emitCodexSkillVariants(pluginDir);

    expect(emitCodexSharedScripts(pluginDir)).toEqual([
      "scripts/dep.mjs",
      "scripts/shared.mjs",
    ]);
    expect(await fs.readFile(path.join(codexDir, DEP_REL), "utf8")).toBe(
      "export const dep = 1;\n"
    );
    expect(
      await fs.pathExists(path.join(codexDir, "scripts", "unused.mjs"))
    ).toBe(false);
    expect(await unresolvedReport(codexDir)).toBe("");
  });

  it("guard fails naming importer and missing target when a shared module is not emitted", async () => {
    emitCodexSkillVariants(pluginDir);
    emitCodexSharedScripts(pluginDir);
    await fs.remove(path.join(codexDir, DEP_REL));

    const report = await unresolvedReport(codexDir);

    expect(report).toBe(
      `${SHARED_REL} imports "./dep.mjs" but ${DEP_REL} is not in the tree`
    );
  });

  it("guard fails naming the skill script when no shared modules are emitted", async () => {
    emitCodexSkillVariants(pluginDir);

    expect(await unresolvedReport(codexDir)).toBe(
      `${DEMO_IMPORTER} imports "${SHARED_SPEC}" but ${SHARED_REL} is not in the tree`
    );
  });

  it("removes stale emitted shared modules and is byte-stable on re-run", async () => {
    const stale = path.join(codexDir, "scripts", "retired.mjs");
    await fs.outputFile(stale, "export {};\n");
    emitCodexSkillVariants(pluginDir);
    emitCodexSharedScripts(pluginDir);
    const first = await fs.readFile(path.join(codexDir, SHARED_REL), "utf8");

    emitCodexSkillVariants(pluginDir);
    const second = emitCodexSharedScripts(pluginDir);

    expect(await fs.pathExists(stale)).toBe(false);
    expect(second).toEqual(["scripts/dep.mjs", "scripts/shared.mjs"]);
    expect(await fs.readFile(path.join(codexDir, SHARED_REL), "utf8")).toBe(
      first
    );
  });

  it("emits no scripts directory when no skill imports a shared module", async () => {
    await fs.outputFile(
      path.join(pluginDir, "skills", DEMO_SKILL, "scripts", "main.mjs"),
      "console.log(1);\n"
    );
    emitCodexSkillVariants(pluginDir);

    expect(emitCodexSharedScripts(pluginDir)).toEqual([]);
    expect(await fs.pathExists(path.join(codexDir, "scripts"))).toBe(false);
  });

  it("fails loudly naming the importer when a shared source is missing", () => {
    fs.removeSync(path.join(pluginDir, "scripts", "dep.mjs"));
    emitCodexSkillVariants(pluginDir);

    expect(() => emitCodexSharedScripts(pluginDir)).toThrow(
      /scripts\/shared\.mjs.*\.\/dep\.mjs/
    );
  });

  it("fails loudly when an import escapes the .codex-plugin tree", () => {
    fs.outputFileSync(
      path.join(pluginDir, "skills", DEMO_SKILL, "scripts", "main.mjs"),
      'import "../../../../hooks/x.mjs";\n'
    );
    emitCodexSkillVariants(pluginDir);

    expect(() => emitCodexSharedScripts(pluginDir)).toThrow(
      /outside \.codex-plugin/
    );
  });

  it("refuses an import that would write outside .codex-plugin/scripts/", () => {
    fs.outputFileSync(path.join(pluginDir, "hooks.json"), "{}\n");
    fs.outputFileSync(
      path.join(pluginDir, "skills", DEMO_SKILL, "scripts", "main.mjs"),
      'import hooks from "../../../hooks.json";\n'
    );
    emitCodexSkillVariants(pluginDir);

    expect(() => emitCodexSharedScripts(pluginDir)).toThrow(
      `${DEMO_IMPORTER} imports "../../../hooks.json", which resolves outside .codex-plugin/scripts/`
    );
  });
});

describe("emitter specifier parse", () => {
  it("matches the TypeScript checker's parse", () => {
    const source = [
      'import { a } from "./a.mjs";',
      'export * from "../b.mjs";',
      'import "./side.mjs";',
      'const c = await import("../../c.mjs");',
      'const d = require("./d.cjs");',
      '// import { gone } from "./gone.mjs";',
      '  /* import { alsoGone } from "./also-gone.mjs"; */',
      'import fs from "node:fs";',
      'import { a as again } from "./a.mjs";',
    ].join("\n");

    const expected = [
      "./a.mjs",
      "../b.mjs",
      "./side.mjs",
      "../../c.mjs",
      "./d.cjs",
    ];
    expect(extractRelativeSpecifiers(source)).toEqual(expected);
    expect(extractEmitterSpecifiers(source)).toEqual(expected);
  });
});
