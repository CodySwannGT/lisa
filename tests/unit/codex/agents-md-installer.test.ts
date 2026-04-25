/**
 * Unit tests for the AGENTS.md create-only installer.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENTS_MD_FILENAME,
  AGENTS_MD_TEMPLATE,
  installAgentsMd,
} from "../../../src/codex/agents-md-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

describe("codex/agents-md-installer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("creates AGENTS.md when absent", async () => {
    const result = await installAgentsMd(tempDir);
    expect(result.created).toBe(true);
    expect(result.relativePath).toBe(AGENTS_MD_FILENAME);
    const written = await fs.readFile(
      path.join(tempDir, AGENTS_MD_FILENAME),
      "utf8"
    );
    expect(written).toBe(AGENTS_MD_TEMPLATE);
  });

  it("never overwrites an existing AGENTS.md", async () => {
    const existing = "# My existing project guidance\n\nDo not touch.\n";
    await fs.writeFile(
      path.join(tempDir, AGENTS_MD_FILENAME),
      existing,
      "utf8"
    );
    const result = await installAgentsMd(tempDir);
    expect(result.created).toBe(false);
    expect(result.relativePath).toBeUndefined();
    const after = await fs.readFile(
      path.join(tempDir, AGENTS_MD_FILENAME),
      "utf8"
    );
    expect(after).toBe(existing);
  });

  it("template mentions Lisa's directory layout", () => {
    expect(AGENTS_MD_TEMPLATE).toContain(".codex/agents/lisa/");
    expect(AGENTS_MD_TEMPLATE).toContain(".codex/skills/lisa/");
    expect(AGENTS_MD_TEMPLATE).toContain(".codex/lisa-rules/");
    expect(AGENTS_MD_TEMPLATE).toContain(".codex/hooks/lisa/");
  });

  it("template starts with a top-level heading", () => {
    expect(AGENTS_MD_TEMPLATE.startsWith("# ")).toBe(true);
  });
});
