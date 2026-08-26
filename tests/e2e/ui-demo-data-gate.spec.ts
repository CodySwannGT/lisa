/**
 * @file ui-demo-data-gate.spec.ts
 * @description Browser contracts that keep demo-only catalog values out of the live Lisa console
 * @module tests/e2e
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createConnection, type AddressInfo, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { injectLiveConfig, runUi } from "../../src/cli/ui-cmd.ts";
import {
  closeRunUiTestResources,
  type RunUiTeardownReport,
} from "./fixtures/run-ui-test-resources.ts";

const execFileAsync = promisify(execFile);
const UI_FILE = path.resolve("ui/index.html");
const CATALOG_END = "/* LISA_UI_CATALOG_END */";
const createdDirs: string[] = [];

/** A private browser origin whose complete lifecycle belongs to one test. */
interface PrivateUi {
  /** Origin selected by the operating system, never the shared Playwright port. */
  readonly base: string;
  /** Isolated context so closing this origin cannot disturb Playwright fixtures. */
  readonly context: BrowserContext;
  /** Only page allowed to retain connections to the private origin. */
  readonly page: Page;
  /** `runUi` listener that must stop before the test can finish. */
  readonly server: Server;
}

/** Fulfilled or rejected result used to preserve both assertion and cleanup errors. */
type Observed<T> =
  | { readonly status: "fulfilled"; readonly value: T }
  | { readonly reason: unknown; readonly status: "rejected" };

/**
 * Capture an asynchronous outcome without short-circuiting later cleanup.
 * @param action - One assertion or teardown stage whose error must remain visible
 * @returns The value or original rejection reason without rewriting its stack
 */
async function observe<T>(action: () => Promise<T>): Promise<Observed<T>> {
  try {
    return { status: "fulfilled", value: await action() };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

/**
 * Exercise a private live console and always drain its browser origin afterward.
 * @param browser - Worker browser used only to create an isolated owned context
 * @param dir - Temporary project root served by the private listener
 * @param exercise - Assertions to run against the isolated page and origin
 * @returns Teardown evidence for socket-lifecycle regression assertions
 * @remarks Assertion and teardown failures are aggregated so cleanup can never
 * replace the product assertion that caused the test to fail.
 */
async function withPrivateUi(
  browser: Browser,
  dir: string,
  exercise: (ui: PrivateUi) => Promise<void>
): Promise<RunUiTeardownReport> {
  const server = await runUi(dir, { port: "0", sync: false }, { probes: [] });
  const address = server.address() as AddressInfo;
  const context = await browser.newContext();
  const page = await context.newPage();
  const ui: PrivateUi = {
    base: `http://127.0.0.1:${address.port}`,
    context,
    page,
    server,
  };
  const assertion = await observe(async () => exercise(ui));
  const teardown = await observe(async () => closeRunUiTestResources(ui));
  if (assertion.status === "rejected" && teardown.status === "rejected") {
    throw new AggregateError(
      [assertion.reason, teardown.reason],
      "Live console assertions and teardown both failed"
    );
  }
  if (assertion.status === "rejected") throw assertion.reason;
  if (teardown.status === "rejected") throw teardown.reason;
  return teardown.value;
}

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

test("acme live negative control", async ({ browser }) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-acme-live-"));
  createdDirs.push(dir);
  await writeFile(
    path.join(dir, ".lisa.config.json"),
    JSON.stringify({ github: { org: "acme", repo: "acme-app" } }),
    "utf8"
  );
  const teardown = await withPrivateUi(browser, dir, async ({ base, page }) => {
    await page.goto(`${base}/`);

    await expect(page.locator(".project-switch .repo")).toHaveText(
      "acme/acme-app"
    );
    await expect(
      page.locator('[data-lisa-value-source="demoOnly"]')
    ).toHaveCount(0);
  });

  expect(teardown.connectionsBeforePageClose).toBeGreaterThan(0);
  expect(teardown.connectionsAfterServerClose).toBe(0);
  expect(teardown.forcedServerClose).toBe(false);
});

test("private runUi teardown force-drains a lingering connection", async ({
  browser,
}) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-close-bound-"));
  createdDirs.push(dir);
  let socket: Socket | undefined;
  let closeObserved: Promise<void> | undefined;
  try {
    const teardown = await withPrivateUi(
      browser,
      dir,
      async ({ base, server }) => {
        closeObserved = new Promise(resolve => server.once("close", resolve));
        const accepted = new Promise<void>(resolve => {
          server.once("connection", () => resolve());
        });
        const origin = new URL(base);
        socket = await new Promise<Socket>((resolve, reject) => {
          const connection = createConnection(
            { host: origin.hostname, port: Number(origin.port) },
            () => resolve(connection)
          );
          connection.once("error", reject);
        });
        socket.write(`GET / HTTP/1.1\r\nHost: ${origin.host}\r\n`);
        await accepted;
      }
    );

    expect(teardown.connectionsBeforePageClose).toBeGreaterThan(0);
    expect(teardown.connectionsAfterServerClose).toBe(0);
    expect(teardown.forcedServerClose).toBe(true);
    expect(closeObserved).toBeDefined();
    await closeObserved;
  } finally {
    socket?.destroy();
  }
});

test("malformed live control shapes and partial composites render unknown", async ({
  browser,
}) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-partial-config-"));
  createdDirs.push(dir);
  await writeFile(
    path.join(dir, ".lisa.config.json"),
    JSON.stringify({
      deploy: {
        branches: {
          staging: "release",
          production: { misleading: "branch" },
        },
      },
      credentials: { store: "" },
      quality: {
        mutation: {
          gate: {
            enabled: "false",
            since: { misleading: "text" },
          },
        },
      },
      repo: "truthful-repo",
      starter: { sync: { auto: false } },
    }),
    "utf8"
  );
  await withPrivateUi(browser, dir, async ({ base, page }) => {
    await page.goto(`${base}/#deploy`);

    const branchMap = page.locator(".row", {
      hasText: "Environment branches",
    });
    await expect(branchMap.locator(".envmap .cell").nth(0)).toContainText(
      "dev"
    );
    await expect(branchMap.locator("input").nth(0)).toHaveValue("unknown");
    await expect(branchMap.locator("input").nth(1)).toHaveValue("release");
    await expect(branchMap.locator("input").nth(2)).toHaveValue("unknown");

    await page.goto(`${base}/#credentials`);
    const credentialStore = page.locator(".row", {
      hasText: "Credential store",
    });
    await expect(credentialStore.locator("select")).toHaveValue("");
    await expect(credentialStore.locator("option:checked")).toHaveText(
      "unknown"
    );

    await page.goto(`${base}/#testing`);
    const malformedToggle = page.locator(".row", {
      hasText: "Mutation gates merges",
    });
    await expect(malformedToggle.locator("input")).toHaveCount(0);
    await expect(malformedToggle.locator(".control")).toHaveText("unknown");
    const malformedText = page.locator(".row", {
      hasText: "Mutation diff base",
    });
    await expect(malformedText.locator("input")).toHaveCount(0);
    await expect(malformedText.locator(".control")).toHaveText("unknown");

    await page.goto(`${base}/#general`);
    const truthfulText = page.locator(".row", { hasText: "Repository name" });
    await expect(truthfulText.locator("input")).toHaveValue("truthful-repo");

    await page.goto(`${base}/#starters`);
    const truthfulToggle = page.locator(".row", {
      hasText: "Automatic sync",
    });
    await expect(
      truthfulToggle.locator('input[type="checkbox"]')
    ).not.toBeChecked();
    await expect(truthfulToggle.locator(".switch-state")).toHaveText("off");
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
});

async function loadInjectedLiveCatalog(
  page: import("@playwright/test").Page,
  statement: string,
  liveConfig: unknown = {}
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
      body: injectLiveConfig(html, liveConfig),
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, "__lisaCatalogSettled", {
      configurable: true,
      value: false,
      writable: true,
    });
    window.addEventListener("error", () => {
      (
        window as unknown as { __lisaCatalogSettled: boolean }
      ).__lisaCatalogSettled = true;
    });
  });
  await page.goto("http://catalog-fixture.test/");
  await page.waitForFunction(
    () =>
      Object.hasOwn(window, "LISA_UI_CATALOG_STATE") ||
      (window as unknown as { __lisaCatalogSettled?: boolean })
        .__lisaCatalogSettled === true
  );
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
