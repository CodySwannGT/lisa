/**
 * Regression coverage for Codex automation cwd health reporting.
 *
 * @module tests/unit/strategies/automation-status-codex-cwd
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inspectCodexAutomationFleet } from "../../../plugins/src/base/scripts/automation-status-codex-adapter.mjs";
import { resolveExpectedAutomationFleet } from "../../../plugins/src/base/scripts/automation-status-expected-fleet.mjs";

const AUTOMATION_ID = "lisa-auto-codyswanngt-lisa-intake-tickets";
const RECENT_RUN_AT = "2026-05-26T12:00:00Z";

describe("automation-status Codex cwd health", () => {
  const tempDirs = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true }))
    );
    tempDirs.length = 0;
  });

  it("flags missing scheduler cwd paths as failing", async () => {
    const automationsDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "lisa-codex-automation-cwd-")
    );
    tempDirs.push(automationsDir);

    const missingCwd = path.join(automationsDir, "missing-repo");
    await writeAutomationFixture(automationsDir, missingCwd);

    const report = await inspectCodexAutomationFleet({
      expectedFleet: resolveExpectedAutomationFleet({
        config: {
          tracker: "github",
          github: { org: "CodySwannGT", repo: "lisa" },
        },
        detectedTypes: ["typescript"],
      }),
      automationsDir,
      now: RECENT_RUN_AT,
    });

    const buildItem = report.groups
      .flatMap(group => group.items)
      .find(item => item.id === AUTOMATION_ID);

    expect(buildItem).toEqual(
      expect.objectContaining({
        status: "FAILING",
        summary: expect.stringContaining("scheduler cwd is invalid"),
        remediation: expect.stringContaining(
          "durable non-bare project checkout"
        ),
      })
    );
    expect(buildItem?.observed).toContain(`${missingCwd} does not exist`);
  });
});

/**
 * Write a minimal Codex automation fixture with the supplied cwd.
 *
 * @param {string} automationsDir Parent automations fixture directory.
 * @param {string} cwd Configured automation cwd value.
 * @returns {Promise<void>} Resolves after the fixture is written.
 */
async function writeAutomationFixture(automationsDir, cwd) {
  const automationDir = path.join(automationsDir, AUTOMATION_ID);
  await fs.mkdir(automationDir, { recursive: true });
  await fs.writeFile(
    path.join(automationDir, "automation.toml"),
    [
      "version = 1",
      `id = "${AUTOMATION_ID}"`,
      'kind = "cron"',
      'prompt = "Use the Lisa intake skill with arguments `github intake_mode=build`."',
      'status = "ACTIVE"',
      'rrule = "FREQ=MINUTELY;INTERVAL=10"',
      `cwds = ["${cwd}"]`,
      "",
    ].join("\n")
  );
  await fs.writeFile(
    path.join(automationDir, "memory.md"),
    `${RECENT_RUN_AT}\n\n- Idle run.\n`
  );
}
