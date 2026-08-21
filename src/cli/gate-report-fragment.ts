/**
 * The gate report as an HTML fragment, for the Doctor tab in `lisa ui`.
 *
 * A fragment rather than a document because the ruling is that this is one
 * surface: a tab alongside the console's other tabs, not a second page on a
 * second port served by a second server.
 *
 * It is composed HERE and injected by the server at request time, and that is
 * deliberate. `ui/index.html` is a single 13,000-line zero-build file with a
 * known concurrent-edit hazard where union merges lose braces; appending a
 * section of this size to it would make a bad merge materially worse and would
 * put a second copy of this markup somewhere no test renders. The console
 * gains a small block that asks the server for this string, so the file grows
 * by tens of lines rather than hundreds, and opening `ui/index.html` straight
 * from disk still works — the tab then says, in the report's own vocabulary,
 * that it could not be derived without a server rather than showing an empty
 * panel.
 *
 * Pure and total: report in, string out, no I/O, so the same emitter output
 * always produces the same bytes.
 * @module cli/gate-report-fragment
 */
import { chip, escapeHtml } from "./gate-report-html.js";
import { gateRow } from "./gate-report-rows.js";
import {
  agentHooksSection,
  requiredContextsSection,
  rulesetSection,
  skipJobsSection,
  summarySection,
  upstreamSection,
} from "./gate-report-sections.js";
import { GATE_REPORT_STYLE } from "./gate-report-style.js";
import type { GateReport } from "./gate-report-types.js";

/** The class every rule in the report's stylesheet is scoped to. */
export const GATE_REPORT_ROOT_CLASS = "lisa-gate-report";

/**
 * The legend, which is where the three states are named for the reader.
 * @returns A block of HTML
 */
function legend(): string {
  return [
    '<div class="lgr-legend">',
    `<span><span class="lgr-state lgr-required">must</span> declared required</span>`,
    `<span><span class="lgr-state lgr-optional">tells</span> declared optional</span>`,
    `<span><span class="lgr-state lgr-off">off</span> declared off — different from never declared</span>`,
    `<span><span class="lgr-state lgr-undeclared">not declared</span> the settings file never mentions it here</span>`,
    `<span>${chip("b-A", "A")} declared, and something reads the declaration</span>`,
    `<span>${chip("b-B", "B")} something runs it anyway; the settings file has no say</span>`,
    `<span>${chip("b-C", "C")} declared, but nothing can run it</span>`,
    `<span>${chip("b-D", "D")} nothing declares it and nothing runs it</span>`,
    `<span>${chip("unknown", "not checked here")} this run could not determine it — NOT a pass</span>`,
    "</div>",
  ].join("");
}

/**
 * The footer, which names what the report was derived from.
 * @param report - The whole report
 * @returns A block of HTML
 */
function footer(report: GateReport): string {
  const runner =
    report.runner.state === "verified" ? report.runner.value : "unknown";
  const problems =
    report.declarationProblems.length === 0
      ? ""
      : ` · <strong>${report.declarationProblems.length} declaration problem(s)</strong>: ${escapeHtml(report.declarationProblems.join("; "))}`;
  const facade = report.facadeSource.present
    ? `the workflow file was read from this checkout (${report.facadeSource.files.length} workflow file(s))`
    : "this project holds no copy of the workflow, so what each cloud job does with a declaration could not be read";
  return `<div class="lgr-foot"><p>Report format v${report.version} · registry read from the running Lisa package · runner <code>${escapeHtml(runner)}</code> · ${escapeHtml(facade)}${problems}</p></div>`;
}

/**
 * Render the report as a fragment for the console tab.
 * @param report - The emitter's output
 * @param projectLabel - How to name the project being reported on
 * @returns HTML with no document wrapper, safe to inject into the console
 */
export function renderGateReportFragment(
  report: GateReport,
  projectLabel: string
): string {
  const axis = report.momentAxis;
  const head = axis
    .map(moment => `<th class="lgr-m">${escapeHtml(moment)}</th>`)
    .join("");
  return [
    `<div class="${GATE_REPORT_ROOT_CLASS}">`,
    `<style>${GATE_REPORT_STYLE}</style>`,
    `<p class="lgr-sub">Derived, not written. Every number below comes from ${escapeHtml(projectLabel)}'s own settings file, package scripts, git hooks and workflows, joined against Lisa's check registry. Nothing here is a language model's summary of those files.</p>`,
    summarySection(report),
    "<h2>Every check, and what governs it</h2>",
    '<p class="lgr-lede">One row per check. One column per moment this project can declare a check at — there is no bare "deploy" column, because Lisa has no such moment: the deploy families take an environment suffix and only appear once a project names one.</p>',
    legend(),
    '<div class="lgr-scroll"><table>',
    `<thead><tr><th>Check</th><th>What a pass proves</th><th>Command</th>${head}<th class="lgr-m">Blocks a merge</th><th>Cloud job</th></tr></thead>`,
    `<tbody>${report.gates.map(row => gateRow(row, axis)).join("")}</tbody>`,
    "</table></div>",
    "<h2>What your settings imply, against what the repository requires</h2>",
    '<p class="lgr-lede">The contexts the settings file implies, beside the ones the repository\'s branch-protection rules really require. Nothing compares these two automatically, so they are only ever equal by hand.</p>',
    rulesetSection(report),
    "<h2>What else gates my merges, and where does it come from</h2>",
    '<p class="lgr-lede">Everything above describes Lisa\'s own jobs. This is every required check standing between a change and a merge, whoever put it there — including the ones Lisa neither ships nor governs.</p>',
    requiredContextsSection(report),
    "<h2>What this project still switches off by name</h2>",
    skipJobsSection(report),
    "<h2>What runs on every edit</h2>",
    agentHooksSection(report),
    `<h2>${report.projectIsUpstream ? "Lisa's own limitations — and this project is Lisa" : "Not this project's — Lisa's"}</h2>`,
    upstreamSection(report),
    footer(report),
    "</div>",
  ].join("");
}
