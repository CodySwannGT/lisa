/**
 * Playwright regression for the top-bar `#healthChip` lisa-version probe.
 *
 * Maestro: this web console surface has no Maestro harness in the repo
 * (coverage is Playwright-only, same as other `lisa ui` e2e specs). Do not
 * invent Maestro flows for a surface that is not Maestro-covered.
 */
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  runUi,
  type LisaVersionValue,
  type ProbeResult,
  type StatusProbe,
} from "../../src/cli/ui-cmd.ts";

/**
 * A running console rooted at an isolated origin, plus its teardown. Each test
 * owns one and closes it in a `finally` so no server outlives its test and no
 * fixed port (never 4780) is bound.
 */
interface LiveConsole {
  readonly base: string;
  readonly close: () => Promise<void>;
}

/**
 * Launch `lisa ui` on an OS-assigned port (0) with sync disabled, so the spec
 * neither mutates the project nor collides with the shared webServer.
 * @param destDir - Project root the console serves
 * @param probes - Injected status probes; omitted to exercise the real defaults
 * @returns The console's loopback origin and a close handle
 */
async function launchConsole(
  destDir: string,
  probes?: readonly StatusProbe[]
): Promise<LiveConsole> {
  const server = await runUi(
    destDir,
    { port: "0", sync: false },
    probes ? { probes } : {}
  );
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

/**
 * Build the `lisa-version` probe returning a fixed result.
 * @param result - The tri-state result the probe reports
 * @returns A probe registered under the `lisa-version` id
 */
function lisaVersionProbe(
  result: ProbeResult<LisaVersionValue>
): StatusProbe<LisaVersionValue> {
  return { id: "lisa-version", timeoutMs: 1_000, run: async () => result };
}

/** Temp project dirs created this test, removed in afterEach. */
const createdDirs: string[] = [];

/**
 * Create a fresh temporary project directory, tracked for teardown.
 * @returns Absolute path to the new directory
 */
async function makeProjectDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-version-"));
  createdDirs.push(dir);
  return dir;
}

test.afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

const healthChip = "#healthChip";
const healthDot = "#healthChip .dot";

test("up-to-date lisa-version paints green up-to-date on #healthChip", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    lisaVersionProbe({
      state: "value",
      value: { current: "2.233.1", latest: "2.233.1", outdated: false },
    }),
  ]);
  try {
    await page.goto(`${ui.base}/`);
    await expect(page.locator(healthChip)).toContainText("2.233.1");
    await expect(page.locator(healthChip)).toContainText("up to date");
    await expect(page.locator(healthDot)).toHaveClass(/ok/);
    await expect(page.locator(healthDot)).not.toHaveClass(/warn/);
    await expect(page.locator(healthDot)).not.toHaveClass(/unknown/);
  } finally {
    await ui.close();
  }
});

test("behind lisa-version paints amber with both current and latest", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    lisaVersionProbe({
      state: "value",
      value: { current: "2.199.0", latest: "2.233.1", outdated: true },
    }),
  ]);
  try {
    await page.goto(`${ui.base}/`);
    await expect(page.locator(healthChip)).toContainText("2.199.0");
    await expect(page.locator(healthChip)).toContainText("2.233.1");
    await expect(page.locator(healthDot)).toHaveClass(/warn/);
    await expect(page.locator(healthDot)).not.toHaveClass(/ok/);
  } finally {
    await ui.close();
  }
});

test("unknown lisa-version never shows green and carries the reason", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    lisaVersionProbe({
      state: "unknown",
      reason: "network-error",
      message: "Latest version unavailable (network-error)",
    }),
  ]);
  try {
    await page.goto(`${ui.base}/`);
    await expect(page.locator(healthChip)).toContainText("unknown");
    await expect(page.locator(healthChip)).toContainText("network-error");
    await expect(page.locator(healthDot)).toHaveClass(/unknown/);
    await expect(page.locator(healthDot)).not.toHaveClass(/ok/);
  } finally {
    await ui.close();
  }
});

test("served HTML does not flash a false-green demo on #healthChip", async ({
  page,
  request,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    lisaVersionProbe({
      state: "unknown",
      reason: "network-error",
      message: "Latest version unavailable (network-error)",
    }),
  ]);
  try {
    const htmlResponse = await request.get(`${ui.base}/`);
    expect(htmlResponse.ok()).toBe(true);
    const html = await htmlResponse.text();
    expect(html).toContain('id="healthChip"');
    expect(html).toContain("checking…");
    expect(html).not.toMatch(/id="healthChip"[\s\S]*?<span class="dot ok"/u);

    await page.goto(`${ui.base}/`);
    await expect(page.locator(healthDot)).not.toHaveClass(/ok/);
  } finally {
    await ui.close();
  }
});
