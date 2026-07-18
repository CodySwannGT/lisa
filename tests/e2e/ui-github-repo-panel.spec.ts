import { expect, test, type Page } from "@playwright/test";

/** Fixture panel value returned by a successful github-repo probe. */
const LIVE_PANEL_VALUE = {
  owner: "acme",
  repo: "acme-app",
  settings: {
    allow_merge_commit: true,
    allow_squash_merge: false,
    allow_rebase_merge: false,
    allow_auto_merge: true,
    allow_update_branch: true,
    delete_branch_on_merge: true,
    merge_commit_title: "MERGE_MESSAGE",
    has_issues: true,
    has_wiki: false,
    secret_scanning: true,
    default_branch: "main",
  },
  rulesets: [
    {
      name: "base",
      appliesTo: "dev · staging · main",
      enforces: "deletion, non_fast_forward, pull_request",
      active: true,
    },
    {
      name: "quality checks",
      appliesTo: "dev · staging · main",
      enforces: "required_status_checks",
      active: true,
    },
  ],
  labels: [
    {
      name: "status:ready",
      role: "build · ready",
      color: "fbca04",
      present: true,
    },
    {
      name: "status:blocked",
      role: "build · blocked",
      color: "",
      present: false,
    },
  ],
  secrets: [
    {
      name: "DEPLOY_KEY",
      purpose:
        "Write deploy key so CI can push version bumps through ruleset bypass",
      set: true,
    },
    {
      name: "SNYK_TOKEN",
      purpose: "Snyk dependency scan",
      set: false,
    },
  ],
};

/**
 * Stub /api/status before navigation so boot hydration sees the fixture.
 * @param page - Playwright page
 * @param githubRepo - Probe result for github-repo
 */
async function stubStatus(
  page: Page,
  githubRepo: Record<string, unknown>
): Promise<void> {
  await page.route("**/api/status", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({
        probes: {
          "github-auth": { state: "value", value: true },
          "lisa-version": {
            state: "value",
            value: { current: "2.234.0", latest: "2.234.0", outdated: false },
          },
          "github-repo": githubRepo,
        },
      }),
    });
  });
}

test("lists live rulesets and marks a missing expected label", async ({
  page,
}) => {
  await stubStatus(page, { state: "value", value: LIVE_PANEL_VALUE });
  await page.goto("/#repository");

  const section = page.locator("#section-repository");
  await expect(section.locator("h1")).toContainText("Repository & protection");
  await expect(section.getByText("base", { exact: true })).toBeVisible();
  await expect(
    section.getByText("quality checks", { exact: true })
  ).toBeVisible();
  await expect(
    section.getByText("status:blocked", { exact: true })
  ).toBeVisible();
  await expect(
    section.locator("tr", { hasText: "status:blocked" }).getByText("missing")
  ).toBeVisible();
  await expect(section.getByText("DEPLOY_KEY", { exact: true })).toBeVisible();
  await expect(
    section
      .locator("tr", { hasText: "DEPLOY_KEY" })
      .locator(".badge.on", { hasText: "set" })
  ).toBeVisible();
  await expect(
    section
      .locator("tr", { hasText: "SNYK_TOKEN" })
      .locator(".badge.off", { hasText: "missing" })
  ).toBeVisible();
  const html = await page.content();
  expect(html).not.toMatch(/ghp_|github_pat_|BEGIN (?:RSA |OPENSSH )?PRIVATE/);
});

test("unauthenticated gh takes the whole panel to unknown", async ({
  page,
}) => {
  await stubStatus(page, {
    state: "unknown",
    reason: "not-authenticated",
    message: "GitHub CLI is not authenticated",
  });
  await page.goto("/#repository");

  const section = page.locator("#section-repository");
  await expect(section).toContainText("unknown");
  await expect(section).toContainText("not-authenticated");
  await expect(section).toContainText("GitHub CLI is not authenticated");
  await expect(section.getByText("base", { exact: true })).toHaveCount(0);
  await expect(section.getByText("DEPLOY_KEY", { exact: true })).toHaveCount(0);
  await expect(section.getByText("status:ready", { exact: true })).toHaveCount(
    0
  );
  await expect(section.getByText("Allow merge commits")).toHaveCount(0);
});
