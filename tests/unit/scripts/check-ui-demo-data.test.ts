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
      {
        readonly blocks: Array<{
          readonly card?: string;
          readonly demoOnly?: boolean;
          readonly liveSource?: string;
          readonly rows?: Record<string, unknown>[];
          readonly staticCopy?: string;
          readonly tabs?: Array<{
            readonly blocks: UiDemoInspection["catalog"]["sections"][string]["blocks"];
          }>;
          readonly text?: string;
          readonly type?: string;
        }>;
      }
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
  const row = inspection.catalog.sections.__test.blocks[0].rows?.find(
    (candidate: Record<string, unknown>) => candidate.label === label
  );
  if (!row) throw new Error(`Missing inspected row ${label}`);
  return row;
}

function realCatalogRow(
  inspection: UiDemoInspection,
  section: string,
  card: string,
  label: string
): Record<string, unknown> {
  const blocks = inspection.catalog.sections[section]?.blocks ?? [];
  const block = blocks.find(candidate => candidate.card === card);
  const row = block?.rows?.find(candidate => candidate.label === label);
  if (!row) throw new Error(`Missing catalog row ${section}/${card}/${label}`);
  return row;
}

function catalogCallouts(
  inspection: UiDemoInspection
): Array<UiDemoInspection["catalog"]["sections"][string]["blocks"][number]> {
  type Block =
    UiDemoInspection["catalog"]["sections"][string]["blocks"][number];
  const collect = (blocks: readonly Block[]): Block[] =>
    blocks.flatMap(block => [
      ...(block.type === "callout" ? [block] : []),
      ...(block.tabs || []).flatMap(tab => collect(tab.blocks)),
    ]);
  return Object.values(inspection.catalog.sections).flatMap(section =>
    collect(section.blocks)
  );
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

  it("fails closed and names an injected sourceless callout", async () => {
    const html = injectCatalogStatement(
      await realUi(),
      `DATA.sections.__test = {
        title: "Injected",
        desc: "Callout guard bite fixture",
        blocks: [{ type: "callout", text: "UNSOURCED FICTION" }]
      };`
    );

    expect(() => inspectUiDemoData(html)).toThrowError(/__test > callout/u);
  });

  it("keeps a sourced static callout as the guard control", async () => {
    const html = injectCatalogStatement(
      await realUi(),
      `DATA.sections.__test = {
        title: "Injected",
        desc: "Callout guard control fixture",
        blocks: [{
          type: "callout",
          text: "SOURCED DOCUMENTATION",
          staticCopy: "fixed test-only documentation"
        }]
      };`
    );

    const inspection = inspectUiDemoData(html, {
      liveConfigPresent: true,
      liveConfig: {},
    });

    expect(inspection.audit.violations).toEqual([]);
    expect(catalogCallouts(inspection)).toContainEqual(
      expect.objectContaining({
        staticCopy: "fixed test-only documentation",
        text: "SOURCED DOCUMENTATION",
      })
    );
  });

  it("classifies every shipped callout and scrubs demo-dependent claims live", async () => {
    const standalone = inspectUiDemoData(await realUi());
    const callouts = catalogCallouts(standalone);

    expect(callouts.length).toBeGreaterThan(0);
    for (const callout of callouts) {
      expect(
        [
          callout.demoOnly === true,
          callout.liveSource,
          callout.staticCopy,
        ].filter(Boolean)
      ).toHaveLength(1);
    }

    const live = inspectUiDemoData(await realUi(), {
      liveConfigPresent: true,
      liveConfig: {},
    });
    const liveText = catalogCallouts(live)
      .map(callout => callout.text)
      .join("\n");

    expect(liveText).not.toContain("Three rows fall short");
    expect(liveText).not.toContain("yours</span> row above");
    expect(liveText).not.toContain("share one staff selector");
    expect(liveText).toContain("The gates are adversarial");
  });

  it("fails closed on an unknown renderer carrying a sourceless control", async () => {
    const html = injectCatalogStatement(
      await realUi(),
      `DATA.sections.__test = {
        title: "Injected",
        desc: "Unknown renderer fixture",
        blocks: [{
          type: "future-renderer",
          card: "Unsupported renderer",
          rows: [{ label: "Hidden fiction", control: txt("fiction") }]
        }]
      };`
    );

    expect(() => inspectUiDemoData(html)).toThrowError(
      /__test > Unsupported renderer.*unsupported renderer type future-renderer/u
    );
  });

  it("fails closed on a sourceless row added to preserved Quality jobs", async () => {
    const html = injectCatalogStatement(
      await realUi(),
      `DATA.sections.ci.blocks.find(block => block.card === "Quality jobs").rows.push([
        { t: "mono", v: "Sourceless Quality job" },
        { t: "text", v: "This row has no declared source" },
        { t: "status", jobId: "sourceless", v: true }
      ]);`
    );

    expect(() => inspectUiDemoData(html)).toThrowError(
      /ci > Quality jobs > Sourceless Quality job/u
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

  it("rejects malformed control shapes instead of coercing plausible values", async () => {
    const html = injectCatalogStatement(
      await realUi(),
      `DATA.sections.__test = {
        title: "Injected",
        desc: "Shape validation fixture",
        blocks: [{ card: "Injected card", rows: [
          { key: "fixture.toggle", label: "Malformed toggle", control: tog(false) },
          { key: "fixture.text", label: "Malformed text", control: txt("demo") },
          { key: "fixture.tags", label: "Malformed tags", control: tags(["demo"]) },
          { key: "fixture.environments", label: "Mixed environment axes", control: envmap("demo", "demo", "demo") }
        ] }]
      };`
    );

    const inspection = inspectUiDemoData(html, {
      liveConfigPresent: true,
      liveConfig: {
        fixture: {
          toggle: "false",
          text: { misleading: "text" },
          tags: ["truthful", { misleading: "tag" }],
          environments: {
            dev: { misleading: "branch" },
            staging: "release",
            production: 42,
          },
        },
      },
    });

    expect(inspection.audit.violations).toEqual([]);
    for (const label of [
      "Malformed toggle",
      "Malformed text",
      "Malformed tags",
    ]) {
      expect(inspectedRow(inspection, label).control).toMatchObject({
        type: "static",
        value: "unknown",
      });
    }
    expect(
      inspectedRow(inspection, "Mixed environment axes").control
    ).toMatchObject({
      type: "envmap",
      dev: "unknown",
      staging: "release",
      production: "unknown",
    });
  });

  it("hydrates controls when every live value has its expected shape", async () => {
    const html = injectCatalogStatement(
      await realUi(),
      `DATA.sections.__test = {
        title: "Injected",
        desc: "Truthful shape fixture",
        blocks: [{ card: "Injected card", rows: [
          { key: "fixture.toggle", label: "Truthful toggle", control: tog(true) },
          { key: "fixture.text", label: "Truthful text", control: txt("demo") },
          { key: "fixture.tags", label: "Truthful tags", control: tags(["demo"]) },
          { key: "fixture.environments", label: "Truthful environments", control: envmap("demo", "demo", "demo") }
        ] }]
      };`
    );

    const inspection = inspectUiDemoData(html, {
      liveConfigPresent: true,
      liveConfig: {
        fixture: {
          toggle: false,
          text: "truthful",
          tags: ["one", "two"],
          environments: {
            dev: "develop",
            staging: "release",
            production: "main",
          },
        },
      },
    });

    expect(inspection.audit.violations).toEqual([]);
    expect(inspectedRow(inspection, "Truthful toggle").control).toMatchObject({
      type: "toggle",
      value: false,
    });
    expect(inspectedRow(inspection, "Truthful text").control).toMatchObject({
      type: "text",
      value: "truthful",
    });
    expect(inspectedRow(inspection, "Truthful tags").control).toMatchObject({
      type: "tags",
      values: ["one", "two"],
    });
    expect(
      inspectedRow(inspection, "Truthful environments").control
    ).toMatchObject({
      type: "envmap",
      dev: "develop",
      staging: "release",
      production: "main",
    });
  });

  it("resets every composite axis before applying a partial live value", async () => {
    const inspection = inspectUiDemoData(await realUi(), {
      liveConfigPresent: true,
      liveConfig: { deploy: { branches: { production: "main" } } },
    });

    expect(
      realCatalogRow(inspection, "deploy", "Branch map", "Environment branches")
        .control
    ).toMatchObject({
      type: "envmap",
      dev: "unknown",
      staging: "unknown",
      production: "main",
    });
  });

  it("keeps a present empty select value for explicit unknown rendering", async () => {
    const inspection = inspectUiDemoData(await realUi(), {
      liveConfigPresent: true,
      liveConfig: { credentials: { store: "" } },
    });

    expect(
      realCatalogRow(
        inspection,
        "credentials",
        "Where secrets live",
        "Credential store"
      ).control
    ).toMatchObject({ type: "select", value: "" });
  });
});
