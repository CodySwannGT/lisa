/**
 * Lisa's own `AGENTS.md` must already be what Lisa's own reconciler produces.
 *
 * `doctor` runs the instruction-files migration unconditionally and it is a
 * mutating check — there is no dry-run mode. So if the committed `AGENTS.md`
 * lacks a block the reconciler adds, every `doctor` run in this repository
 * dirties the working tree, and `apply` then refuses to run because the tree is
 * dirty. The tool blocks itself, in its own repository, for everyone.
 *
 * WU-A's stated contract was idempotence: reconciling an already-reconciled
 * file writes nothing. That contract only holds for this repository if the
 * committed bytes are the reconciled bytes, which is what this test pins.
 *
 * The migration runs against a faithful copy rather than the repository root so
 * the test can never be the thing that dirties the tree it is defending.
 * @module tests/unit/core/instruction-files-self-host
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrateInstructionFiles } from "../../../src/core/instruction-files-migration.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);

/**
 * Every repository file the migration reads when deciding what `AGENTS.md`
 * should contain: the file itself, the config that names the harness and the
 * learnings ledger, and the legacy rules document whose existence decides
 * whether the pointer carries a transition paragraph.
 */
const INPUTS = [
  "AGENTS.md",
  "CLAUDE.md",
  ".lisa.config.json",
  ".claude/rules/PROJECT_RULES.md",
];

describe("Lisa's own instruction files", () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "lisa");
    await Promise.all(
      INPUTS.map(async relativePath => {
        const source = path.join(REPO_ROOT, relativePath);
        if (!(await fs.pathExists(source))) return;
        await fs.copy(source, path.join(projectDir, relativePath));
      })
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("reconciles to byte-identical AGENTS.md, so doctor leaves a clean tree clean", async () => {
    const agentsMd = path.join(projectDir, "AGENTS.md");
    const committed = await fs.readFile(agentsMd, "utf8");

    // relocateLearnings is off for the same reason apply turns it off: it moves
    // a ledger this copy does not have, and it is not what governs AGENTS.md.
    const result = await migrateInstructionFiles(projectDir, {
      relocateLearnings: false,
    });

    expect(await fs.readFile(agentsMd, "utf8")).toBe(committed);
    expect(
      result.actions.filter(action => action.includes("AGENTS.md"))
    ).toEqual([]);
  });

  it("is a no-op on a repeat run", async () => {
    await migrateInstructionFiles(projectDir, { relocateLearnings: false });

    const second = await migrateInstructionFiles(projectDir, {
      relocateLearnings: false,
    });

    expect(second.changed).toBe(false);
  });
});
