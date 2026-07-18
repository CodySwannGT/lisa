/**
 * Playwright regression for Monitoring → Connected providers live probes.
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
  type ProbeResult,
  type StatusProbe,
} from "../../src/cli/ui-cmd.ts";
import type { ObservabilityProviderValue } from "../../src/cli/ui-observability-providers.ts";

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
 * Build a fixed observability provider probe.
 * @param id - Probe id
 * @param result - Tri-state result
 * @returns Status probe
 */
function providerProbe(
  id: string,
  result: ProbeResult<ObservabilityProviderValue>
): StatusProbe<ObservabilityProviderValue> {
  return { id, timeoutMs: 1_000, run: async () => result };
}

/** Temp project dirs created this test, removed in afterEach. */
const createdDirs: string[] = [];

/**
 * Create a fresh temporary project directory, tracked for teardown.
 * @returns Absolute path to the new directory
 */
async function makeProjectDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-obs-"));
  createdDirs.push(dir);
  return dir;
}

test.afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

/**
 * Locator for a Connected providers status cell.
 * @param page - Playwright page
 * @param provider - data-provider attribute
 * @returns Locator
 */
function statusCell(
  page: import("@playwright/test").Page,
  provider: string
): import("@playwright/test").Locator {
  return page.locator(`#section-monitor td[data-provider="${provider}"]`);
}

test("missing AWS credentials paint unknown, never disconnected", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    providerProbe("sentry", {
      state: "value",
      value: { status: "connected" },
    }),
    providerProbe("cloudwatch-alarms", {
      state: "unknown",
      reason: "not-authenticated",
      message: "AWS credentials are not authenticated for this machine",
    }),
    providerProbe("x-ray", {
      state: "unknown",
      reason: "not-authenticated",
      message: "AWS credentials are not authenticated for this machine",
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#monitor`);
    await expect(statusCell(page, "cloudwatch-alarms")).toContainText(
      "unknown"
    );
    await expect(statusCell(page, "cloudwatch-alarms")).toContainText(
      "not-authenticated"
    );
    await expect(statusCell(page, "cloudwatch-alarms")).not.toContainText(
      "disconnected"
    );
    await expect(statusCell(page, "cloudwatch-alarms")).not.toContainText(
      "✗ off"
    );
    await expect(statusCell(page, "x-ray")).toContainText("unknown");
    await expect(statusCell(page, "x-ray")).toContainText("not-authenticated");
    await expect(statusCell(page, "x-ray")).not.toContainText("disconnected");
  } finally {
    await ui.close();
  }
});

test("credentials with zero alarms show connected-but-empty", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    providerProbe("sentry", {
      state: "unknown",
      reason: "not-authenticated",
      message: "Sentry auth/MCP is not reachable",
    }),
    providerProbe("cloudwatch-alarms", {
      state: "value",
      value: { status: "connected-but-empty", emptyKind: "alarms" },
    }),
    providerProbe("x-ray", {
      state: "value",
      value: { status: "connected-but-empty", emptyKind: "traces" },
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#monitor`);
    await expect(statusCell(page, "cloudwatch-alarms")).toContainText(
      "connected-but-empty"
    );
    await expect(statusCell(page, "cloudwatch-alarms")).toContainText(
      "no alarms"
    );
    await expect(statusCell(page, "cloudwatch-alarms")).not.toContainText(
      "unknown"
    );
    await expect(statusCell(page, "x-ray")).toContainText(
      "connected-but-empty"
    );
  } finally {
    await ui.close();
  }
});

test("credentials with a real alarm show connected", async ({ page }) => {
  const ui = await launchConsole(await makeProjectDir(), [
    providerProbe("sentry", {
      state: "value",
      value: { status: "connected" },
    }),
    providerProbe("cloudwatch-alarms", {
      state: "value",
      value: { status: "connected" },
    }),
    providerProbe("x-ray", {
      state: "value",
      value: { status: "connected" },
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#monitor`);
    await expect(statusCell(page, "cloudwatch-alarms")).toContainText(
      "✓ connected"
    );
    await expect(statusCell(page, "cloudwatch-alarms")).not.toContainText(
      "connected-but-empty"
    );
    await expect(statusCell(page, "sentry")).toContainText("✓ connected");
  } finally {
    await ui.close();
  }
});

test("unreachable Sentry shows unknown with the reason", async ({ page }) => {
  const ui = await launchConsole(await makeProjectDir(), [
    providerProbe("sentry", {
      state: "unknown",
      reason: "not-authenticated",
      message:
        "Sentry auth/MCP is not reachable — authenticate Sentry MCP/CLI or set SENTRY_AUTH_TOKEN",
    }),
    providerProbe("cloudwatch-alarms", {
      state: "value",
      value: { status: "connected" },
    }),
    providerProbe("x-ray", {
      state: "value",
      value: { status: "connected" },
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#monitor`);
    await expect(statusCell(page, "sentry")).toContainText("unknown");
    await expect(statusCell(page, "sentry")).toContainText("not-authenticated");
    await expect(statusCell(page, "sentry")).toContainText("Sentry");
    await expect(statusCell(page, "sentry")).not.toContainText("✓ connected");
    await expect(statusCell(page, "sentry")).not.toContainText("disconnected");
    await expect(statusCell(page, "sentry")).not.toContainText("✗ off");
  } finally {
    await ui.close();
  }
});
