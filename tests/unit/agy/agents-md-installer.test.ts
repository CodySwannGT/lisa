/**
 * Unit tests for src/agy/agents-md-installer.ts.
 *
 * Focuses on the multi-directory rule bake: agy gets the base plugin's eager
 * rules PLUS each detected stack plugin's eager rules concatenated into the
 * Lisa-managed block of AGENTS.md.
 * @module tests/unit/agy/agents-md-installer
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installAgyAgentsMd } from "../../../src/agy/agents-md-installer.js";

describe("agy/agents-md-installer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agy-agentsmd-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  /**
   * Create a rules/eager dir with the given markdown files.
   * @param name Subdirectory name under the temp dir.
   * @param files Map of filename to body.
   * @returns Absolute path to the created eager dir.
   */
  const makeEagerDir = async (
    name: string,
    files: Record<string, string>
  ): Promise<string> => {
    const dir = path.join(tempDir, name, "rules", "eager");
    await fs.ensureDir(dir);
    for (const [file, body] of Object.entries(files)) {
      await fs.writeFile(path.join(dir, file), body, "utf8");
    }
    return dir;
  };

  it("bakes rules from a single dir (string arg, backward compatible)", async () => {
    const baseDir = await makeEagerDir("lisa", { "a.md": "ALPHA RULE" });
    const dest = path.join(tempDir, "proj");
    const result = await installAgyAgentsMd(dest, baseDir);
    expect(result.rulesBaked).toBe(1);
    const body = await fs.readFile(path.join(dest, "AGENTS.md"), "utf8");
    expect(body).toContain("ALPHA RULE");
  });

  it("concatenates rules from base + stack eager dirs (array arg)", async () => {
    const baseDir = await makeEagerDir("lisa", {
      "a.md": "BASE RULE A",
      "b.md": "BASE RULE B",
    });
    const stackDir = await makeEagerDir("lisa-typescript", {
      "ts.md": "TYPESCRIPT STACK RULE",
    });
    const dest = path.join(tempDir, "proj");
    const result = await installAgyAgentsMd(dest, [baseDir, stackDir]);
    expect(result.rulesBaked).toBe(3);
    const body = await fs.readFile(path.join(dest, "AGENTS.md"), "utf8");
    expect(body).toContain("BASE RULE A");
    expect(body).toContain("BASE RULE B");
    expect(body).toContain("TYPESCRIPT STACK RULE");
  });

  it("ignores missing eager dirs without throwing", async () => {
    const baseDir = await makeEagerDir("lisa", { "a.md": "ONLY RULE" });
    const missing = path.join(tempDir, "lisa-nonexistent", "rules", "eager");
    const dest = path.join(tempDir, "proj");
    const result = await installAgyAgentsMd(dest, [baseDir, missing]);
    expect(result.rulesBaked).toBe(1);
  });

  it("refreshes the Lisa block on re-run while preserving host content", async () => {
    const baseDir = await makeEagerDir("lisa", { "a.md": "FIRST RULE" });
    const dest = path.join(tempDir, "proj");
    await installAgyAgentsMd(dest, [baseDir]);
    const agentsPath = path.join(dest, "AGENTS.md");
    const withHost = `${await fs.readFile(agentsPath, "utf8")}\n\nHOST NOTES`;
    await fs.writeFile(agentsPath, withHost, "utf8");

    const baseDir2 = await makeEagerDir("lisa2", { "a.md": "SECOND RULE" });
    const result = await installAgyAgentsMd(dest, [baseDir2]);
    expect(result.created).toBe(false);
    const body = await fs.readFile(agentsPath, "utf8");
    expect(body).toContain("SECOND RULE");
    expect(body).not.toContain("FIRST RULE");
    expect(body).toContain("HOST NOTES");
  });
});
