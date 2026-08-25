import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import { injectLiveConfig, runUi } from "../../src/cli/ui-cmd.ts";

const execFileAsync = promisify(execFile);
const UI_FILE = path.resolve("ui/index.html");
const CATALOG_END = "/* LISA_UI_CATALOG_END */";
const createdDirs: string[] = [];

const UNCLASSIFIED_RENDERED_VALUE =
  ".row:not([data-lisa-value-source]), " +
  "tbody tr:not([data-lisa-value-source]), " +
  "tbody td:not([data-lisa-value-source]), " +
  '[data-lisa-renderer="callout"]:not([data-lisa-value-source])';

test.afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true }))
  );
});

test("every-section-live-or-empty", async ({ page }) => {
  await page.goto("/");

  const sections = page.locator("main section.section");
  await expect(sections).not.toHaveCount(0);
  expect(await sections.count()).toBe(await page.locator(".nav-item").count());
  await expect(
    sections.locator(
      ":scope:not([data-live-state='live']):not([data-live-state='empty']):not([data-live-state='unknown'])"
    )
  ).toHaveCount(0);
});

test("no-sourceless-row-renders-live (including before hydration)", async ({
  page,
}) => {
  await page.addInitScript(selector => {
    const seen: string[] = [];
    Object.defineProperty(window, "__demoSourcesSeen", { value: seen });
    new MutationObserver(() => {
      document
        .querySelectorAll('[data-lisa-value-source="demoOnly"]')
        .forEach(node => seen.push(node.textContent ?? ""));
      document
        .querySelectorAll(selector)
        .forEach(node => seen.push(`unclassified:${node.textContent ?? ""}`));
    }).observe(document, { childList: true, subtree: true });
  }, UNCLASSIFIED_RENDERED_VALUE);

  await page.goto("/");

  await expect(page.locator('[data-lisa-value-source="demoOnly"]')).toHaveCount(
    0
  );
  await expect(page.locator(UNCLASSIFIED_RENDERED_VALUE)).toHaveCount(0);
  await expect(page.locator('[data-lisa-renderer="callout"]')).not.toHaveCount(
    0
  );
  await expect(page.getByText(/Three rows fall short/u)).toHaveCount(0);
  await expect(page.getByText(/yours row above/u)).toHaveCount(0);
  await expect(page.getByText(/share one staff selector/u)).toHaveCount(0);
  await expect(page.getByText(/The gates are adversarial/u)).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __demoSourcesSeen: string[] }).__demoSourcesSeen
    )
  ).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            LISA_UI_CATALOG_STATE: { audit: { violations: unknown[] } };
          }
        ).LISA_UI_CATALOG_STATE.audit.violations
    )
  ).toEqual([]);
});

test("empty-source-no-demo-fallback", async ({ page }) => {
  await page.route("**/api/status", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        probes: {
          "github-repo": {
            state: "value",
            value: {
              owner: "live-owner",
              repo: "live-repo",
              settings: {},
              rulesets: [],
              labels: [],
              secrets: [],
            },
          },
        },
      }),
    });
  });

  await page.goto("/#repository");

  const section = page.locator("#section-repository");
  await expect(
    section.locator('[data-lisa-value-source="demoOnly"]')
  ).toHaveCount(0);
  await expect(page.getByTestId("github-rulesets-empty")).toHaveAttribute(
    "data-state",
    "empty"
  );
  await expect(page.getByTestId("github-labels-empty")).toHaveAttribute(
    "data-state",
    "empty"
  );
  await expect(page.getByTestId("github-secrets-empty")).toHaveAttribute(
    "data-state",
    "empty"
  );
  await expect(
    section.locator('[data-lisa-value-source="liveSource"] .row', {
      hasText: "unknown",
    })
  ).not.toHaveCount(0);
  await expect(section).toHaveAttribute(
    "data-live-state",
    /live|empty|unknown/u
  );
});

test("direct-file-open-still-renders-demo", async ({ page }) => {
  await page.goto(`${pathToFileURL(UI_FILE).href}#overview`);

  await expect(page.locator("#section-overview")).toContainText("project ACME");
  await expect(
    page.locator('[data-lisa-value-source="demoOnly"]')
  ).not.toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { LISA_UI_CATALOG_STATE: { liveMode: boolean } })
          .LISA_UI_CATALOG_STATE.liveMode
    )
  ).toBe(false);
});

test("guard-fails-on-sourceless-row", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-demo-guard-"));
  createdDirs.push(dir);
  const fixture = path.join(dir, "index.html");
  const html = (await readFile(UI_FILE, "utf8")).replace(
    CATALOG_END,
    `DATA.sections.__guard_bite = {
      title: "Guard bite",
      desc: "Injected fixture",
      blocks: [{ card: "Injected card", rows: [{
        label: "Offending guard bite row",
        control: txt("fiction")
      }] }]
    };\n      ${CATALOG_END}`
  );
  await writeFile(fixture, html, "utf8");

  await expect(
    execFileAsync(process.execPath, ["scripts/check-ui-demo-data.mjs", fixture])
  ).rejects.toMatchObject({
    stderr: expect.stringMatching(
      /__guard_bite > Injected card > Offending guard bite row/u
    ),
  });
});

test("callout provenance has a browser bite and sourced control", async ({
  browser,
}) => {
  const bitePage = await browser.newPage();
  const biteErrors = await loadInjectedLiveCatalog(
    bitePage,
    `DATA.sections.overview.blocks.push({
      type: "callout",
      text: "UNSOURCED FICTION"
    });`
  );

  expect(biteErrors.map(error => error.message).join("\n")).toMatch(
    /overview > callout/u
  );
  await expect(bitePage.getByText("UNSOURCED FICTION")).toHaveCount(0);
  await expect(bitePage.locator(UNCLASSIFIED_RENDERED_VALUE)).toHaveCount(0);
  await bitePage.close();

  const controlPage = await browser.newPage();
  const controlErrors = await loadInjectedLiveCatalog(
    controlPage,
    `DATA.sections.overview.blocks.push({
        type: "callout",
        text: "SOURCED DOCUMENTATION",
        staticCopy: "fixed test-only documentation"
      });`
  );

  expect(controlErrors).toEqual([]);
  const control = controlPage.getByText("SOURCED DOCUMENTATION");
  await expect(control).toBeVisible();
  await expect(control.locator("..")).toHaveAttribute(
    "data-lisa-renderer",
    "callout"
  );
  await expect(control.locator("..")).toHaveAttribute(
    "data-lisa-value-source",
    "staticCopy"
  );
  await expect(controlPage.locator(UNCLASSIFIED_RENDERED_VALUE)).toHaveCount(0);
  await controlPage.close();
});

test("acme live negative control", async ({ page }) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-acme-live-"));
  createdDirs.push(dir);
  await writeFile(
    path.join(dir, ".lisa.config.json"),
    JSON.stringify({ github: { org: "acme", repo: "acme-app" } }),
    "utf8"
  );
  const server = await runUi(dir, { port: "0", sync: false }, { probes: [] });
  try {
    const address = server.address() as AddressInfo;
    await page.goto(`http://127.0.0.1:${address.port}/`);

    await expect(page.locator(".project-switch .repo")).toHaveText(
      "acme/acme-app"
    );
    await expect(
      page.locator('[data-lisa-value-source="demoOnly"]')
    ).toHaveCount(0);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("partial live composites and empty selects render unknown", async ({
  page,
}) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-partial-config-"));
  createdDirs.push(dir);
  await writeFile(
    path.join(dir, ".lisa.config.json"),
    JSON.stringify({
      deploy: { branches: { production: "main" } },
      credentials: { store: "" },
    }),
    "utf8"
  );
  const server = await runUi(dir, { port: "0", sync: false }, { probes: [] });
  try {
    const address = server.address() as AddressInfo;
    await page.goto(`http://127.0.0.1:${address.port}/#deploy`);

    const branchMap = page.locator(".row", {
      hasText: "Environment branches",
    });
    await expect(branchMap.locator(".envmap .cell").nth(0)).toContainText(
      "dev"
    );
    await expect(branchMap.locator("input").nth(0)).toHaveValue("unknown");
    await expect(branchMap.locator("input").nth(1)).toHaveValue("unknown");
    await expect(branchMap.locator("input").nth(2)).toHaveValue("main");

    await page.goto(`http://127.0.0.1:${address.port}/#credentials`);
    const credentialStore = page.locator(".row", {
      hasText: "Credential store",
    });
    await expect(credentialStore.locator("select")).toHaveValue("");
    await expect(credentialStore.locator("option:checked")).toHaveText(
      "unknown"
    );
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

async function loadInjectedLiveCatalog(
  page: import("@playwright/test").Page,
  statement: string
): Promise<Error[]> {
  const html = (await readFile(UI_FILE, "utf8")).replace(
    CATALOG_END,
    `${statement}\n      ${CATALOG_END}`
  );
  const pageErrors: Error[] = [];
  page.on("pageerror", error => pageErrors.push(error));
  await page.route("http://catalog-fixture.test/**", async route => {
    if (new URL(route.request().url()).pathname === "/api/status") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ probes: {} }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: injectLiveConfig(html, {}),
    });
  });
  await page.goto("http://catalog-fixture.test/");
  await page.waitForTimeout(50);
  return pageErrors;
}

test("unknown renderer fails closed before exposing its control", async ({
  page,
}) => {
  const errors = await loadInjectedLiveCatalog(
    page,
    `DATA.sections.__unknown_renderer = {
      title: "Unknown renderer",
      desc: "Browser guard-bite fixture",
      blocks: [{
        type: "future-renderer",
        card: "Unsupported renderer",
        rows: [{ label: "Hidden fiction", control: txt("fiction") }]
      }]
    };`
  );

  expect(errors.map(error => error.message).join("\n")).toMatch(
    /unsupported renderer type future-renderer/u
  );
  await expect(page.getByText("Hidden fiction")).toHaveCount(0);
});

test("preserved Quality jobs rejects an added sourceless row", async ({
  page,
}) => {
  const errors = await loadInjectedLiveCatalog(
    page,
    `DATA.sections.ci.blocks.find(block => block.card === "Quality jobs").rows.push([
      { t: "mono", v: "Sourceless Quality job" },
      { t: "text", v: "This row has no declared source" },
      { t: "status", jobId: "sourceless", v: true }
    ]);`
  );

  expect(errors.map(error => error.message).join("\n")).toMatch(
    /ci > Quality jobs > Sourceless Quality job/u
  );
  await expect(page.getByText("Sourceless Quality job")).toHaveCount(0);
});

test("existing live-status harness control", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.locator("#liveStatusList .live-status-item", {
      hasText: "github-authenticated",
    })
  ).toContainText("true");
});
