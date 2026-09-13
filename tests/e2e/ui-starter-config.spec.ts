import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { runUi } from "../../src/cli/ui-cmd.js";
import { runConfigSync } from "../../src/sync/config-sync.js";
import { closeRunUiTestResources } from "./fixtures/run-ui-test-resources.js";

const templates = [
  {
    repo: "example/mobile-template",
    ref: "main",
    lastSync: { sha: "aaa111", at: "2026-09-01" },
  },
  {
    repo: "example/service-template",
    ref: "v2",
    lastSync: { sha: "bbb222", at: "2026-09-02" },
    paths: ["service/**"],
  },
  {
    repo: "example/infra-template",
    ref: "release",
    lastSync: { sha: "ccc333", at: "2026-09-03" },
  },
];

test("renders all recorded starter entries from the served project configuration", async ({
  page,
}) => {
  const root = await mkdtemp(path.join(tmpdir(), "lisa-ui-starters-"));
  await writeFile(
    path.join(root, ".lisa.config.json"),
    JSON.stringify({ starter: { templates } })
  );
  await runConfigSync(root);
  const server = await runUi(root, { port: "0", sync: false }, { probes: [] });
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/#starters`
    );
    const section = page.locator("#section-starters");
    for (const entry of templates) {
      await expect(section).toContainText(entry.repo);
      await expect(section).toContainText(entry.ref);
      await expect(section).toContainText(entry.lastSync.sha);
      await expect(section).toContainText(entry.lastSync.at);
    }
    await expect(section).toContainText("service/**");
    await expect(section).not.toContainText("expostarter");
    await expect(section).not.toContainText("cdkstarter");
    await expect(section).not.toContainText("upstream commits since");
    await expect(
      section.getByRole("button", { name: "Sync now", exact: true })
    ).toBeDisabled();
    const provenanceControls = section
      .locator(".row")
      .filter({
        has: page.locator(".keychip", { hasText: /^starter\.templates\./u }),
      })
      .locator("input, select, button");
    await expect(provenanceControls).toHaveCount(0);
    await page.evaluate(() => {
      window.location.hash = "testing";
    });
    const statements = page
      .locator("#section-testing .row")
      .filter({
        has: page.getByText("quality.testCoverage.global.statements", {
          exact: true,
        }),
      })
      .locator('input[type="number"]');
    await statements.fill("75");
    await page.locator("#saveBtn").click();
    await expect
      .poll(
        async () =>
          JSON.parse(
            await readFile(path.join(root, ".lisa.config.json"), "utf8")
          ).quality.testCoverage.global.statements
      )
      .toBe(75);
    await expect(page.locator("#saveBtn")).toBeDisabled();
    await page.evaluate(() => {
      window.location.hash = "starters";
    });
    await expect(provenanceControls).toHaveCount(0);
    await page.evaluate(() => {
      window.location.hash = "testing";
    });
    await statements.fill("80");
    await page.locator("#discardBtn").click();
    await page.evaluate(() => {
      window.location.hash = "starters";
    });
    await expect(provenanceControls).toHaveCount(0);
    expect(
      JSON.parse(await readFile(path.join(root, ".lisa.config.json"), "utf8"))
        .starter.templates
    ).toEqual(templates);
  } finally {
    await closeRunUiTestResources({ page, server });
    await rm(root, { recursive: true, force: true });
  }
});

test("shows an empty starter state without inventing template origins", async ({
  page,
}) => {
  const root = await mkdtemp(path.join(tmpdir(), "lisa-ui-starters-empty-"));
  await writeFile(path.join(root, ".lisa.config.json"), "{}");
  const server = await runUi(root, { port: "0", sync: false }, { probes: [] });
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/#starters`
    );
    const section = page.locator("#section-starters");
    await expect(section).toContainText("No starter templates recorded");
    await expect(section).not.toContainText("Template 1");
    await expect(section).not.toContainText("expostarter");
    await expect(section).not.toContainText("cdkstarter");
  } finally {
    await closeRunUiTestResources({ page, server });
    await rm(root, { recursive: true, force: true });
  }
});
