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
    // Every mutation control still runs on the pull request; the one exclusion
    // is the packed-host journey, which owner decision 4 of
    // CodySwannGT/lisa#4587 took off the PR path (CodySwannGT/lisa#4606).
    expect(script(task as string)).toBe(
      "node scripts/lib/worktree-dependencies.mjs && LISA_TEST_TIMINGS_SCOPE=integration $npm_execpath run lisa-test-run -- --adapter vitest -- vitest run tests/integration --exclude='**/shared-runtime-packed-hosts.test.ts'"
    );
  });
});

/** The journey owner decision 4 of CodySwannGT/lisa#4587 took off the PR path. */
const PACKED_HOST_JOURNEY =
  "tests/integration/shared-runtime-packed-hosts.test.ts";

describe("packed-host journey scheduling (CodySwannGT/lisa#4606)", () => {
  it("runs at neither the pull-request nor the push moment", () => {
    for (const moment of ["pull-request", "push"]) {
      const task = taskAt(moment);
      expect(task, moment).not.toBeNull();
      expect(script(task as string), moment).toContain(
        "--exclude='**/shared-runtime-packed-hosts.test.ts'"
      );
    }
  });

  it("stays runnable by hand through its own script", () => {
    expect(script("test:integration:packed-hosts")).toBe(
      `node scripts/lib/worktree-dependencies.mjs && $npm_execpath run lisa-test-run -- --adapter vitest -- vitest run ${PACKED_HOST_JOURNEY}`
    );
  });

  it("tells a deferred run to use the hand-run script, not the excluding one", () => {
    // The journey defers off the reviewed CI Node and prints a remedy. A remedy
    // naming `test:integration` would now run a pass that excludes the journey.
    const journey = readFileSync(
      path.join(REPO_ROOT, PACKED_HOST_JOURNEY),
      "utf8"
    );
    expect(journey).toContain(
      "mise exec node@${CI_NODE} -- bun run test:integration:packed-hosts"
    );
    expect(journey).not.toContain("bun run test:integration`");
  });
});
