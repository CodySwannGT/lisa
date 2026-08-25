import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "@playwright/test";

const UI_FILE = path.resolve("ui/index.html");

test("renders conversational readiness questions with formal control detail", async ({
  page,
}) => {
  await page.goto(`${pathToFileURL(UI_FILE).href}#readiness`);

  const rows = page.locator("#section-readiness .intake-item");
  await expect(rows).toHaveCount(122);
  await expect(
    page.getByText(
      "What durable scheduler keeps agents moving when nobody prompts them?"
    )
  ).toBeVisible();

  const schedulerRow = rows.filter({
    hasText:
      "What durable scheduler keeps agents moving when nobody prompts them?",
  });
  const detail = schedulerRow.locator(".intake-control-detail");
  await expect(detail).not.toHaveAttribute("open", "");
  await detail.getByText("Control detail", { exact: true }).click();
  await expect(detail).toHaveAttribute("open", "");
  await expect(detail).toContainText("Criteria: AC7.1");
  await expect(detail).toContainText("Requirement: Factories MUST run");
  await expect(detail).toContainText("Evidence: Scheduler registration");

  const count = page.locator("#section-readiness .intake-count");
  await expect(count).toHaveText(/of 122 answered/u);
});
