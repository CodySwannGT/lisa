import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { inspectUiDemoData } from "../../../scripts/check-ui-demo-data.mjs";

interface UiDemoInspection {
  readonly audit: {
    readonly inspected: number;
    readonly sections: number;
    readonly violations: readonly string[];
  };
  readonly preparation?: {
    readonly liveMode: boolean;
    readonly pending: number;
    readonly removedDemo: number;
    readonly remainingDemo: number;
  } | null;
  readonly catalog: {
    readonly sections: Record<
      string,
      { readonly blocks: Array<{ readonly rows: Record<string, unknown>[] }> }
    >;
  };
}

const UI_FILE = path.resolve("ui/index.html");
const CATALOG_END = "/* LISA_UI_CATALOG_END */";

async function realUi(): Promise<string> {
  return readFile(UI_FILE, "utf8");
}

function injectCatalogStatement(html: string, statement: string): string {
  expect(html).toContain(CATALOG_END);
  return html.replace(CATALOG_END, `${statement}\n      ${CATALOG_END}`);
}

function inspectedRow(
  inspection: UiDemoInspection,
  label: string
): Record<string, unknown> {
  const row = inspection.catalog.sections.__test.blocks[0].rows.find(
    (candidate: Record<string, unknown>) => candidate.label === label
  );
  if (!row) throw new Error(`Missing inspected row ${label}`);
  return row;
}

describe("check-ui-demo-data", () => {
  it("audits the real UI catalog and inspects at least one rendered value", async () => {
    const inspection = inspectUiDemoData(await realUi());

    expect(inspection.audit.inspected).toBeGreaterThan(0);
    expect(inspection.audit.sections).toBeGreaterThan(0);
    expect(inspection.audit.violations).toEqual([]);
  });

  it("fails closed and names an injected sourceless row", async () => {
    const html = injectCatalogStatement(
      await realUi(),
      `DATA.sections.__test = {
        title: "Injected",
        desc: "Guard bite fixture",
        blocks: [{ card: "Injected card", rows: [{
          label: "Sourceless injected row",
          desc: "This value has no provenance",
          control: txt("fiction")
        }] }]
      };`
    );

    expect(() => inspectUiDemoData(html)).toThrowError(
      /__test > Injected card > Sourceless injected row/u
    );
  });

  it("accepts a legitimate live-sourced negative control", async () => {
    const html = injectCatalogStatement(
      await realUi(),
      `DATA.sections.__test = {
        title: "Injected",
        desc: "Live fixture",
        blocks: [{ card: "Injected card", rows: [{
          label: "acme/acme-app from the live API",
          liveSource: "api:test-fixture",
          control: txt("acme/acme-app")
        }] }]
      };`
    );

    const inspection = inspectUiDemoData(html, {
      liveConfigPresent: true,
      liveConfig: {},
    });

    expect(inspection.audit.violations).toEqual([]);
    expect(inspection.preparation?.liveMode).toBe(true);
    expect(inspection.preparation?.pending).toBeGreaterThan(0);
  });

  it.each([false, 0, "", null])(
    "treats present falsey LISA_LIVE_CONFIG value %j as live mode",
    async liveConfig => {
      const inspection = inspectUiDemoData(await realUi(), {
        liveConfigPresent: true,
        liveConfig,
      });

      expect(inspection.preparation?.liveMode).toBe(true);
      expect(inspection.preparation?.removedDemo).toBeGreaterThan(0);
      expect(inspection.preparation?.remainingDemo).toBe(0);
    }
  );

  it("distinguishes missing config keys from present falsey values", async () => {
    const html = injectCatalogStatement(
      await realUi(),
      `DATA.sections.__test = {
        title: "Injected",
        desc: "Falsey fixture",
        blocks: [{ card: "Injected card", rows: [
          { key: "fixture.enabled", label: "Present false", control: tog(true) },
          { key: "fixture.count", label: "Present zero", control: num(9) },
          { key: "fixture.name", label: "Present empty", control: txt("demo") },
          { key: "fixture.missing", label: "Missing", control: txt("demo") }
        ] }]
      };`
    );

    const inspection = inspectUiDemoData(html, {
      liveConfigPresent: true,
      liveConfig: { fixture: { enabled: false, count: 0, name: "" } },
    });

    expect(inspectedRow(inspection, "Present false").control).toMatchObject({
      type: "toggle",
      value: false,
    });
    expect(inspectedRow(inspection, "Present zero").control).toMatchObject({
      type: "number",
      value: 0,
    });
    expect(inspectedRow(inspection, "Present empty").control).toMatchObject({
      type: "text",
      value: "",
    });
    expect(inspectedRow(inspection, "Missing").control).toMatchObject({
      type: "static",
      value: "unknown",
    });
  });
});
