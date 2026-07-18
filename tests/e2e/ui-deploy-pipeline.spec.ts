/**
 * Playwright regression for Deploy pipeline stages live-status probe.
 *
 * Maestro: this web console surface has no Maestro harness in the repo
 * (coverage is Playwright-only, same as other `lisa ui` e2e specs).
 */
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  runUi,
  type DeployPipelineValue,
  type ProbeResult,
  type StatusProbe,
} from "../../src/cli/ui-cmd.ts";

/**
 * A running console rooted at an isolated origin, plus its teardown.
 */
interface LiveConsole {
  readonly base: string;
  readonly close: () => Promise<void>;
}

/**
 * Launch `lisa ui` on an OS-assigned port with sync disabled.
 * @param destDir - Project root the console serves
 * @param probes - Injected status probes
 * @returns Loopback origin and close handle
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
 * Build the deploy-pipeline-stages probe returning a fixed result.
 * @param result - Tri-state probe result
 * @returns Probe registered under deploy-pipeline-stages
 */
function deployPipelineProbe(
  result: ProbeResult<DeployPipelineValue>
): StatusProbe<DeployPipelineValue> {
  return {
    id: "deploy-pipeline-stages",
    timeoutMs: 1_000,
    run: async () => result,
  };
}

/** Temp project dirs created this test, removed in afterEach. */
const createdDirs: string[] = [];

/**
 * Create a fresh temporary project directory, tracked for teardown.
 * @returns Absolute path to the new directory
 */
async function makeProjectDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-deploy-"));
  createdDirs.push(dir);
  return dir;
}

test.afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

const table = "#deploy-pipeline-stages";

/**
 * Open the Deploy section and wait for the live pipeline table.
 * @param page - Playwright page
 * @param base - Console origin
 */
async function openDeployPipeline(
  page: import("@playwright/test").Page,
  base: string
): Promise<void> {
  await page.goto(`${base}/#deploy`);
  await expect(page.locator(`${table} h2`)).toContainText(
    "Deploy pipeline stages"
  );
}

test("environment with required reviewers shows an approval hold", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    deployPipelineProbe({
      state: "value",
      value: {
        stages: [
          {
            id: "hold:production",
            name: "Release approval — production",
            description:
              "Pauses at the release_approval job until a configured reviewer approves the GitHub environment `production`",
            environment: "production",
            active: true,
            reason: "",
          },
        ],
      },
    }),
  ]);
  try {
    await openDeployPipeline(page, ui.base);
    const row = page.locator(`${table} tbody tr`, {
      hasText: "Release approval — production",
    });
    await expect(row).toBeVisible();
    await expect(row.locator(".badge.pass")).toContainText("✓ active");
    await expect(row.locator(".badge.fail")).toHaveCount(0);
    await expect(row.locator(".badge.warn")).toHaveCount(0);
  } finally {
    await ui.close();
  }
});

test("environment without required reviewers shows no hold", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    deployPipelineProbe({
      state: "value",
      value: {
        stages: [
          {
            id: "hold:staging",
            name: "Release approval — staging",
            description: "Approval hold before staging deploys",
            environment: "staging",
            active: false,
            reason: "No required reviewers on GitHub environment 'staging'",
          },
        ],
      },
    }),
  ]);
  try {
    await openDeployPipeline(page, ui.base);
    const row = page.locator(`${table} tbody tr`, {
      hasText: "Release approval — staging",
    });
    await expect(row.locator(".badge.fail")).toContainText("✗ off");
    await expect(row.locator(".status-why")).toContainText(
      "No required reviewers"
    );
    await expect(row.locator(".badge.pass")).toHaveCount(0);
  } finally {
    await ui.close();
  }
});

test("configured-but-absent environment is unknown with reason, not unprotected", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    deployPipelineProbe({
      state: "value",
      value: {
        stages: [
          {
            id: "hold:ghost",
            name: "Release approval — ghost",
            description: "Configured environment missing from GitHub",
            environment: "ghost",
            active: "unknown",
            reason:
              "environment-not-found: GitHub environment 'ghost' is named in github.environments but was not found on the repository",
          },
        ],
      },
    }),
  ]);
  try {
    await openDeployPipeline(page, ui.base);
    const row = page.locator(`${table} tbody tr`, {
      hasText: "Release approval — ghost",
    });
    await expect(row.locator(".badge.warn")).toContainText("unknown");
    await expect(row.locator(".status-why")).toContainText(
      "environment-not-found"
    );
    await expect(row.locator(".badge.fail")).toHaveCount(0);
    await expect(row.locator(".badge.pass")).toHaveCount(0);
  } finally {
    await ui.close();
  }
});

test("unauthenticated gh never fabricates a hold state", async ({ page }) => {
  const ui = await launchConsole(await makeProjectDir(), [
    deployPipelineProbe({
      state: "value",
      value: {
        stages: [
          {
            id: "hold:production",
            name: "Release approval — production",
            description: "Environment-derived hold state",
            environment: "production",
            active: "unknown",
            reason: "not-authenticated: GitHub CLI is not authenticated",
          },
        ],
      },
    }),
  ]);
  try {
    await openDeployPipeline(page, ui.base);
    const row = page.locator(`${table} tbody tr`, {
      hasText: "Release approval — production",
    });
    await expect(row.locator(".badge.warn")).toContainText("unknown");
    await expect(row.locator(".status-why")).toContainText("not-authenticated");
    await expect(row.locator(".badge.pass")).toHaveCount(0);
    await expect(row.locator(".badge.fail")).toHaveCount(0);
  } finally {
    await ui.close();
  }
});
