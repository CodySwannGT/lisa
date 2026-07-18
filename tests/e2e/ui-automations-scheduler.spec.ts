/**
 * Playwright regression for the Automations section harness-scheduler probe (#1544).
 *
 * Maestro: this web console surface has no Maestro harness in the repo
 * (coverage is Playwright-only, same as other `lisa ui` e2e specs).
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  runUi,
  type ProbeResult,
  type StatusProbe,
} from "../../src/cli/ui-cmd.ts";
import {
  createAutomationsProbe,
  type AutomationsProbeValue,
} from "../../src/cli/ui-automations.ts";

const PROJECT_PREFIX = "lisa-auto-codyswanngt-lisa-";
const MATCHING_ID = `${PROJECT_PREFIX}intake-tickets`;
const UNRELATED_ID = "lisa-auto-other-repo-intake-tickets";
const TEN_MINUTE_CADENCE = "every 10 minutes";

/** A running console rooted at an isolated origin, plus its teardown. */
interface LiveConsole {
  readonly base: string;
  readonly close: () => Promise<void>;
}

/**
 * Launch `lisa ui` on an OS-assigned port with sync disabled.
 * @param destDir - Project root the console serves
 * @param probes - Injected status probes
 * @returns The console's loopback origin and a close handle
 */
async function launchConsole(
  destDir: string,
  probes: readonly StatusProbe[]
): Promise<LiveConsole> {
  const server = await runUi(destDir, { port: "0", sync: false }, { probes });
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

/**
 * Build a fixed automations probe result.
 * @param result - Tri-state probe result
 * @returns Probe registered under `automations`
 */
function automationsProbe(
  result: ProbeResult<AutomationsProbeValue>
): StatusProbe<AutomationsProbeValue> {
  return { id: "automations", timeoutMs: 1_000, run: async () => result };
}

/** Temp project dirs created this file, removed in afterEach. */
const createdDirs: string[] = [];

/**
 * Create a fresh temporary project directory, tracked for teardown.
 * @returns Absolute path to the new directory
 */
async function makeProjectDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-automations-e2e-"));
  createdDirs.push(dir);
  await writeFile(
    path.join(dir, ".lisa.config.json"),
    JSON.stringify({
      tracker: "github",
      github: { org: "CodySwannGT", repo: "lisa" },
    }),
    "utf8"
  );
  return dir;
}

test.afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

test("lists a real scheduled automation with its cadence", async ({ page }) => {
  const ui = await launchConsole(await makeProjectDir(), [
    automationsProbe({
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
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#automations`);
    const section = page.locator("#section-automations");
    await expect(
      section.locator("h1", { hasText: "Agent automations" })
    ).toBeVisible();
    await expect(
      section.locator(`[data-automation-id="${MATCHING_ID}"]`)
    ).toBeVisible();
    await expect(
      section.locator(`[data-automation-id="${MATCHING_ID}"]`)
    ).toContainText(TEN_MINUTE_CADENCE);
    await expect(
      section.getByText("intake-tickets", { exact: false })
    ).toBeVisible();
    await expect(
      section.getByText("every 10 min", { exact: true })
    ).toHaveCount(0);
  } finally {
    await ui.close();
  }
});

test("does not claim unrelated automations lacking the project prefix", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    automationsProbe({
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
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#automations`);
    await expect(
      page.locator(`[data-automation-id="${MATCHING_ID}"]`)
    ).toBeVisible();
    await expect(
      page.locator(`[data-automation-id="${UNRELATED_ID}"]`)
    ).toHaveCount(0);
    await expect(page.getByText(UNRELATED_ID)).toHaveCount(0);
  } finally {
    await ui.close();
  }
});

test("removing an automation removes it from the console on reload", async ({
  page,
}) => {
  const listed: AutomationsProbeValue = {
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
  };
  const empty: AutomationsProbeValue = {
    prefix: PROJECT_PREFIX,
    runtime: "codex",
    automations: [],
  };
  let current = listed;
  const ui = await launchConsole(await makeProjectDir(), [
    {
      id: "automations",
      timeoutMs: 1_000,
      run: async () => ({ state: "value", value: current }),
    },
  ]);
  try {
    await page.goto(`${ui.base}/#automations`);
    await expect(
      page.locator(`[data-automation-id="${MATCHING_ID}"]`)
    ).toBeVisible();

    current = empty;
    await page.reload();
    await page.goto(`${ui.base}/#automations`);
    await expect(
      page.locator(`[data-automation-id="${MATCHING_ID}"]`)
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="automations-scheduled-jobs-empty"]')
    ).toContainText("No lisa-auto-<project>- automations found");
  } finally {
    await ui.close();
  }
});

test("shows an empty or unknown state when no scheduler is configured", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    automationsProbe({
      state: "unknown",
      reason: "scheduler-unavailable",
      message:
        "No harness scheduler is configured (Codex automations directory absent and Claude /schedule listing unavailable)",
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#automations`);
    const empty = page.locator(
      '[data-testid="automations-scheduled-jobs-empty"]'
    );
    const section = page.locator("#section-automations");
    await expect(empty).toBeVisible();
    await expect(empty).toHaveAttribute("data-state", "unknown");
    await expect(empty).toContainText("scheduler-unavailable");
    await expect(
      section.locator('[data-testid="automations-scheduled-jobs"] tbody tr')
    ).toHaveCount(0);
    await expect(section.locator("[data-automation-id]")).toHaveCount(0);
    await expect(section.getByText("nightly-test-coverage")).toHaveCount(0);
  } finally {
    await ui.close();
  }
});

test("reads a real Codex automation.toml through the default probe", async ({
  page,
}) => {
  const projectDir = await makeProjectDir();
  const automationsDir = await mkdtemp(
    path.join(tmpdir(), "lisa-ui-automations-codex-")
  );
  createdDirs.push(automationsDir);
  const automationDir = path.join(automationsDir, MATCHING_ID);
  await mkdir(automationDir, { recursive: true });
  await writeFile(
    path.join(automationDir, "automation.toml"),
    [
      "version = 1",
      `id = "${MATCHING_ID}"`,
      'kind = "cron"',
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

  const ui = await launchConsole(projectDir, [
    createAutomationsProbe({
      cwd: projectDir,
      automationsDir,
      resolveIdentity: async () => ({
        owner: "CodySwannGT",
        repo: "lisa",
        project: "codyswanngt-lisa",
        automationPrefix: PROJECT_PREFIX,
      }),
      readClaudeScheduleListing: async () => null,
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#automations`);
    await expect(
      page.locator(`[data-automation-id="${MATCHING_ID}"]`)
    ).toBeVisible();
    await expect(
      page.locator(`[data-automation-id="${MATCHING_ID}"]`)
    ).toContainText(TEN_MINUTE_CADENCE);
    await expect(
      page.locator(`[data-automation-id="${UNRELATED_ID}"]`)
    ).toHaveCount(0);
  } finally {
    await ui.close();
  }
});
