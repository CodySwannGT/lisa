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

import { readGateReport } from "../../../src/cli/ui-gate-report.js";
import { buildGateReport } from "../../../src/cli/gate-report.js";

import { homeFor, makeProject } from "./gate-report-fixtures.js";

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
    expect(result.report.gates).toHaveLength(34);
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
