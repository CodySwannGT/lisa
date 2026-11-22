/**
 * Import parsing and error branches of the OpenCode shared-script emit
 * (CodySwannGT/lisa#4642): comments are not followed, `require()` is, a real
 * import of a missing module fails with a named error, an import that leaves
 * `.opencode/skills/` is refused, and identical modules from two plugins are
 * copied once.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractRelativeSpecifiers } from "../../../src/opencode/relative-imports.js";
import { installSkills } from "../../../src/opencode/skills-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Manifest form of the synthetic shared module. */
const SHARED_ENTRY = "skills/scripts/shared.mjs";
/** Skill folder name for the synthetic plugin. */
const DEMO_SKILL = "demo-skill";

describe("opencode/relative-imports parsing", () => {
  it("ignores imports inside line-opening comments", () => {
    const source = [
      "/**",
      ' * import { gone } from "../../../scripts/gone.mjs";',
      " */",
      '// import { old } from "../../../scripts/old.mjs";',
      '/* import "../../../scripts/inline.mjs"; */ import "./kept.mjs";',
      'const glob = "src/**/*.ts";',
      'import { live } from "../../../scripts/live.mjs";',
    ].join("\n");
    expect(extractRelativeSpecifiers(source)).toEqual([
      "./kept.mjs",
      "../../../scripts/live.mjs",
    ]);
  });

  it("follows require() with a relative string literal", () => {
    expect(
      extractRelativeSpecifiers(
        'const a = require("./a.cjs");\nconst b = require("node:fs");\n'
      )
    ).toEqual(["./a.cjs"]);
  });
});

describe("opencode/shared-scripts-emitter error branches", () => {
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
   * Seed one skill script with the given body in a plugin.
   * @param pluginName - Plugin directory name.
   * @param skillName - Skill directory name.
   * @param body - Content of the skill's `scripts/main.mjs`.
   * @returns Absolute path of the seeded script.
   */
  async function seedScript(
    pluginName: string,
    skillName: string,
    body: string
  ): Promise<string> {
    const skillDir = path.join(
      lisaDir,
      "plugins",
      pluginName,
      "skills",
      skillName
    );
    await fs.outputFile(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: Demo\n---\n`
    );
    const script = path.join(skillDir, "scripts", "main.mjs");
    await fs.outputFile(script, body);
    return script;
  }

  it("ignores a commented-out escaping import of a missing module", async () => {
    await seedScript(
      "lisa",
      DEMO_SKILL,
      '// import "../../../scripts/missing.mjs";\nexport {};\n'
    );

    const result = await installSkills(lisaDir, destDir, []);

    expect(result.managedFiles.some(f => f.startsWith("skills/scripts/"))).toBe(
      false
    );
  });

  it("names the importer, specifier and source when an imported module is missing", async () => {
    const script = await seedScript(
      "lisa",
      DEMO_SKILL,
      'import "../../../scripts/missing.mjs";\n'
    );
    const missing = path.join(
      lisaDir,
      "plugins",
      "lisa",
      "scripts",
      "missing.mjs"
    );

    await expect(installSkills(lisaDir, destDir, [])).rejects.toThrow(
      `OpenCode emit: ${script} imports "../../../scripts/missing.mjs" but ${missing} does not exist`
    );
  });

  it("refuses an import that resolves outside .opencode/skills/scripts/ once emitted", async () => {
    await seedScript("lisa", DEMO_SKILL, 'import "../../../../outside.mjs";\n');

    await expect(installSkills(lisaDir, destDir, [])).rejects.toThrow(
      /resolves outside \.opencode\/skills\/scripts\/ once emitted/
    );
  });

  it("copies an identical module shipped by two plugins once", async () => {
    const body = 'import "../../../scripts/shared.mjs";\n';
    await seedScript("lisa", DEMO_SKILL, body);
    await seedScript("lisa-rails", "rails-skill", body);
    await Promise.all(
      ["lisa", "lisa-rails"].map(plugin =>
        fs.outputFile(
          path.join(lisaDir, "plugins", plugin, "scripts", "shared.mjs"),
          "export const same = 1;\n"
        )
      )
    );

    const result = await installSkills(lisaDir, destDir, [], ["rails"]);

    expect(result.managedFiles.filter(f => f === SHARED_ENTRY)).toHaveLength(1);
    expect(
      await fs.readFile(path.join(destDir, ".opencode", SHARED_ENTRY), "utf8")
    ).toBe("export const same = 1;\n");
  });
});
