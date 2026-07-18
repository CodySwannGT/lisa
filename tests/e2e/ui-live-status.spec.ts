import { expect, test } from "@playwright/test";

test("renders authenticated, unknown, failure, timeout, and not-applicable statuses", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/status");

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  await expect(response.json()).resolves.toEqual({
    probes: {
      "github-authenticated": { state: "value", value: true },
      "github-unauthenticated": {
        state: "unknown",
        reason: "not-authenticated",
        message: "GitHub CLI is not authenticated",
      },
      "throwing-probe": {
        state: "unknown",
        reason: "probe-failed",
        message: "Deterministic fixture failure",
      },
      "timing-out-probe": {
        state: "unknown",
        reason: "timeout",
        message: "Probe timed out after 25ms",
      },
      "not-applicable-probe": { state: "not-applicable" },
    },
  });

  await page.goto("/#pipelines");
  await expect(
    page.locator("#section-pipelines h1", { hasText: "Pipelines" })
  ).toBeVisible();

  const statusItem = (id: string) =>
    page.locator("#liveStatusList .live-status-item", { hasText: id });

  await expect(statusItem("github-authenticated")).toContainText("true");
  await expect(statusItem("github-unauthenticated")).toContainText(
    "unknownnot-authenticated: GitHub CLI is not authenticated"
  );
  await expect(statusItem("throwing-probe")).toContainText(
    "unknownprobe-failed: Deterministic fixture failure"
  );
  await expect(statusItem("timing-out-probe")).toContainText(
    "unknowntimeout: Probe timed out after 25ms"
  );
  await expect(statusItem("not-applicable-probe")).toContainText(
    "not applicable"
  );

  await expect(
    page.locator("#liveStatusList .live-status-item .badge.pass")
  ).toHaveCount(1);
});
