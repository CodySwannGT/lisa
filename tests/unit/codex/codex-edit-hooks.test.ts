/**
 * Tests for the Codex edit-aware hook scripts that resolve target file paths
 * from the tool envelope — both single-file Edit/Write and multi-file
 * apply_patch.
 *
 * Codex (codex-cli 0.125.0) passes the apply_patch body as a STRING under
 * tool_input.command (verified by capturing real hook stdin). An earlier
 * version of block-migration-edits.sh read tool_input.command[1], which is
 * always null for a string — so apply_patch migration edits were not blocked.
 * These tests lock in the corrected behavior.
 * @module tests/unit/codex/codex-edit-hooks
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPTS_DIR = path.resolve("src/codex/scripts");
const LIB_PATH = path.join(SCRIPTS_DIR, "_extract-edit-paths.sh");
const BLOCK_MIGRATION_PATH = path.join(SCRIPTS_DIR, "block-migration-edits.sh");
const SHELL_WRITE_NUDGE_PATH = path.join(SCRIPTS_DIR, "shell-write-nudge.sh");
const BASH_PATH = "/bin/bash";

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

// Build an apply_patch tool envelope with the given patch body string.
const applyPatchEnvelope = (patch: string): string =>
  JSON.stringify({
    tool_name: "apply_patch",
    tool_input: { command: patch },
  });

// Build a single-file Edit tool envelope.
const editEnvelope = (filePath: string): string =>
  JSON.stringify({
    tool_name: "Edit",
    tool_input: { file_path: filePath },
  });

const bashEnvelope = (command: string): string =>
  JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
  });

// Source the helper and run lisa_extract_edit_paths against an envelope.
const extractPaths = (envelope: string): readonly string[] => {
  const result = spawnSync(
    BASH_PATH,
    ["-c", `source "${LIB_PATH}"; lisa_extract_edit_paths "$1"`, "_", envelope],
    { encoding: "utf-8" }
  );
  return result.stdout
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);
};

// Run block-migration-edits.sh against an envelope.
const runBlockMigration = (
  envelope: string
): { status: number | null; stderr: string } => {
  const result = spawnSync(BASH_PATH, [BLOCK_MIGRATION_PATH], {
    input: envelope,
    encoding: "utf-8",
  });
  return { status: result.status, stderr: result.stderr };
};

const runShellWriteNudge = (
  envelope: string
): { status: number | null; stderr: string } => {
  const result = spawnSync(BASH_PATH, [SHELL_WRITE_NUDGE_PATH], {
    input: envelope,
    encoding: "utf-8",
  });
  return { status: result.status, stderr: result.stderr };
};

describe("_extract-edit-paths.sh", () => {
  it("extracts a single Edit/Write file_path", () => {
    expect(extractPaths(editEnvelope("src/foo.ts"))).toEqual(["src/foo.ts"]);
  });

  it("extracts every file from a multi-file apply_patch patch", () => {
    const patch =
      "*** Begin Patch\n" +
      "*** Add File: src/a.ts\n+console.log(1);\n" +
      "*** Update File: src/b.ts\n@@\n-x\n+y\n" +
      "*** Delete File: src/c.ts\n" +
      "*** End Patch\n";
    expect(extractPaths(applyPatchEnvelope(patch))).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
  });

  it("returns nothing for an apply_patch with no file headers", () => {
    expect(
      extractPaths(applyPatchEnvelope("*** Begin Patch\n*** End Patch\n"))
    ).toEqual([]);
  });

  it("returns nothing when no path is present", () => {
    expect(extractPaths(JSON.stringify({ tool_name: "Bash" }))).toEqual([]);
  });
});

describe("block-migration-edits.sh", () => {
  const MIGRATION = "src/database/migrations/1700000000000-CreateUsers.ts";

  it("blocks an Edit to a TypeORM migration file", () => {
    const { status } = runBlockMigration(editEnvelope(MIGRATION));
    expect(status).toBe(EXIT_BLOCKED);
  });

  it("blocks an apply_patch that updates a migration file", () => {
    // Regression: the old command[1] parse never saw the patch body (command
    // is a string), so apply_patch migration edits slipped through.
    const patch = `*** Begin Patch\n*** Update File: ${MIGRATION}\n@@\n-a\n+b\n*** End Patch\n`;
    const { status, stderr } = runBlockMigration(applyPatchEnvelope(patch));
    expect(status).toBe(EXIT_BLOCKED);
    expect(stderr).toContain("block-migration-edits");
  });

  it("blocks an apply_patch that deletes a migration file", () => {
    const patch = `*** Begin Patch\n*** Delete File: ${MIGRATION}\n*** End Patch\n`;
    const { status } = runBlockMigration(applyPatchEnvelope(patch));
    expect(status).toBe(EXIT_BLOCKED);
  });

  it("blocks when a migration file is one of several files in a patch", () => {
    const patch =
      "*** Begin Patch\n" +
      "*** Add File: src/entity.ts\n+x\n" +
      `*** Update File: ${MIGRATION}\n@@\n-a\n+b\n` +
      "*** End Patch\n";
    const { status } = runBlockMigration(applyPatchEnvelope(patch));
    expect(status).toBe(EXIT_BLOCKED);
  });

  it("allows an Edit to a non-migration file", () => {
    const { status } = runBlockMigration(editEnvelope("src/users.entity.ts"));
    expect(status).toBe(EXIT_ALLOWED);
  });

  it("allows an apply_patch that touches no migration files", () => {
    const patch =
      "*** Begin Patch\n*** Add File: src/users.entity.ts\n+x\n*** End Patch\n";
    const { status } = runBlockMigration(applyPatchEnvelope(patch));
    expect(status).toBe(EXIT_ALLOWED);
  });
});

describe("shell-write-nudge.sh", () => {
  it("emits a non-blocking nudge for sed -i on a tracked file", () => {
    const { status, stderr } = runShellWriteNudge(
      bashEnvelope("sed -i '' 's/foo/bar/' src/codex/hooks-installer.ts")
    );
    expect(status).toBe(EXIT_ALLOWED);
    expect(stderr).toContain("prefer Edit/Write");
  });

  it("emits a non-blocking nudge for redirection into a tracked file", () => {
    const { status, stderr } = runShellWriteNudge(
      bashEnvelope("printf '%s\\n' value >> package.json")
    );
    expect(status).toBe(EXIT_ALLOWED);
    expect(stderr).toContain("prefer Edit/Write");
  });

  it("does not nudge for committed script execution", () => {
    const { status, stderr } = runShellWriteNudge(
      bashEnvelope("node scripts/build-plugins.sh")
    );
    expect(status).toBe(EXIT_ALLOWED);
    expect(stderr).toBe("");
  });
});
