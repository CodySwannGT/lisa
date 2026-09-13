import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { runUi } from "../../src/cli/ui-cmd.js";
import { closeRunUiTestResources } from "./fixtures/run-ui-test-resources.js";

const CONFIG_FILE = ".lisa.config.json";
const STATEMENTS = "quality.testCoverage.global.statements";
const BRANCHES = "quality.testCoverage.global.branches";
const FUNCTIONS = "quality.testCoverage.global.functions";

/** Launch the real write endpoint against isolated files owned by this test. */
async function launchConsole(
  page: Page,
  done: string | { production: string } = { production: "Done" }
) {
  const dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-save-"));
  const config = {
    harness: "codex",
    deploy: { order: ["dev", "staging"] },
    quality: {
      testCoverage: {
        global: { statements: 70, branches: 70, functions: 70, lines: 70 },
      },
      mutation: { gate: { enabled: true } },
    },
    atlassian: { email: "before@example.com" },
    github: { labels: { build: { done } } },
    custom: { preserved: true },
  };
  await writeFile(path.join(dir, CONFIG_FILE), JSON.stringify(config));
  await writeFile(
    path.join(dir, "vitest.thresholds.json"),
    JSON.stringify(config.quality.testCoverage)
  );
  const server = await runUi(dir, { port: "0", sync: false }, { probes: [] });
  await page.goto(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/#testing`
  );
  return {
    dir,
    readConfig: async () =>
      JSON.parse(await readFile(path.join(dir, CONFIG_FILE), "utf8")),
    close: async () => {
      await closeRunUiTestResources({ page, server });
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Find the existing config row by its visible key chip. */
function row(page: Page, key: string) {
  return page.locator(".section.visible .row").filter({
    has: page.locator(".keychip", {
      hasText: new RegExp(`^${key.replaceAll(".", "\\.")}$`, "u"),
    }),
  });
}

/** Change the existing numeric widget through browser input events. */
async function changeNumber(page: Page, key: string, value: string) {
  const input = row(page, key).locator("input");
  await input.fill(value);
  await input.blur();
}

test("Save writes only three changed keys, rehydrates, and Discard uses the latest saved values", async ({
  page,
}) => {
  const fixture = await launchConsole(page);
  try {
    await changeNumber(page, STATEMENTS, "75");
    await changeNumber(page, STATEMENTS, "80");
    await changeNumber(page, BRANCHES, "80");
    await changeNumber(page, FUNCTIONS, "80");
    await expect(page.locator("#dirtyCount")).toHaveText("3");
    await expect(row(page, STATEMENTS)).toHaveClass(/modified/u);
    const request = page.waitForRequest(
      request =>
        request.url().endsWith("/api/config") && request.method() === "POST"
    );
    await page.locator("#saveBtn").click();
    expect((await request).postDataJSON()).toEqual({
      changes: { [STATEMENTS]: 80, [BRANCHES]: 80, [FUNCTIONS]: 80 },
    });
    await expect(page.locator("#savebar")).not.toHaveClass(/show/u);
    await page.route("**/api/config", route => route.abort());
    await changeNumber(page, STATEMENTS, "85");
    await page.locator("#saveBtn").click();
    await expect(page.locator("#saveError")).toBeVisible();
    await expect(page.locator("#savebar")).toHaveClass(/show/u);
    await expect(page.locator("#toast")).not.toHaveClass(/show/u);
    await page.unroute("**/api/config");
    await page.locator("#discardBtn").click();
    await expect(page.locator(".row.modified")).toHaveCount(0);
    const saved = await fixture.readConfig();
    expect(saved.quality.testCoverage.global).toEqual({
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 70,
    });
    expect(saved.custom).toEqual({ preserved: true });
    expect(
      JSON.parse(
        await readFile(path.join(fixture.dir, "vitest.thresholds.json"), "utf8")
      )
    ).toEqual(saved.quality.testCoverage);
    await expect(row(page, STATEMENTS).locator("input")).toHaveValue("80");
    await changeNumber(page, STATEMENTS, "90");
    await page.locator("#discardBtn").click();
    await expect(row(page, STATEMENTS).locator("input")).toHaveValue("80");
    await expect(page.locator("#savebar")).not.toHaveClass(/show/u);
    await changeNumber(page, STATEMENTS, "90");
    await changeNumber(page, STATEMENTS, "80");
    await expect(page.locator("#savebar")).not.toHaveClass(/show/u);
  } finally {
    await fixture.close();
  }
});

test("text, select, toggle and environment changes preserve their types and local routing", async ({
  page,
}) => {
  const fixture = await launchConsole(page);
  try {
    await row(page, "quality.mutation.gate.enabled")
      .locator("label.switch")
      .click();
    await page.locator('.nav-item[data-section="general"]').click();
    await row(page, "harness").locator("select").selectOption("claude");
    await page.locator('.nav-item[data-section="tracker"]').click();
    const email = row(page, "atlassian.email").locator("input");
    await email.fill("after@example.com");
    await email.blur();
    await page
      .getByRole("button", { name: "GitHub Issues", exact: true })
      .click();
    const production = row(page, "github.labels.build.done").locator(
      '[data-sync-key="github.labels.build.done.production"]'
    );
    await production.fill("Shipped");
    await production.blur();
    const request = page.waitForRequest(
      request =>
        request.url().endsWith("/api/config") && request.method() === "POST"
    );
    await page.locator("#saveBtn").click();
    expect((await request).postDataJSON()).toEqual({
      changes: {
        "quality.mutation.gate.enabled": false,
        harness: "claude",
        "atlassian.email": "after@example.com",
        "github.labels.build.done.production": "Shipped",
      },
    });
    await expect(page.locator("#savebar")).not.toHaveClass(/show/u);
    const saved = await fixture.readConfig();
    expect(saved.harness).toBe("claude");
    expect(saved.quality.mutation.gate.enabled).toBe(false);
    expect(saved.github.labels.build.done).toEqual({
      dev: "status:on-dev",
      staging: "status:on-stg",
      production: "Shipped",
    });
    await expect(
      row(page, "github.labels.build.done").locator(
        '[data-sync-key="github.labels.build.done.dev"]'
      )
    ).toHaveValue(saved.github.labels.build.done.dev);
    expect(saved.atlassian.email).toBeUndefined();
    const local = JSON.parse(
      await readFile(path.join(fixture.dir, ".lisa.config.local.json"), "utf8")
    );
    expect(local.atlassian.email).toBe("after@example.com");
    await expect(row(page, "atlassian.email").locator("input")).toHaveValue(
      "after@example.com"
    );
  } finally {
    await fixture.close();
  }
});

test("Save prevents overlapping edits and refuses an unconfirmed response", async ({
  page,
}) => {
  const fixture = await launchConsole(page);
  let release = () => {};
  const pending = new Promise<void>(resolve => {
    release = resolve;
  });
  try {
    await page.route("**/api/config", async route => {
      await pending;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });
    await changeNumber(page, STATEMENTS, "80");
    await page.locator("#saveBtn").click();
    await expect(page.locator("#saveBtn")).toBeDisabled();
    await expect(page.locator("#discardBtn")).toBeDisabled();
    await expect(page.locator("#main")).toHaveJSProperty("inert", true);
    release();
    await expect(page.locator("#saveError")).toContainText("did not confirm");
    await expect(page.locator("#savebar")).toHaveClass(/show/u);
    await expect(row(page, STATEMENTS).locator("input")).toHaveValue("80");
    expect(
      (await fixture.readConfig()).quality.testCoverage.global.statements
    ).toBe(70);
    await page.unroute("**/api/config");
    await changeNumber(page, STATEMENTS, "");
    await page.locator("#saveBtn").click();
    await expect(page.locator("#saveError")).toHaveText(
      "Enter a valid number before saving."
    );
    expect(
      (await fixture.readConfig()).quality.testCoverage.global.statements
    ).toBe(70);
  } finally {
    release();
    await fixture.close();
  }
});

test("editing a legacy environment string preserves its production value", async ({
  page,
}) => {
  const fixture = await launchConsole(page, "Legacy done");
  try {
    await page.locator('.nav-item[data-section="tracker"]').click();
    await page
      .getByRole("button", { name: "GitHub Issues", exact: true })
      .click();
    const production = row(page, "github.labels.build.done").locator(
      '[data-sync-key="github.labels.build.done.production"]'
    );
    await production.fill("Changed");
    await production.fill("Legacy done");
    await expect(page.locator("#savebar")).not.toHaveClass(/show/u);
    await row(page, "github.labels.build.done")
      .locator('[data-sync-key="github.labels.build.done.dev"]')
      .fill("On dev");
    await page.locator("#saveBtn").click();
    await expect(page.locator("#savebar")).not.toHaveClass(/show/u);
    expect(
      (await fixture.readConfig()).github.labels.build.done.production
    ).toBe("Legacy done");
  } finally {
    await fixture.close();
  }
});

for (const draft of ["83", ""]) {
  test(`a late status render preserves the draft ${JSON.stringify(draft)} before blur`, async ({
    page,
  }) => {
    let release = () => {};
    const pending = new Promise<void>(resolve => {
      release = resolve;
    });
    await page.route("**/api/status", async route => {
      await pending;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ probes: {} }),
      });
    });
    const fixture = await launchConsole(page);
    try {
      const input = row(page, STATEMENTS).locator("input");
      const original = await input.elementHandle();
      await input.fill(draft);
      release();
      await expect
        .poll(() => original?.evaluate(node => node.isConnected))
        .toBe(false);
      await expect(row(page, STATEMENTS).locator("input")).toHaveValue(draft);
      await expect(page.locator("#dirtyCount")).toHaveText("1");
      await expect(row(page, STATEMENTS)).toHaveClass(/modified/u);
    } finally {
      release();
      await fixture.close();
    }
  });
}

test("removing one duplicate tag preserves the remaining visible values", async ({
  page,
}) => {
  const fixture = await launchConsole(page);
  try {
    await page.locator('.nav-item[data-section="deploy"]').click();
    const tags = row(page, "deploy.order");
    page.once("dialog", dialog => dialog.accept("dev"));
    await tags.locator(".tag-add").click();
    await expect(tags.locator(".tag")).toHaveCount(3);
    await tags.locator(".tag button").last().click();
    await expect(tags.locator(".tag")).toHaveCount(2);
    await expect(page.locator("#savebar")).not.toHaveClass(/show/u);
    await tags.locator(".tag button").first().click();
    const request = page.waitForRequest(
      request =>
        request.url().endsWith("/api/config") && request.method() === "POST"
    );
    await page.locator("#saveBtn").click();
    expect((await request).postDataJSON()).toEqual({
      changes: { "deploy.order": ["staging"] },
    });
    // This existing display key is outside the writer's allowlist. Refusal must
    // retain the exact pending array and leave the real configuration intact.
    await expect(page.locator("#saveError")).toContainText(
      'Config key "deploy.order" is not writable'
    );
    expect((await fixture.readConfig()).deploy.order).toEqual([
      "dev",
      "staging",
    ]);
    await expect(tags.locator(".tag")).toHaveText(["staging ×"]);
    await page.locator("#discardBtn").click();
    await expect(row(page, "deploy.order").locator(".tag")).toHaveCount(2);
  } finally {
    await fixture.close();
  }
});

test("a real read-only file refusal preserves pending edits and never reports success", async ({
  page,
}) => {
  const fixture = await launchConsole(page);
  try {
    const before = await readFile(path.join(fixture.dir, CONFIG_FILE), "utf8");
    await chmod(path.join(fixture.dir, CONFIG_FILE), 0o444);
    await changeNumber(page, STATEMENTS, "80");
    await page.locator("#saveBtn").click();
    await expect(page.locator("#saveError")).toContainText(
      "Unable to write Lisa config"
    );
    await expect(page.locator("#savebar")).toHaveClass(/show/u);
    await expect(row(page, STATEMENTS)).toHaveClass(/modified/u);
    await expect(row(page, STATEMENTS).locator("input")).toHaveValue("80");
    await expect(page.locator("#toast")).not.toContainText("Saved");
    expect(await readFile(path.join(fixture.dir, CONFIG_FILE), "utf8")).toBe(
      before
    );
    await page.locator("#discardBtn").click();
    await expect(row(page, STATEMENTS).locator("input")).toHaveValue("70");
  } finally {
    await chmod(path.join(fixture.dir, CONFIG_FILE), 0o644);
    await fixture.close();
  }
});
