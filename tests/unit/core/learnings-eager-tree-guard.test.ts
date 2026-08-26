/**
 * Containment regression coverage for the learnings ledger's write boundary.
 *
 * Lisa 2.232.0 scaffolded the machine ledger into `.claude/rules/` — an
 * auto-loaded rules tree — which both injected the raw ledger into every
 * session and put a merge-hostile file where nothing watched it (19 captured
 * learnings were destroyed downstream with no error). Config validation already
 * rejects a `learnings.file` override that points into an eager tree; these
 * tests pin the LAST line of defense: the shared resolve-and-contain helper
 * every learnings writer funnels through must refuse an eager-tree target no
 * matter which caller produced the path.
 * @module tests/unit/core/learnings-eager-tree-guard
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveSafeLearningTarget } from "../../../src/core/learnings-file-safety.js";
import { persistLearningEntry } from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CLAUDE_RULES_LEDGER = ".claude/rules/PROJECT_LEARNINGS.md";
const CANONICAL_LEDGER = ".lisa/PROJECT_LEARNINGS.md";

const EAGER_PATHS = [
  CLAUDE_RULES_LEDGER,
  ".claude/rules/nested/PROJECT_LEARNINGS.md",
  ".cursor/rules/PROJECT_LEARNINGS.md",
  ".github/instructions/PROJECT_LEARNINGS.md",
  ".agents/rules/PROJECT_LEARNINGS.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
] as const;

const COLD_PATHS = [
  CANONICAL_LEDGER,
  ".lisa/PROJECT_LEARNINGS.overflow.md",
  "docs/state/PROJECT_LEARNINGS.md",
] as const;

describe("learnings write-target eager-tree guard", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it.each(EAGER_PATHS)("refuses to resolve %s as a ledger target", relative => {
    expect(() => resolveSafeLearningTarget(tempDir, relative)).toThrow(
      /auto-loaded/iu
    );
  });

  it.each(COLD_PATHS)("resolves the cold ledger path %s", relative => {
    const { target } = resolveSafeLearningTarget(tempDir, relative);
    expect(target).toBe(path.resolve(tempDir, relative));
  });

  it("names the offending surface and the canonical location", () => {
    expect(() =>
      resolveSafeLearningTarget(tempDir, CLAUDE_RULES_LEDGER)
    ).toThrow(/\.claude\/rules[\s\S]*\.lisa\/PROJECT_LEARNINGS\.md/u);
  });

  it("rejects a traversal path that lands back inside an eager tree", () => {
    expect(() =>
      resolveSafeLearningTarget(tempDir, ".lisa/../.claude/rules/L.md")
    ).toThrow(/auto-loaded/iu);
  });

  it("refuses the write and creates nothing when config points at a rules tree", async () => {
    await fse.writeJson(path.join(tempDir, ".lisa.config.json"), {
      learnings: { file: CLAUDE_RULES_LEDGER },
    });
    await expect(
      persistLearningEntry(tempDir, {
        id: "learning-1",
        fingerprint: "learning-fingerprint-1",
        rule: "Rule.",
        why: "Reason.",
        provenance: ["issue:#1"],
        first_learned: "2026-08-12",
        last_confirmed: "2026-08-12",
        confidence: "high",
      })
    ).rejects.toThrow(/auto-loaded/iu);
    expect(await fse.pathExists(path.join(tempDir, ".claude"))).toBe(false);
  });
});
