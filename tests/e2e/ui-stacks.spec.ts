import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  runUi,
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
 * @param destDir - Project root the console serves and detects against
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
 * Build the `detected-stacks` probe returning a fixed result, so each journey
 * pins an exact snapshot the Stacks section must render honestly.
 * @param result - The tri-state result the probe reports
 * @returns A probe registered under the `detected-stacks` id
 */
function detectedStacksProbe(
  result: ProbeResult<string[]>
): StatusProbe<string[]> {
  return { id: "detected-stacks", timeoutMs: 1_000, run: async () => result };
}

/** Temp project dirs created this test, removed in afterEach. */
const createdDirs: string[] = [];

/**
 * Create a fresh temporary project directory, tracked for teardown.
 * @returns Absolute path to the new directory
 */
async function makeProjectDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-stacks-"));
  createdDirs.push(dir);
  return dir;
}

test.afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

const stackCards = "#section-stacks .stack-card";
const stackCardNames = "#section-stacks .stack-card .t b";

test("renders detected types as cards in probe order and nothing else", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    detectedStacksProbe({ state: "value", value: ["typescript", "expo"] }),
  ]);
  try {
    await page.goto(`${ui.base}/#stacks`);
    await expect(page.locator(stackCardNames)).toHaveText([
      "TypeScript",
      "Expo",
    ]);
    await expect(page.locator(stackCards)).toHaveCount(2);
    await expect(page.locator("#section-stacks .stacks-state")).toHaveCount(0);
  } finally {
    await ui.close();
  }
});

test("renders the explicit empty state for value:[] with zero stack cards", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    detectedStacksProbe({ state: "value", value: [] }),
  ]);
  try {
    await page.goto(`${ui.base}/#stacks`);
    await expect(
      page.locator("#section-stacks .stacks-state.empty")
    ).toHaveText("No Lisa stack detected in this project.");
    await expect(page.locator(stackCards)).toHaveCount(0);
  } finally {
    await ui.close();
  }
});

test("renders the explicit unknown state for an unknown probe result", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    detectedStacksProbe({
      state: "unknown",
      reason: "probe-failed",
      message: "Detector registry threw",
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#stacks`);
    const unknown = page.locator("#section-stacks .stacks-state.unknown");
    await expect(unknown).toBeVisible();
    await expect(unknown).toContainText("Stack detection unavailable");
    await expect(unknown.locator(".status-why")).toHaveText(
      "probe-failed: Detector registry threw"
    );
    await expect(
      page.locator("#section-stacks .stacks-state.empty")
    ).toHaveCount(0);
    await expect(page.locator(stackCards)).toHaveCount(0);
  } finally {
    await ui.close();
  }
});

test("renders the unknown state when the snapshot omits the detected-stacks probe", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    {
      id: "github-authenticated",
      timeoutMs: 1_000,
      run: async () => ({ state: "value", value: true }),
    },
  ]);
  try {
    await page.goto(`${ui.base}/#stacks`);
    const unknown = page.locator("#section-stacks .stacks-state.unknown");
    await expect(unknown).toBeVisible();
    await expect(unknown.locator(".status-why")).toHaveText(
      "missing-probe: The detected-stacks probe was not reported"
    );
    await expect(
      page.locator("#section-stacks .stacks-state.empty")
    ).toHaveCount(0);
    await expect(page.locator(stackCards)).toHaveCount(0);
  } finally {
    await ui.close();
  }
});

test("renders the unknown state for an array carrying a non-string element", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    // A non-string element makes the array untrustworthy; the section must not
    // collapse it to a fabricated "no stacks" empty state.
    detectedStacksProbe({
      state: "value",
      value: [1, 2] as unknown as string[],
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#stacks`);
    const unknown = page.locator("#section-stacks .stacks-state.unknown");
    await expect(unknown).toBeVisible();
    await expect(unknown.locator(".status-why")).toHaveText(
      "invalid-value: detected-stacks did not return a string array"
    );
    await expect(
      page.locator("#section-stacks .stacks-state.empty")
    ).toHaveCount(0);
    await expect(page.locator(stackCards)).toHaveCount(0);
  } finally {
    await ui.close();
  }
});

test("renders a minimal card for a detected id absent from the catalog", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    detectedStacksProbe({
      state: "value",
      value: ["typescript", "not-a-real-stack"],
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#stacks`);
    await expect(page.locator(stackCardNames)).toHaveText([
      "TypeScript",
      "not-a-real-stack",
    ]);
    await expect(page.locator(stackCards)).toHaveCount(2);
  } finally {
    await ui.close();
  }
});

test("renders a hostile detected id as inert text without executing it", async ({
  page,
}) => {
  const hostileId = "<img src=x onerror=window.__xss=1>";
  const ui = await launchConsole(await makeProjectDir(), [
    detectedStacksProbe({ state: "value", value: ["typescript", hostileId] }),
  ]);
  try {
    await page.goto(`${ui.base}/#stacks`);
    await expect(page.locator(stackCards)).toHaveCount(2);
    const minimalCard = page.locator(stackCards).nth(1);
    // The id survives as a visible literal, not as parsed markup.
    await expect(minimalCard.locator(".t b")).toHaveText(hostileId);
    await expect(minimalCard.locator("img")).toHaveCount(0);
    const xss = await page.evaluate(() => (window as { __xss?: number }).__xss);
    expect(xss).toBeUndefined();
  } finally {
    await ui.close();
  }
});

test("renders a minimal card for a detected id that shadows an inherited object property", async ({
  page,
}) => {
  // "constructor" is not an own property of the plain-object catalog but IS
  // resolvable via the prototype chain. A lookup that isn't own-key-safe
  // would resolve Object.prototype.constructor instead of falling back to
  // minimalStackMeta, producing a malformed card.
  const hostileId = "constructor";
  const ui = await launchConsole(await makeProjectDir(), [
    detectedStacksProbe({ state: "value", value: ["typescript", hostileId] }),
  ]);
  try {
    await page.goto(`${ui.base}/#stacks`);
    await expect(page.locator(stackCardNames)).toHaveText([
      "TypeScript",
      hostileId,
    ]);
    await expect(page.locator(stackCards)).toHaveCount(2);
  } finally {
    await ui.close();
  }
});

test("hydrates from the real default probe against a project with tsconfig.json", async ({
  page,
}) => {
  const projectDir = await makeProjectDir();
  await writeFile(path.join(projectDir, "tsconfig.json"), "{}\n");
  const ui = await launchConsole(projectDir);
  try {
    await page.goto(`${ui.base}/#stacks`);
    await expect(page.locator(stackCardNames)).toHaveText(["TypeScript"]);
    await expect(page.locator(stackCards)).toHaveCount(1);
  } finally {
    await ui.close();
  }
});

test("preserves stack-toggle dirty tracking on a rendered card", async ({
  page,
}) => {
  const ui = await launchConsole(await makeProjectDir(), [
    detectedStacksProbe({ state: "value", value: ["typescript"] }),
  ]);
  try {
    await page.goto(`${ui.base}/#stacks`);
    const card = page.locator(stackCards);
    await expect(card).toHaveCount(1);
    await expect(page.locator("#savebar")).not.toHaveClass(/show/);
    await card.getByRole("checkbox").dispatchEvent("click");
    await expect(page.locator("#savebar")).toHaveClass(/show/);
    await expect(page.locator("#savebar")).toContainText("unsaved change");
  } finally {
    await ui.close();
  }
});
