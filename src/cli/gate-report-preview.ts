/**
 * Render the gate report as a standalone HTML page.
 *
 * Deliberately NOT part of `ui/index.html`. That file is one 13,000-line
 * document with no build step and a known hazard where concurrent edits merge
 * badly, and where the report should finally live is an open question nobody
 * has ruled on. A separate page sidesteps both: it is a viewing surface for a
 * payload that already exists, not a decision about the console's structure.
 *
 * Pure and total — report in, string out, no I/O — so the same emitter output
 * always produces the same bytes.
 *
 * The rendering rule that matters: `unknown` must never look like a pass. A
 * cell this run could not determine is drawn in its own hatched, muted style
 * with its own label, and the header counts it in a band of its own rather
 * than folding it into a green total.
 * @module cli/gate-report-preview
 */
import type {
  Finding,
  GateMomentCell,
  GateReport,
  GateReportRow,
} from "./gate-report-types.js";

/** How each declaration state is written and coloured. */
const DECLARATION_LABELS: Readonly<Record<string, string>> = {
  required: "must",
  optional: "tells",
  off: "off",
  "not-declared": "not declared",
};

/** Escape text for HTML text nodes and attribute values. */
const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape a string for interpolation into HTML.
 * @param value - Raw text
 * @returns Escaped text
 */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    character => ESCAPES[character] ?? character
  );
}

/**
 * The bucket chip for one cell, or the honest refusal to classify it.
 * @param bucket - The cell's bucket finding
 * @returns One chip of HTML
 */
function bucketChip(bucket: Finding<string>): string {
  if (bucket.state === "not-applicable") return "";
  if (bucket.state === "unknown") {
    return `<span class="chip unknown" title="${escapeHtml(bucket.message)}">not checked here</span>`;
  }
  const titles: Readonly<Record<string, string>> = {
    A: "declared, and an executor resolves the declaration",
    B: "an executor exists, but no declaration reaches it",
    C: "a declaration exists that nothing can execute",
    D: "neither declared nor executed",
  };
  return `<span class="chip b-${bucket.value}" title="${escapeHtml(titles[bucket.value] ?? "")}">${bucket.value}</span>`;
}

/**
 * One matrix cell.
 * @param cell - The (gate, moment) pair
 * @returns A table cell
 */
function momentCell(cell: GateMomentCell): string {
  if (!cell.legal) {
    return '<td class="m illegal" title="the registry does not permit declaring this gate here"></td>';
  }
  const label = DECLARATION_LABELS[cell.declaration] ?? cell.declaration;
  const state =
    cell.declaration === "not-declared" ? "undeclared" : cell.declaration;
  return `<td class="m"><span class="state ${state}">${escapeHtml(label)}</span>${bucketChip(cell.bucket)}</td>`;
}

/**
 * Whether `package.json` has the command, said in three states.
 * @param cell - The cell carrying the command
 * @returns One chip of HTML
 */
function commandChip(cell: GateMomentCell): string {
  if (cell.commandExists.state === "unknown") {
    return '<span class="chip unknown">command not checked</span>';
  }
  if (cell.commandExists.state === "not-applicable") return "";
  return cell.commandExists.value
    ? '<span class="chip ok">script exists</span>'
    : '<span class="chip bad">no such script</span>';
}

/**
 * The first cell of a row that carries a resolved command, for the task column.
 * @param row - One gate's row
 * @returns The most informative cell, or undefined
 */
function representativeCell(row: GateReportRow): GateMomentCell | undefined {
  return (
    row.moments.find(
      cell => cell.legal && cell.declaration !== "not-declared"
    ) ?? row.moments.find(cell => cell.legal)
  );
}

/**
 * Legal moments the project's own axis has no column for.
 *
 * There is no bare `deploy` moment in Lisa, and the deploy families only get a
 * column when a project declares an environment. Naming them here keeps the
 * information without inventing a column the project does not have.
 * @param row - One gate's row
 * @param axis - The report's moment axis
 * @returns Human text, or an empty string
 */
function offAxisMoments(row: GateReportRow, axis: readonly string[]): string {
  const families = row.legalMoments.filter(
    moment =>
      !axis.includes(moment) && !axis.some(one => one.startsWith(`${moment}:`))
  );
  return families.length === 0
    ? ""
    : `<div class="offaxis">also legal at ${escapeHtml(families.join(", "))}</div>`;
}

/**
 * The cloud job a gate maps to, from the static table.
 * @param job - The job id, or null when the table has no pair for this gate
 * @returns One cell fragment
 */
function jobCell(job: string | null): string {
  return job === null
    ? '<span class="chip none">no job</span>'
    : `<code>${escapeHtml(job)}</code>`;
}

/**
 * One gate row.
 * @param row - The gate
 * @param axis - The report's moment axis
 * @returns A table row
 */
function gateRow(row: GateReportRow, axis: readonly string[]): string {
  const cell = representativeCell(row);
  const task = cell?.task ?? row.defaultTask ?? "—";
  return [
    "<tr>",
    `<td><span class="gid">${escapeHtml(row.id)}</span><span class="glabel">${escapeHtml(row.label)}</span>`,
    offAxisMoments(row, axis),
    "</td>",
    `<td class="proves">${escapeHtml(row.summary)}</td>`,
    `<td><code>${escapeHtml(task)}</code>${cell === undefined ? "" : commandChip(cell)}</td>`,
    row.moments.map(momentCell).join(""),
    `<td>${jobCell(row.qualityJob)}<div class="tier3">reads the declaration: not checkable here</div></td>`,
    "</tr>",
  ].join("");
}

/**
 * The ruleset section — including the case where it was not read.
 * @param report - The whole report
 * @returns A section of HTML
 */
function rulesetSection(report: GateReport): string {
  if (report.ruleset.state !== "verified") {
    return `<p class="unknown-note">Branch protection was not read this run — <strong>${escapeHtml(report.ruleset.reason)}</strong>. ${escapeHtml(report.ruleset.message)} Nothing below claims a gate does or does not block a merge.</p>`;
  }
  const { matched, declaredNotRequired, requiredNotDeclared } =
    report.ruleset.value;
  const list = (values: readonly string[]): string =>
    values.length === 0
      ? "<li><em>none</em></li>"
      : values
          .map(value => `<li><code>${escapeHtml(value)}</code></li>`)
          .join("");
  return [
    '<div class="cols">',
    `<div><h3>Matched <span class="count">${matched.length}</span></h3><p>Declared <code>required</code>, and the ruleset requires it.</p><ul>${list(matched)}</ul></div>`,
    `<div><h3>Declared, not required <span class="count">${declaredNotRequired.length}</span></h3><p>The settings file asks for it; the ruleset does not enforce it, so it blocks nothing.</p><ul>${list(declaredNotRequired)}</ul></div>`,
    `<div class="sharp"><h3>Required, not declared <span class="count">${requiredNotDeclared.length}</span></h3><p>A merge is blocked on these, and <strong>no declaration governs them</strong>. Changing the settings file cannot turn them on, off, or into something else.</p><ul>${list(requiredNotDeclared)}</ul></div>`,
    "</div>",
  ].join("");
}

/**
 * The header counts, each with its denominator and its unknown band.
 * @param report - The whole report
 * @returns A section of HTML
 */
function summarySection(report: GateReport): string {
  const s = report.summary;
  const verified = s.buckets.A + s.buckets.B + s.buckets.C + s.buckets.D;
  return [
    '<div class="stats">',
    `<div class="stat"><b>${s.governedBySettings}</b><span>of ${s.gateCount} properties governed by the settings file</span></div>`,
    `<div class="stat"><b>${s.provedAnyway}</b><span>proved anyway by a command written into a script</span></div>`,
    `<div class="stat"><b>${s.declaredOffOnly}</b><span>mentioned only to be switched off</span></div>`,
    `<div class="stat"><b>${s.notDeclared}</b><span>never mentioned at all</span></div>`,
    "</div>",
    `<p class="denominator"><strong>${verified} of ${s.legalCells}</strong> gate-and-moment pairs were classified in this run — A ${s.buckets.A} · B ${s.buckets.B} · C ${s.buckets.C} · D ${s.buckets.D}. The other <strong>${s.bucketUnknown}</strong> are <span class="chip unknown">not checked here</span>: this run could not determine them, and they are counted separately rather than added to anything green.</p>`,
  ].join("");
}

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
  const axis = report.momentAxis;
  const head = axis
    .map(moment => `<th class="m">${escapeHtml(moment)}</th>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gate report — ${escapeHtml(projectLabel)}</title>
<style>${STYLE}</style></head><body>
<div class="wrap">
<header>
<h1>What this project's checks actually prove</h1>
<p class="sub">Derived, not written. Every number below comes from ${escapeHtml(projectLabel)}'s own settings file, package scripts and git hooks, joined against Lisa's check registry. Nothing here is a language model's summary of those files.</p>
${summarySection(report)}
</header>

<section>
<h2>Every check, and what governs it</h2>
<p class="lede">One row per check. One column per moment this project can declare a check at — there is no bare "deploy" column, because Lisa has no such moment: the deploy families take an environment suffix and only appear once a project names one.</p>
<div class="legend">
<span><span class="state required">must</span> declared required</span>
<span><span class="state optional">tells</span> declared optional</span>
<span><span class="state off">off</span> declared off — different from never declared</span>
<span><span class="state undeclared">not declared</span> the settings file never mentions it here</span>
<span><span class="chip b-A">A</span> declared, and something reads the declaration</span>
<span><span class="chip b-B">B</span> something runs it anyway; the settings file has no say</span>
<span><span class="chip b-C">C</span> declared, but nothing can run it</span>
<span><span class="chip unknown">not checked here</span> this run could not determine it — NOT a pass</span>
</div>
<div class="scroll"><table>
<thead><tr><th>Check</th><th>What a pass proves</th><th>Command</th>${head}<th>Cloud job</th></tr></thead>
<tbody>${report.gates.map(row => gateRow(row, axis)).join("")}</tbody>
</table></div>
</section>

<section>
<h2>What a merge is actually blocked on</h2>
<p class="lede">The contexts the settings file implies, beside the ones the repository's branch-protection rules really require. Nothing compares these two today, so they are only ever equal by hand.</p>
${rulesetSection(report)}
</section>

<footer>
<p>Report format v${String(report.version)} · registry read from the running Lisa package · runner <code>${escapeHtml(report.runner.state === "verified" ? report.runner.value : "unknown")}</code>${report.declarationProblems.length === 0 ? "" : ` · <strong>${String(report.declarationProblems.length)} declaration problem(s)</strong>: ${escapeHtml(report.declarationProblems.join("; "))}`}</p>
<p>Not rendered yet, and deliberately: the agent on-edit scripts, the table of cloud jobs that ignore the settings file, and any filtering.</p>
</footer>
</div>
</body></html>`;
}

/** All styling, inlined so the file opens from disk with no server. */
const STYLE = `
:root{--bg:#0f1115;--panel:#161923;--line:#252a38;--ink:#e6e9f2;--dim:#98a0b5;
--ok:#3fb950;--warn:#d29922;--bad:#f85149;--unk:#6b7280;--acc:#58a6ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1500px;margin:0 auto;padding:32px 24px 72px}
h1{font-size:26px;margin:0 0 8px}
h2{font-size:19px;margin:40px 0 6px;padding-top:24px;border-top:1px solid var(--line)}
h3{font-size:14px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim)}
.sub,.lede{color:var(--dim);margin:0 0 16px;max-width:80ch}
.stats{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0 12px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;
padding:12px 16px;min-width:170px}
.stat b{display:block;font-size:28px;line-height:1.1}
.stat span{color:var(--dim);font-size:12.5px}
.denominator{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--acc);
border-radius:8px;padding:12px 16px;margin:0;max-width:100ch}
.legend{display:flex;flex-wrap:wrap;gap:8px 18px;margin:14px 0;color:var(--dim);font-size:12.5px}
.legend>span{display:flex;align-items:center;gap:6px}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:13px;background:var(--panel)}
th,td{text-align:left;padding:9px 11px;border-bottom:1px solid var(--line);vertical-align:top}
th{position:sticky;top:0;background:#1b2030;font-size:11.5px;text-transform:uppercase;
letter-spacing:.05em;color:var(--dim);z-index:1}
th.m,td.m{text-align:center;white-space:nowrap}
td.illegal{background:repeating-linear-gradient(45deg,transparent,transparent 5px,#1b2030 5px,#1b2030 10px)}
tr:hover td{background:#1a1f2e}
.gid{display:block;font-family:ui-monospace,monospace;font-size:12px;color:var(--acc)}
.glabel{display:block;color:var(--dim);font-size:12px}
.offaxis{margin-top:4px;color:var(--unk);font-size:11px;font-style:italic}
.proves{color:var(--dim);max-width:34ch}
code{font-family:ui-monospace,monospace;font-size:12px;background:#10131c;
border:1px solid var(--line);border-radius:4px;padding:1px 5px}
.state{display:inline-block;font-size:11px;border-radius:5px;padding:2px 7px;font-weight:600}
.required{background:#1d3a24;color:#7ee787;border:1px solid #2ea04326}
.optional{background:#3a3117;color:#e3b341;border:1px solid #d2992226}
.off{background:#3a1d1d;color:#ff9492;border:1px solid #f8514926}
.undeclared{background:#1b2030;color:var(--unk);border:1px dashed #3a4157}
.chip{display:inline-block;margin-left:5px;font-size:10.5px;border-radius:4px;
padding:1px 5px;font-weight:600;vertical-align:1px}
.b-A{background:#123021;color:#7ee787}
.b-B{background:#3a2c12;color:#e3b341}
.b-C{background:#3a1616;color:#ff9492}
.b-D{background:#2a2a2a;color:#bbb}
.ok{background:#123021;color:#7ee787}
.bad{background:#3a1616;color:#ff9492}
.none{background:#1b2030;color:var(--unk)}
.unknown{background:repeating-linear-gradient(45deg,#22262f,#22262f 3px,#191d25 3px,#191d25 6px);
color:#9aa3b8;border:1px dashed #3f465c}
.tier3{margin-top:5px;font-size:11px;color:var(--unk);font-style:italic}
.unknown-note{background:repeating-linear-gradient(45deg,#22262f,#22262f 4px,#191d25 4px,#191d25 8px);
border:1px dashed #3f465c;border-radius:8px;padding:14px 16px;color:#c2c9db}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.cols>div{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.cols .sharp{border-color:#7d2b2b;background:#1e1618}
.cols p{color:var(--dim);font-size:12.5px;margin:0 0 8px}
.cols ul{margin:0;padding-left:18px}
.cols li{margin:3px 0;font-size:12.5px}
.count{float:right;color:var(--ink);font-size:13px}
footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--line);
color:var(--unk);font-size:12.5px}
`;
