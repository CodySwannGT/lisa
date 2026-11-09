/**
 * The Claude `block-migration-edits.sh` hook WARNS and permits (operator
 * decision, 2026-11-08): entity drift is the risk, and a migration that cannot
 * be expressed in an entity (view options, grants, functions, policies,
 * backfills, seed data) is legitimate.
 *
 * What is pinned here is the OUTPUT CONTRACT the model depends on. stderr on
 * exit 0 is not shown to the model, so the warning must arrive as PreToolUse
 * JSON on stdout under `hookSpecificOutput.additionalContext` — and must carry
 * no `permissionDecision`, because "allow" would also skip the user's
 * permission prompt. The declared-gate path (a failing `migration-provenance`
 * task still refuses) is executed in
 * `tests/integration/pre-tool-refusal-scripts-resolve-gates.test.ts`.
 * @module tests/unit/hooks/block-migration-edits
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const HOOK = path.resolve("plugins/src/nestjs/hooks/block-migration-edits.sh");
const BASH = "/bin/bash";

/** The PreToolUse JSON shape this hook prints on stdout. */
interface HookOutput {
  readonly hookSpecificOutput?: {
    readonly hookEventName?: string;
    readonly permissionDecision?: string;
    readonly additionalContext?: string;
  };
}

describe("block-migration-edits.sh (Claude)", () => {
  let projectDir: string;

  beforeEach(async () => {
    // An empty project: no .lisa.config.json, so no declared gate decides.
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-migration-"));
  });

  afterEach(async () => {
    await fs.remove(projectDir);
  });

  const run = (
    filePath: string
  ): { status: number | null; stdout: string; stderr: string } => {
    const result = boundedSpawnSync({
      label: "the claude block-migration-edits hook",
      command: BASH,
      args: [HOOK],
      input: JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: path.join(projectDir, filePath) },
      }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    });
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };

  it.each([
    "src/database/migrations/1700000000000-CreateUsers.ts",
    "src/database/migrations/1700000000000-CreateUsers.js",
  ])("permits %s and hands the model the warning as JSON", migration => {
    const { status, stdout } = run(migration);

    expect(status).toBe(0);
    const output = JSON.parse(stdout) as HookOutput;
    expect(output.hookSpecificOutput?.hookEventName).toBe("PreToolUse");
    // No decision: the edit goes through the normal permission flow.
    expect(output.hookSpecificOutput?.permissionDecision).toBeUndefined();
    const context = output.hookSpecificOutput?.additionalContext ?? "";
    expect(context).toContain(migration);
    expect(context).toContain("Entity files are the source of truth");
    expect(context).toContain("bun run migration:generate --name=<Name>");
    expect(context).toContain(
      "view options, grants, functions, policies, backfills, seed data"
    );
    expect(context).toContain("writing the migration directly is fine");
    expect(context).toContain("class comment");
  });

  it("stays silent on a path outside a migrations directory", () => {
    const { status, stdout, stderr } = run("src/database/entities/user.ts");

    expect(status).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});
