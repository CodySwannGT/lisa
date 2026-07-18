/**
 * Playwright regression for the CI Quality jobs Active column.
 *
 * Maestro: this web console surface has no Maestro harness in the repo
 * (coverage is Playwright-only, same as other `lisa ui` e2e specs).
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  CI_QUALITY_JOBS_PROBE_ID,
  runUi,
  type CiQualityJobsValue,
  type ProbeResult,
  type StatusProbe,
} from "../../src/cli/ui-cmd.ts";

/**
 * A running console rooted at an isolated origin, plus its teardown.
 */
interface LiveConsole {
  readonly base: string;
  readonly close: () => Promise<void>;
}

/** Temp project dirs created this test, removed in afterEach. */
const createdDirs: string[] = [];

/**
 * Create a fresh temporary project directory, tracked for teardown.
 * @returns Absolute path to the new directory
 */
async function makeProjectDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-ci-quality-"));
  createdDirs.push(dir);
  return dir;
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
 * Build the ci-quality-jobs probe returning a fixed result.
 * @param result - Tri-state result the probe reports
 * @returns Probe registered under the ci-quality-jobs id
 */
function ciQualityProbe(
  result: ProbeResult<CiQualityJobsValue>
): StatusProbe<CiQualityJobsValue> {
  return {
    id: CI_QUALITY_JOBS_PROBE_ID,
    timeoutMs: 1_000,
    run: async () => result,
  };
}

/**
 * Seed a minimal project config used only for HTML injection.
 * @param destDir - Project root
 */
async function seedProject(destDir: string): Promise<void> {
  await writeFile(
    path.join(destDir, ".lisa.config.json"),
    JSON.stringify({
      github: { org: "acme", repo: "acme-app" },
      quality: { mutation: { gate: { enabled: false } } },
    }),
    "utf8"
  );
  await mkdir(path.join(destDir, ".github", "workflows"), { recursive: true });
  await writeFile(
    path.join(destDir, ".github", "workflows", "ci.yml"),
    [
      "name: CI",
      "on: pull_request",
      "jobs:",
      "  quality:",
      "    uses: ./.github/workflows/quality.yml",
      "    with:",
      "      skip_jobs: ''",
      "",
    ].join("\n"),
    "utf8"
  );
}

/**
 * Locate the Active-column cell for a Quality job by jobId.
 * @param page - Playwright page
 * @param jobId - Stable job identifier
 * @returns Locator for the Active td
 */
function activeCell(
  page: import("@playwright/test").Page,
  jobId: string
): import("@playwright/test").Locator {
  return page.locator(`#section-ci td[data-job-id="${jobId}"]`);
}

test.afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

test("Snyk and Mutation Testing Gate show real off reasons", async ({
  page,
}) => {
  const destDir = await makeProjectDir();
  await seedProject(destDir);
  const ui = await launchConsole(destDir, [
    ciQualityProbe({
      state: "value",
      value: {
        jobs: [
          {
            id: "snyk",
            label: "🛡️ Snyk",
            active: false,
            reason: "SNYK_TOKEN secret is not set",
          },
          {
            id: "test:mutation",
            label: "🧬 Mutation Testing Gate",
            active: false,
            reason: "mutation gate is disabled",
          },
          {
            id: "lint",
            label: "🧹 Lint",
            active: true,
            reason: "",
          },
        ],
      },
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#ci`);
    await expect(page.locator("#section-ci h1")).toContainText("Quality gates");
    await expect(activeCell(page, "snyk")).toContainText("✗ off");
    await expect(activeCell(page, "snyk")).toContainText(
      "SNYK_TOKEN secret is not set"
    );
    await expect(activeCell(page, "test:mutation")).toContainText("✗ off");
    await expect(activeCell(page, "test:mutation")).toContainText(
      "mutation gate is disabled"
    );
  } finally {
    await ui.close();
  }
});

test("unauthenticated secret state never renders a false off", async ({
  page,
}) => {
  const destDir = await makeProjectDir();
  await seedProject(destDir);
  const ui = await launchConsole(destDir, [
    ciQualityProbe({
      state: "value",
      value: {
        jobs: [
          {
            id: "snyk",
            label: "🛡️ Snyk",
            active: null,
            reason: "not authenticated",
          },
          {
            id: "test:mutation",
            label: "🧬 Mutation Testing Gate",
            active: false,
            reason: "mutation gate is disabled",
          },
        ],
      },
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#ci`);
    const snyk = activeCell(page, "snyk");
    await expect(snyk).toContainText("unknown");
    await expect(snyk).toContainText("not authenticated");
    await expect(snyk).not.toContainText("✗ off");
    await expect(snyk).not.toContainText("secret is not set");
    await expect(activeCell(page, "test:mutation")).toContainText("✗ off");
  } finally {
    await ui.close();
  }
});

test("skip_jobs from ci.yml is reported off with that reason", async ({
  page,
}) => {
  const destDir = await makeProjectDir();
  await seedProject(destDir);
  const ui = await launchConsole(destDir, [
    ciQualityProbe({
      state: "value",
      value: {
        jobs: [
          {
            id: "lint",
            label: "🧹 Lint",
            active: false,
            reason: "ci.yml skip_jobs includes lint",
          },
        ],
      },
    }),
  ]);
  try {
    await page.goto(`${ui.base}/#ci`);
    await expect(activeCell(page, "lint")).toContainText("✗ off");
    await expect(activeCell(page, "lint")).toContainText(
      "ci.yml skip_jobs includes lint"
    );
  } finally {
    await ui.close();
  }
});

test("served CI section never renders secret values", async ({
  page,
  request,
}) => {
  const destDir = await makeProjectDir();
  await seedProject(destDir);
  const planted = "planted-secret-value-should-never-appear";
  const ui = await launchConsole(destDir, [
    ciQualityProbe({
      state: "value",
      value: {
        jobs: [
          {
            id: "snyk",
            label: "🛡️ Snyk",
            active: false,
            reason: "SNYK_TOKEN secret is not set",
          },
        ],
      },
    }),
  ]);
  try {
    const htmlResponse = await request.get(`${ui.base}/`);
    expect(htmlResponse.ok()).toBe(true);
    const html = await htmlResponse.text();
    expect(html).not.toContain(planted);
    expect(html).not.toMatch(/gho_[A-Za-z0-9]+/u);
    expect(html).not.toMatch(/ghp_[A-Za-z0-9]+/u);

    await page.goto(`${ui.base}/#ci`);
    await expect(activeCell(page, "snyk")).toContainText(
      "SNYK_TOKEN secret is not set"
    );
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain(planted);
    // Presence-only: the secret *name* may appear; never a value payload.
    expect(bodyText).not.toMatch(/SNYK_TOKEN\s*=\s*\S+/u);
  } finally {
    await ui.close();
  }
});

test("initial Quality jobs Active column does not flash false-green active", async ({
  page,
  request,
}) => {
  const destDir = await makeProjectDir();
  await seedProject(destDir);
  const ui = await launchConsole(destDir, [
    ciQualityProbe({
      state: "unknown",
      reason: "not-authenticated",
      message: "GitHub CLI is not authenticated",
    }),
  ]);
  try {
    const htmlResponse = await request.get(`${ui.base}/`);
    const html = await htmlResponse.text();
    // Demo data must not ship ✓ active for quality jobs before the probe.
    expect(html).toContain('jobId: "snyk"');
    expect(html).toContain("checking…");
    const qualityBlock = html.slice(
      html.indexOf('card: "Quality jobs"'),
      html.indexOf("Rails calls quality-rails.yml")
    );
    expect(qualityBlock).not.toMatch(/t:\s*"status",\s*v:\s*true/u);

    await page.goto(`${ui.base}/#ci`);
    await expect(activeCell(page, "snyk")).toContainText("unknown");
    await expect(activeCell(page, "snyk")).not.toContainText("✓ active");
  } finally {
    await ui.close();
  }
});
