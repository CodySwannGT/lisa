/**
 * Keep expensive mutation controls in pull-request CI and out of local push.
 * @module tests/unit/config/bite-exclusion-vs-env-gate
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  readGates,
  resolveMoment,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** The gate whose task differs between the two moments. */
const GATE_ID = "test-integration";

/**
 * The task each moment resolves for the integration gate.
 * @param moment - `push` or `pull-request`.
 * @returns The task name, or null when the gate is absent at that moment.
 */
function taskAt(moment: string): string | null {
  const { gates, runner } = readGates() as {
    gates: object;
    runner: string;
  };
  const resolved = resolveMoment({ gates, moment, runner }) as {
    id: string;
    task: string | null;
  }[];
  return resolved.find(entry => entry.id === GATE_ID)?.task ?? null;
}

/**
 * A script body from this repository's own `package.json`.
 * @param name - Script name.
 * @returns The command it runs.
 */
function script(name: string): string {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
  ) as { scripts: Record<string, string> };
  return manifest.scripts[name] ?? "";
}

describe("mutation control scheduling", () => {
  it("excludes the Stryker-driving controls from local push", () => {
    const task = taskAt("push");
    expect(task).toBe("test:integration:push");
    const command = script(task as string);
    expect(command).toContain("--exclude='**/mutation-gate-bite.test.ts'");
    expect(command).toContain("--exclude='**/mutation-gate-diff-bite.test.ts'");
  });

  it("collects the integration controls in pull-request CI", () => {
    const task = taskAt("pull-request");
    expect(task).toBe("test:integration");
    expect(script(task as string)).toBe(
      "node scripts/lib/worktree-dependencies.mjs && $npm_execpath run lisa-test-run -- --adapter vitest -- vitest run tests/integration"
    );
  });
});
