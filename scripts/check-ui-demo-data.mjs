#!/usr/bin/env node

/**
 * Evaluate the Lisa UI catalog in a code-generation-disabled VM and invoke the
 * catalog's own renderer-aware audit. Keeping the audit in `ui/index.html`
 * means the browser and repository guard cannot drift into different ideas of
 * which values are renderable.
 * @module scripts/check-ui-demo-data
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

const START_MARKER = "/* LISA_UI_CATALOG_START */";
const END_MARKER = "/* LISA_UI_CATALOG_END */";
const DEFAULT_UI_FILE = path.resolve("ui/index.html");
const VM_TIMEOUT_MS = 2_000;

/**
 * Extract exactly one bounded catalog program from the HTML document.
 * @param {string} html - Complete UI HTML
 * @returns {string} Catalog JavaScript including the shared audit seam
 */
export function extractUiCatalogProgram(html) {
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      `UI catalog markers are missing or out of order (${START_MARKER}, ${END_MARKER})`
    );
  }
  if (
    html.indexOf(START_MARKER, start + START_MARKER.length) !== -1 ||
    html.indexOf(END_MARKER, end + END_MARKER.length) !== -1
  ) {
    throw new Error("UI catalog markers must each occur exactly once");
  }
  return html.slice(start + START_MARKER.length, end);
}

/**
 * Audit an HTML catalog and optionally exercise the live preparation path.
 * @param {string} html - Complete UI HTML
 * @param {{liveConfigPresent?: boolean, liveConfig?: unknown, filename?: string}} [options]
 * @returns {{audit: {inspected: number, sections: number, violations: string[]}, preparation: object|null, catalog: object}}
 */
export function inspectUiDemoData(html, options = {}) {
  const context = vm.createContext(
    {
      __liveConfigPresent: options.liveConfigPresent === true,
      __liveConfig: options.liveConfig,
    },
    {
      codeGeneration: { strings: false, wasm: false },
      name: "lisa-ui-demo-data-audit",
    }
  );
  const program = `${extractUiCatalogProgram(html)}
    const __auditResult = auditUiCatalog(DATA);
    const __preparationResult = globalThis.__liveConfigPresent
      ? prepareUiCatalogForLive(DATA, globalThis.__liveConfig)
      : null;
    globalThis.__inspectionResult = {
      audit: __auditResult,
      preparation: __preparationResult,
      catalog: DATA
    };
  `;
  // The bounded catalog source is intentionally executed in a context with
  // string/wasm code generation disabled and a hard timeout. This is the
  // guard's shared-seam contract, not application input.
  // eslint-disable-next-line sonarjs/code-eval -- Evaluate only the extracted catalog inside the locked VM above.
  vm.runInContext(program, context, {
    displayErrors: true,
    filename: options.filename || "ui/index.html#catalog",
    timeout: VM_TIMEOUT_MS,
  });
  return context.__inspectionResult;
}

/** Run the repository guard against a supplied file or the real UI. */
function main() {
  const file = path.resolve(process.argv[2] || DEFAULT_UI_FILE);
  try {
    const inspection = inspectUiDemoData(readFileSync(file, "utf8"), {
      filename: file,
    });
    process.stdout.write(
      `[ui-demo-data] PASS: inspected ${inspection.audit.inspected} rendered values across ${inspection.audit.sections} sections\n`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[ui-demo-data] FAIL: ${message}\n`);
    process.exitCode = 1;
  }
}

if (invokedAsScript(import.meta.url)) {
  main();
}
