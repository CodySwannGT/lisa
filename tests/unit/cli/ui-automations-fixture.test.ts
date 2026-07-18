/**
 * Fixture coverage for the default Codex automations lister (#1544).
 * @module tests/unit/cli/ui-automations-fixture
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createAutomationsProbe } from "../../../src/cli/ui-automations.js";
import { runProbe } from "../../../src/cli/ui-status.js";

const PROJECT_PREFIX = "lisa-auto-codyswanngt-lisa-";
const MATCHING_ID = `${PROJECT_PREFIX}intake-tickets`;
const UNRELATED_ID = "lisa-auto-other-repo-intake-tickets";
const TEN_MINUTE_CADENCE = "every 10 minutes";

/** Temp dirs created this file, removed in afterEach. */
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

/**
 * Create a tracked temporary directory.
 * @returns Absolute path
 */
async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-automations-fix-"));
  tempDirs.push(dir);
  return dir;
}

describe("createAutomationsProbe Codex fixture", () => {
  it("reads a real Codex automation.toml through the default lister", async () => {
    const automationsDir = await makeTempDir();
    const automationDir = path.join(automationsDir, MATCHING_ID);
    await mkdir(automationDir, { recursive: true });
    await writeFile(
      path.join(automationDir, "automation.toml"),
      [
        "version = 1",
        `id = "${MATCHING_ID}"`,
        'kind = "cron"',
        'name = "Lisa: Build Intake"',
        'status = "ACTIVE"',
        'rrule = "FREQ=MINUTELY;INTERVAL=10"',
        'prompt = "Use the Lisa intake skill with arguments `CodySwannGT/lisa intake_mode=build`."',
        "",
      ].join("\n"),
      "utf8"
    );
    const unrelatedDir = path.join(automationsDir, UNRELATED_ID);
    await mkdir(unrelatedDir, { recursive: true });
    await writeFile(
      path.join(unrelatedDir, "automation.toml"),
      [
        "version = 1",
        `id = "${UNRELATED_ID}"`,
        'kind = "cron"',
        'status = "ACTIVE"',
        'rrule = "FREQ=HOURLY;INTERVAL=1"',
        'prompt = "unrelated"',
        "",
      ].join("\n"),
      "utf8"
    );

    const probe = createAutomationsProbe({
      cwd: await makeTempDir(),
      resolveIdentity: async () => ({
        owner: "CodySwannGT",
        repo: "lisa",
        project: "codyswanngt-lisa",
        automationPrefix: PROJECT_PREFIX,
      }),
      automationsDir,
      readClaudeScheduleListing: async () => null,
    });

    await expect(runProbe(probe)).resolves.toEqual({
      state: "value",
      value: {
        prefix: PROJECT_PREFIX,
        runtime: "codex",
        automations: [
          {
            id: MATCHING_ID,
            cadence: TEN_MINUTE_CADENCE,
            runtime: "codex",
            status: "ACTIVE",
            lastRunAt: null,
          },
        ],
      },
    });
  });
});
