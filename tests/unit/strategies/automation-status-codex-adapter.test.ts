/**
 * Regression coverage for the Codex automation-status runtime adapter.
 *
 * Issue #801 adds the repo-scoped Codex backing-store reader that normalizes
 * automation prompts into shared command contracts and overlays recency/failure
 * metadata from automation memory files without mutating jobs.
 * @module tests/unit/strategies/automation-status-codex-adapter
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { resolveExpectedAutomationFleet } from "../../../plugins/src/base/scripts/automation-status-expected-fleet.mjs";
import { inspectCodexAutomationFleet } from "../../../plugins/src/base/scripts/automation-status-codex-adapter.mjs";

const BUILD_INTAKE_PROMPT =
  "Run one cron-safe Lisa build-intake cycle. Use the Lisa intake skill with arguments `github intake_mode=build`.";
const BUILD_INTAKE_RRULE = "FREQ=MINUTELY;INTERVAL=10";
const BUILD_INTAKE_AUTOMATION_ID = "lisa-auto-codyswanngt-lisa-intake-tickets";
const RECENT_RUN_AT = "2026-05-26T12:00:00Z";
const execFileAsync = promisify(execFile);

describe("automation-status Codex adapter (#801)", () => {
  const tempDirs = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true }))
    );
    tempDirs.length = 0;
  });

  it("reads repo-scoped automations and maps healthy, stale, failing, missing, and unsupported states", async () => {
    const automationsDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "lisa-codex-automation-status-")
    );
    tempDirs.push(automationsDir);

    await writeAutomationFixture(automationsDir, {
      id: "lisa-auto-codyswanngt-lisa-intake-repair",
      rrule: "FREQ=HOURLY;INTERVAL=1",
      prompt:
        "Run one cron-safe Lisa repair-intake cycle. Use the Lisa repair-intake skill with arguments `github intake_mode=both`.",
      memory: `2026-05-26T11:10:00Z\n\n- Repaired one blocked build issue cleanly.\n`,
    });
    await writeAutomationFixture(automationsDir, {
      id: "lisa-auto-codyswanngt-lisa-intake-prd",
      rrule: "FREQ=HOURLY;INTERVAL=1",
      prompt:
        "Run one cron-safe Lisa PRD-intake cycle. Use the Lisa intake skill with arguments `github intake_mode=prd`.",
      memory: `2026-05-26T06:00:00Z\n\n- Found no ready PRDs.\n`,
    });
    await writeAutomationFixture(automationsDir, {
      id: BUILD_INTAKE_AUTOMATION_ID,
      rrule: BUILD_INTAKE_RRULE,
      prompt: BUILD_INTAKE_PROMPT,
      memory: `2026-05-26T11:55:00Z\n\n- Latest run failed because GitHub auth was unavailable.\n`,
    });
    await writeAutomationFixture(automationsDir, {
      id: "lisa-auto-unrelated-other-repo-intake-tickets",
      rrule: BUILD_INTAKE_RRULE,
      prompt:
        "Run one unrelated build-intake cycle. Use the Lisa intake skill with arguments `github intake_mode=build`.",
      memory: `2026-05-26T11:55:00Z\n\n- Unrelated repo run.\n`,
    });

    const expectedFleet = resolveExpectedAutomationFleet({
      config: {
        tracker: "github",
        github: {
          org: "CodySwannGT",
          repo: "lisa",
        },
      },
      detectedTypes: ["typescript"],
      autoStartPrds: true,
    });

    const report = await inspectCodexAutomationFleet({
      expectedFleet,
      automationsDir,
      now: RECENT_RUN_AT,
    });

    expect(report.runtime).toContain("Codex automations");
    expect(report.observedAutomations).toHaveLength(3);

    const items = report.groups.flatMap(group => group.items);

    expect(items).toContainEqual(
      expect.objectContaining({
        id: "lisa-auto-codyswanngt-lisa-intake-repair",
        status: "HEALTHY",
      })
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        id: "lisa-auto-codyswanngt-lisa-intake-prd",
        status: "STALE",
        summary: "last recorded run is stale for the expected cadence",
      })
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        id: BUILD_INTAKE_AUTOMATION_ID,
        status: "FAILING",
        summary: "latest recorded run failed",
      })
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        id: "lisa-auto-codyswanngt-lisa-exploratory-prds",
        status: "MISSING",
      })
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        id: "lisa-auto-codyswanngt-lisa-exploratory-bugs",
        status: "UNSUPPORTED",
      })
    );
  });

  it("inspects automation files read-only", async () => {
    const automationsDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "lisa-codex-automation-readonly-")
    );
    tempDirs.push(automationsDir);

    await writeAutomationFixture(automationsDir, {
      id: BUILD_INTAKE_AUTOMATION_ID,
      rrule: BUILD_INTAKE_RRULE,
      prompt: BUILD_INTAKE_PROMPT,
      memory: `2026-05-26T11:55:00Z\n\n- Idle run.\n`,
    });

    const before = await snapshotAutomationDir(automationsDir);

    await inspectCodexAutomationFleet({
      expectedFleet: resolveExpectedAutomationFleet({
        config: {
          tracker: "github",
          github: {
            org: "CodySwannGT",
            repo: "lisa",
          },
        },
        detectedTypes: ["typescript"],
      }),
      automationsDir,
      now: "2026-05-26T12:00:00Z",
    });

    const after = await snapshotAutomationDir(automationsDir);
    expect(after).toEqual(before);
  });
});

/**
 * Create one temporary Codex automation fixture for adapter tests.
 *
 * @param {string} automationsDir Parent automations fixture directory.
 * @param {{
 *   readonly id: string
 *   readonly rrule: string
 *   readonly prompt: string
 *   readonly memory: string
 *   readonly cwd?: string
 * }} input Fixture values to write.
 * @returns {Promise<void>} Resolves after the fixture files are written.
 */
async function writeAutomationFixture(automationsDir, input) {
  const automationDir = path.join(automationsDir, input.id);
  const cwd = input.cwd ?? (await createGitWorkTreeFixture(automationsDir));
  await fs.mkdir(automationDir, { recursive: true });
  await fs.writeFile(
    path.join(automationDir, "automation.toml"),
    [
      "version = 1",
      `id = "${input.id}"`,
      'kind = "cron"',
      `name = "${input.id}"`,
      `prompt = "${escapeTomlString(input.prompt)}"`,
      'status = "ACTIVE"',
      `rrule = "${input.rrule}"`,
      'model = "gpt-5.4"',
      'reasoning_effort = "medium"',
      'execution_environment = "local"',
      `cwds = ["${escapeTomlString(cwd)}"]`,
      "",
    ].join("\n")
  );
  await fs.writeFile(path.join(automationDir, "memory.md"), input.memory);
}

/**
 * Create a tiny valid Git work tree for cwd health checks.
 *
 * @param {string} automationsDir Parent fixture directory.
 * @returns {Promise<string>} Path to the created work tree.
 */
async function createGitWorkTreeFixture(automationsDir) {
  const reposDir = path.join(automationsDir, "_repos");
  await fs.mkdir(reposDir, { recursive: true });
  const repoDir = await fs.mkdtemp(path.join(reposDir, "repo-"));
  await execFileAsync("git", ["init"], { cwd: repoDir });
  return repoDir;
}

/**
 * Snapshot fixture automation contents to verify adapter reads remain read-only.
 *
 * @param {string} dir Fixture automation directory.
 * @returns {Promise<Record<string, { automationToml: string, memory: string }>>}
 *   Snapshot of fixture file contents keyed by automation directory name.
 */
async function snapshotAutomationDir(dir) {
  const files = await fs.readdir(dir, { withFileTypes: true });
  const sortedFiles = files.toSorted((left, right) =>
    left.name.localeCompare(right.name)
  );
  const snapshot = {};
  for (const entry of sortedFiles) {
    if (!entry.isDirectory()) {
      continue;
    }
    const automationDir = path.join(dir, entry.name);
    const automationTomlPath = path.join(automationDir, "automation.toml");
    const hasAutomationToml = await fs
      .access(automationTomlPath)
      .then(() => true)
      .catch(() => false);
    if (!hasAutomationToml) {
      continue;
    }
    const automationToml = await fs.readFile(automationTomlPath, "utf8");
    const memory = await fs.readFile(
      path.join(automationDir, "memory.md"),
      "utf8"
    );
    snapshot[entry.name] = { automationToml, memory };
  }
  return snapshot;
}

/**
 * Escape a plain string for the limited TOML fixture format used in these tests.
 *
 * @param {string} value Raw string value.
 * @returns {string} TOML-safe string literal contents.
 */
function escapeTomlString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
