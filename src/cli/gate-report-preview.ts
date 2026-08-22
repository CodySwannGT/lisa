/**
 * The gate report as a standalone HTML document.
 *
 * A thin wrapper around the fragment the console tab renders, and nothing
 * more. The two surfaces cannot disagree because there is only one renderer:
 * this file supplies a `<head>`, a page frame, and the console's colour tokens
 * so the same scoped stylesheet has something to resolve against.
 *
 * It exists for the cases the tab cannot serve — a report written to a file, a
 * report attached to a build — and not as a second place the report is
 * decided. Where the report lives was an open question when the fragment was
 * first written; it has been ruled on, and the answer is the console tab.
 * @module cli/gate-report-preview
 */
import { renderGateReportFragment } from "./gate-report-fragment.js";
import { escapeHtml } from "./gate-report-html.js";
import type { GateReport } from "./gate-report-types.js";

/**
 * The console's token names, given dark values.
 *
 * The fragment's stylesheet reads the console's tokens with fallbacks, so a
 * standalone page only has to define the same names once. Duplicating the
 * fragment's own rules here would be the second source of truth this split
 * exists to avoid.
 */
const DOCUMENT_TOKENS = `
:root{--ink:#e6e9f2;--muted:#98a0b5;--faint:#6b7280;--surface:#161923;
--surface2:#1b2030;--line:#252a38;--accent:#58a6ff;
--good:#7ee787;--good-soft:#123021;--warn:#e3b341;--warn-soft:#3a2c12;
--crit:#ff9492;--crit-soft:#3a1616;
--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
*{box-sizing:border-box}
body{margin:0;background:#0f1115;color:var(--ink);
font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif}
.page{max-width:1500px;margin:0 auto;padding:32px 24px 72px}
h1{font-size:25px;margin:0 0 8px}
`;

/**
 * Render the whole page.
 * @param report - The emitter's output
 * @param projectLabel - How to name the project being reported on
 * @returns A complete, self-contained HTML document
 */
export function renderGateReportPreview(
  report: GateReport,
  projectLabel: string
): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gate report — ${escapeHtml(projectLabel)}</title>
<style>${DOCUMENT_TOKENS}</style></head><body>
<div class="page">
<h1>What this project's checks actually prove</h1>
${renderGateReportFragment(report, projectLabel)}
</div>
</body></html>`;
}
