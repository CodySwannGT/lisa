import { expect, test } from "@playwright/test";

test("renders mutating console controls as honest read-only affordances", async ({
  page,
}) => {
  await page.goto("/");

  const save = page.locator("#saveBtn");
  await expect(save).toBeDisabled();
  await expect(save).toHaveAttribute(
    "title",
    "read-only: the write-path has not shipped yet"
  );
  await page.evaluate(() => document.getElementById("saveBtn")?.click());
  await expect(page.locator("#toast")).not.toHaveClass(/show/);
  await expect(page.locator("#toast")).not.toContainText(/^Saved/);

  await page.goto("/#starters");
  const syncNow = page.getByRole("button", { name: "Sync now" });
  await expect(syncNow).toBeDisabled();
  await expect(syncNow).toHaveAttribute(
    "title",
    "read-only: starter sync has not shipped yet"
  );
  await expect(
    page.locator("#section-starters .readonly-reason", {
      hasText: "read-only: starter sync has not shipped yet",
    })
  ).toBeVisible();

  await page.goto("/#setup");
  const firstChecklistButton = page.locator("#section-setup .ck").first();
  const firstChecklistRow = page.locator("#section-setup .check-item").first();
  const beforeClass = await firstChecklistRow.getAttribute("class");
  await expect(firstChecklistButton).toBeDisabled();
  await expect(firstChecklistButton).toHaveAttribute(
    "title",
    "read-only: setup checklist state has not shipped yet"
  );
  await expect(
    firstChecklistRow.locator(".status-why", {
      hasText: "read-only: setup checklist state has not shipped yet",
    })
  ).toBeVisible();
  await firstChecklistButton.click({ force: true });
  await expect(firstChecklistRow).toHaveClass(beforeClass ?? "");

  await page.goto("/#general");
  const textControl = page.locator("#section-general input.ctl").first();
  const editableRow = textControl.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' row ')][1]"
  );
  await textControl.fill("changed by readonly-affordance test");
  await textControl.blur();
  await expect(page.locator("#savebar")).toHaveClass(/show/);
  await expect(editableRow).toHaveClass(/modified/);
  await expect(page.getByText("1 unsaved change")).toBeVisible();
  await expect(save).toBeDisabled();
});
