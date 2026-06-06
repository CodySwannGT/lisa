/**
 * Unit tests for the CLAUDE.md pointer installer.
 * @module tests/unit/claude/claude-md-installer
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLAUDE_MD_AGENTS_IMPORT,
  CLAUDE_MD_FILENAME,
  installClaudeMd,
} from "../../../src/claude/claude-md-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

describe("claude/claude-md-installer", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("writes a thin CLAUDE.md that imports the canonical AGENTS.md", async () => {
    const result = await installClaudeMd(dir);

    expect(result.created).toBe(true);
    expect(result.relativePath).toBe(CLAUDE_MD_FILENAME);
    const written = await fs.readFile(
      path.join(dir, CLAUDE_MD_FILENAME),
      "utf8"
    );
    expect(written).toContain(CLAUDE_MD_AGENTS_IMPORT);
    // It is a pointer, not a duplicate of governance content.
    expect(written).not.toContain("## Lisa Governance");
  });

  it("never overwrites an existing CLAUDE.md", async () => {
    const existing = "# Host owns this\n";
    await fs.writeFile(path.join(dir, CLAUDE_MD_FILENAME), existing, "utf8");

    const result = await installClaudeMd(dir);

    expect(result.created).toBe(false);
    expect(result.relativePath).toBeUndefined();
    const after = await fs.readFile(path.join(dir, CLAUDE_MD_FILENAME), "utf8");
    expect(after).toBe(existing);
  });
});
