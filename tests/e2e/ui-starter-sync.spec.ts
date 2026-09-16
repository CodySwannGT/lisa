/** Browser regression; live PR and native scheduler proof remain separate acceptance checks. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { runUi } from "../../src/cli/ui-cmd.js";
import type { StarterLandingResult } from "../../src/cli/starter-sync-command.js";
import { closeRunUiTestResources } from "./fixtures/run-ui-test-resources.js";

test("reports a PR, nothing to do, and a real failure without generic success", async ({
  page,
}) => {
  const root = await mkdtemp(path.join(tmpdir(), "lisa-ui-starter-sync-e2e-"));
  await writeFile(
    path.join(root, ".lisa.config.json"),
    JSON.stringify({
      starter: {
        templates: [],
        sync: { auto: false, strategy: "pull-request" },
      },
    })
  );
  const pr = "https://github.com/CodySwannGT/lisa/pull/42";
  const outcomes: (StarterLandingResult | Error)[] = [
    {
      state: "pull-request",
      results: [],
      url: pr,
      worktree: "/tmp/retained-starter-changes",
    },
    { state: "current", results: [] },
    new Error("Starter ref is not resolvable <script>alert(1)</script>"),
    { state: "committed", results: [], commit: "abc123" },
  ];
  let launchUrl = "";
  const server = await runUi(
    root,
    { port: "0", sync: false },
    {
      probes: [],
      onListening: value => {
        launchUrl = value;
      },
      starterSync: {
        run: async options => {
          expect(options?.path).toBe(root);
          const next = outcomes.shift();
          if (next instanceof Error) throw next;
          if (!next) throw new Error("Unexpected extra sync");
          return next;
        },
      },
    }
  );
  try {
    await page.goto(launchUrl);
    await expect(page).not.toHaveURL(/lisa-token/u);
    await page.evaluate(() => {
      location.hash = "starters";
    });
    const button = page.getByRole("button", { name: "Sync now", exact: true });
    const status = page.locator("#starterSyncStatus");
    await button.click();
    await expect(status).toContainText("pull request is open for review");
    await expect(status.getByRole("link")).toHaveAttribute("href", pr);
    await expect(status).toContainText("baseline has not advanced");
    await expect(status).toContainText("/tmp/retained-starter-changes");
    await button.click();
    await expect(status).toContainText("Nothing to do");
    await expect(status.getByRole("link")).toHaveCount(0);
    await button.click();
    await expect(status).toHaveAttribute("role", "alert");
    await expect(status).toContainText(
      "Starter ref is not resolvable <script>alert(1)</script>"
    );
    await expect(status.locator("script")).toHaveCount(0);
    await expect(page.locator("#toast")).not.toHaveClass(/show/);
    await button.click();
    await expect(status).toContainText("Starter changes committed: abc123");
    await expect(status).toHaveAttribute("role", "status");
    expect(outcomes).toHaveLength(0);
    await page.reload();
    await button.click();
    await expect(status).toContainText("terminal launch link");
    await expect(status).toHaveAttribute("role", "alert");
  } finally {
    await closeRunUiTestResources({ page, server });
    await rm(root, { recursive: true, force: true });
  }
});
