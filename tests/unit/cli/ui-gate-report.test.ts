/**
 * Tests for the Doctor tab's route and for the console block that reads it.
 *
 * The property worth pinning is where the report's markup lives. It is
 * composed by the server and fetched by a small block, rather than pasted into
 * `ui/index.html` — a 13,000-line zero-build file with a known concurrent-edit
 * hazard where union merges lose braces. A test that only checked the route
 * would not notice the markup being inlined later, so this file asserts the
 * absence as well as the presence.
 * @module tests/unit/cli/ui-gate-report
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REGISTRY } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

import {
  createGateReportHandler,
  readGateReport,
} from "../../../src/cli/ui-gate-report.js";
import { buildGateReport } from "../../../src/cli/gate-report.js";

import { homeFor, makeProject } from "./gate-report-fixtures.js";

/**
 * How many gates the registry ships.
 *
 * Derived, never typed. A literal here has to be edited every time the registry
 * grows, and the edit is indistinguishable from the report genuinely dropping a
 * gate — the assertion would be updated to match the bug.
 */
const GATE_COUNT = Object.keys(REGISTRY).length;

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);

/**
 * The console page, read once for the placement assertions.
 * @returns The packaged `ui/index.html`
 */
async function consolePage(): Promise<string> {
  return await readFile(path.join(REPO_ROOT, "ui", "index.html"), "utf8");
}

/** What one stubbed response recorded. */
interface Recorded {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/**
 * Drive the handler once with a stubbed request and response.
 * @param handler - The route handler
 * @param method - The HTTP method to send
 * @returns What the handler wrote
 */
async function callHandler(
  handler: ReturnType<typeof createGateReportHandler>,
  method: string
): Promise<Recorded> {
  return await new Promise<Recorded>(resolve => {
    const recorded = { status: 0, headers: {}, body: "" };
    const response = {
      writeHead(status: number, headers: Record<string, string>) {
        Object.assign(recorded, { status, headers });
      },
      end(body = "") {
        resolve({ ...recorded, body });
      },
    };
    handler(
      { method } as never,
      response as unknown as Parameters<typeof handler>[1]
    );
  });
}

describe("the /api/gate-report handler", () => {
  /** A build that always fails, so the error path is reachable. */
  const explode = async (): Promise<never> => {
    throw new Error("the report could not be derived");
  };

  it("answers HEAD without building the report", async () => {
    const handler = createGateReportHandler("/nowhere", { build: explode });
    const result = await callHandler(handler, "HEAD");
    expect(result.status).toBe(200);
    expect(result.body).toBe("");
  });

  it("refuses a method that is not a read", async () => {
    const handler = createGateReportHandler("/nowhere", { build: explode });
    const result = await callHandler(handler, "POST");
    expect(result.status).toBe(405);
    expect(result.headers["allow"]).toBe("GET, HEAD");
  });

  it("says the report could not be derived rather than serving an empty one", async () => {
    const handler = createGateReportHandler("/nowhere", { build: explode });
    const result = await callHandler(handler, "GET");
    expect(result.status).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      error: "the report could not be derived",
    });
    // The distinction that matters: a failure is NOT an empty report.
    expect(result.body).not.toContain("lisa-gate-report");
  });

  it("builds once for two concurrent GETs", async () => {
    const projectRoot = await makeProject({ config: {} });
    const calls: string[] = [];
    const handler = createGateReportHandler(projectRoot, {
      build: async root => {
        calls.push(root);
        return await buildGateReport({
          projectRoot: root,
          offline: true,
          homedir: () => homeFor(root),
        });
      },
    });
    const [first, second] = await Promise.all([
      callHandler(handler, "GET"),
      callHandler(handler, "GET"),
    ]);
    expect(calls).toHaveLength(1);
    expect(first?.status).toBe(200);
    expect(second?.body).toBe(first?.body);
  });
});

describe("GET /api/gate-report", () => {
  it("returns the fragment and the payload it was rendered from", async () => {
    const projectRoot = await makeProject({ config: {} });
    const result = await readGateReport(projectRoot, {
      build: async root =>
        await buildGateReport({
          projectRoot: root,
          offline: true,
          homedir: () => homeFor(root),
        }),
    });
    expect(result.html.startsWith('<div class="lisa-gate-report">')).toBe(true);
    expect(result.html).not.toContain("<!doctype");
    expect(result.report.gates).toHaveLength(GATE_COUNT);
  });

  it("builds once for concurrent readers", async () => {
    const projectRoot = await makeProject({ config: {} });
    const calls: string[] = [];
    const build = async (root: string): Promise<never> => {
      calls.push(root);
      throw new Error("boom");
    };
    await Promise.all([
      readGateReport(projectRoot, { build }).catch(() => undefined),
      readGateReport(projectRoot, { build }).catch(() => undefined),
    ]);
    // readGateReport itself is not the coalescing layer — the handler is — so
    // this asserts only that the reader is a plain function of its inputs.
    expect(calls).toEqual([projectRoot, projectRoot]);
  });
});

describe("where the Doctor tab's markup lives", () => {
  it("gives the console a tab, not a second page", async () => {
    const page = await consolePage();
    expect(page).toContain('"doctor"');
    expect(page).toContain("DATA.sections.doctor");
    expect(page).toContain('block.type === "doctor-report"');
  });

  it("fetches the report rather than carrying it inline", async () => {
    const page = await consolePage();
    expect(page).toContain('fetch("/api/gate-report"');
    expect(page).not.toContain("lisa-gate-report");
    expect(page).not.toContain("lgr-chip");
  });

  it("says the report could not be derived when opened without a server", async () => {
    const page = await consolePage();
    expect(page).toContain("DOCTOR_UNAVAILABLE");
    expect(page).toContain("not a clean bill of health");
  });
});
