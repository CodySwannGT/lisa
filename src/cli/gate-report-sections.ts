/**
 * The report's non-tabular sections.
 *
 * Three of them exist because a Lisa-shaped report describing only Lisa's own
 * jobs invites the conclusion that it is the whole picture:
 *
 * - **What else gates my merges** answers "and where does it come from",
 *   separating a context Lisa governs from one Lisa ships that nothing
 *   declares from one that is not Lisa's at all. The third is neither the
 *   project's misconfiguration nor Lisa's defect and must be labelled as such.
 * - **What runs on every edit** exists because the `pre-tool` column renders
 *   as a wall of "not legal here", which reads as "nothing happens here" when
 *   the truth is the more alarming state: things run here that nothing can
 *   govern.
 * - **Not this project's** states Lisa's own unfixed limitations once, with a
 *   count and a ticket, instead of scattering them through the project's report
 *   as rows it appears to have failed.
 *
 * A fourth is here for a duller reason: the emitter computed the `skip_jobs`
 * migration from the first day and the renderer showed none of it. Rendering
 * data the emitter already produced is the whole shape of this change, and
 * leaving one instance of it unrendered would be shipping the defect next to
 * its own fix. It is also the closest v1 gets to an action a reader can take:
 * the report never writes a declaration, but it can hand over the exact line to
 * paste.
 * @module cli/gate-report-sections
 */
import { chip, code, escapeHtml } from "./gate-report-html.js";
import type {
  ContextOrigin,
  GateReport,
  RequiredContextRow,
  SkipJobRow,
} from "./gate-report-types.js";

/** How each context origin is headed, in the operator's words. */
const ORIGIN_LABELS: Readonly<Record<ContextOrigin, string>> = {
  "lisa-governed": "Lisa's, and your settings govern it",
  "lisa-undeclared": "Lisa's, and nothing declares it",
  "project-workflow": "your own workflow",
  "third-party": "not Lisa's and not yours",
};

/** The order the origins read in — most actionable first. */
const ORIGIN_ORDER: readonly ContextOrigin[] = [
  "lisa-undeclared",
  "lisa-governed",
  "project-workflow",
  "third-party",
];

/**
 * The sentence describing the unknown band, and whose it is.
 *
 * Split out of the summary because the attribution clause is the part that
 * must not be lost: "fifty-two not checked here" reads as a project largely
 * unverified, and "all fifty-two are one Lisa limitation" reads as what it is.
 * @param s - The report's summary counts
 * @returns One sentence of HTML
 */
function unknownBand(s: GateReport["summary"]): string {
  if (s.bucketUnknown === 0) {
    return "Every one of them was classified in this run.";
  }
  const upstream =
    s.bucketUnknownUpstream === 0
      ? ""
      : `, and <strong>${s.bucketUnknownUpstream}</strong> of them are one Lisa limitation rather than anything about this project`;
  const owned = s.bucketUnknown - s.bucketUnknownUpstream;
  const mine =
    owned === 0 ? "" : `, with <strong>${owned}</strong> this project's own`;
  const label = chip("unknown", "not checked here");
  return `The other <strong>${s.bucketUnknown}</strong> are ${label} — counted separately rather than added to anything green${upstream}${mine}.`;
}

/**
 * The header counts, each with its denominator and its unknown band.
 * @param report - The whole report
 * @returns A section of HTML
 */
export function summarySection(report: GateReport): string {
  const s = report.summary;
  const classified = s.buckets.A + s.buckets.B + s.buckets.C + s.buckets.D;
  const unknownText = unknownBand(s);
  return [
    '<div class="lgr-stats">',
    `<div class="lgr-stat"><b>${s.governedBySettings}</b><span>of ${s.gateCount} properties governed by the settings file</span></div>`,
    `<div class="lgr-stat"><b>${s.provedAnyway}</b><span>proved anyway by a command written into a script</span></div>`,
    `<div class="lgr-stat"><b>${s.declaredOffOnly}</b><span>mentioned only to be switched off</span></div>`,
    `<div class="lgr-stat"><b>${s.notDeclared}</b><span>never mentioned at all</span></div>`,
    "</div>",
    `<p class="lgr-denominator"><strong>${classified} of ${s.legalCells}</strong> check-and-moment pairs were classified — A ${s.buckets.A} · B ${s.buckets.B} · C ${s.buckets.C} · D ${s.buckets.D}. ${unknownText}</p>`,
  ].join("");
}

/**
 * The declaration-versus-ruleset comparison.
 * @param report - The whole report
 * @returns A section of HTML
 */
export function rulesetSection(report: GateReport): string {
  if (report.ruleset.state !== "verified") {
    return `<p class="lgr-note">Branch protection was not read this run — <strong>${escapeHtml(report.ruleset.reason)}</strong>. ${escapeHtml(report.ruleset.message)} Nothing below claims a check does or does not block a merge.</p>`;
  }
  const { matched, declaredNotRequired, requiredNotDeclared } =
    report.ruleset.value;
  const list = (values: readonly string[]): string =>
    values.length === 0
      ? "<li><em>none</em></li>"
      : values.map(value => `<li>${code(value)}</li>`).join("");
  return [
    '<div class="lgr-cols">',
    `<div><h3>Matched <span class="lgr-count">${matched.length}</span></h3><p>Declared <code>required</code>, and the ruleset requires it.</p><ul>${list(matched)}</ul></div>`,
    `<div><h3>Declared, not required <span class="lgr-count">${declaredNotRequired.length}</span></h3><p>The settings file asks for it; the ruleset does not enforce it, so it blocks nothing.</p><ul>${list(declaredNotRequired)}</ul></div>`,
    `<div class="lgr-sharp"><h3>Required, not declared <span class="lgr-count">${requiredNotDeclared.length}</span></h3><p>A merge is blocked on these, and <strong>no declaration governs them</strong>. Changing the settings file cannot turn them on, off, or into something else.</p><ul>${list(requiredNotDeclared)}</ul></div>`,
    "</div>",
  ].join("");
}

/**
 * One origin's group of required contexts.
 * @param origin - The origin
 * @param rows - Its contexts
 * @returns A block of HTML, or an empty string when nothing has that origin
 */
function originGroup(
  origin: ContextOrigin,
  rows: readonly RequiredContextRow[]
): string {
  if (rows.length === 0) return "";
  const items = rows.map(row => `<li>${code(row.context)}</li>`).join("");
  const heading = escapeHtml(ORIGIN_LABELS[origin]);
  const detail = escapeHtml(rows[0]?.detail ?? "");
  return `<div class="lgr-origin lgr-origin-${escapeHtml(origin)}"><h3>${heading} <span class="lgr-count">${rows.length}</span></h3><p>${detail}</p><ul>${items}</ul></div>`;
}

/**
 * Everything a merge is blocked on, grouped by who put it there.
 * @param report - The whole report
 * @returns A section of HTML
 */
export function requiredContextsSection(report: GateReport): string {
  if (report.requiredContexts.state !== "verified") {
    return `<p class="lgr-note">The repository's required checks were not read this run — <strong>${escapeHtml(report.requiredContexts.reason)}</strong>. ${escapeHtml(report.requiredContexts.message)} This is not a claim that nothing else gates your merges.</p>`;
  }
  const rows = report.requiredContexts.value;
  if (rows.length === 0) {
    return '<p class="lgr-note">The ruleset requires no status check at all, so nothing here blocks a merge — including everything above.</p>';
  }
  return `<div class="lgr-cols">${ORIGIN_ORDER.map(origin =>
    originGroup(
      origin,
      rows.filter(row => row.origin === origin)
    )
  ).join("")}</div>`;
}

/** What each `skip_jobs` migration status means, in the operator's words. */
const SKIP_STATUS_TEXT: Readonly<Record<string, string>> = {
  replaceable: "one declaration replaces this token exactly",
  partial: "a declaration covers part of what this token switches off",
  unmappable: "no gate governs what this token switches off",
  inert: "this token switches nothing off",
  unknown: "this workflow has never had a token by this name",
  "moment-illegal": "the replacing gate cannot be declared at this moment",
};

/** The chip variant each status renders with. */
const SKIP_STATUS_VARIANT: Readonly<Record<string, string>> = {
  replaceable: "ok",
  partial: "b-B",
  unmappable: "bad",
  inert: "none",
  unknown: "bad",
  "moment-illegal": "bad",
};

/**
 * One row of the `skip_jobs` migration table.
 * @param entry - The token and its resolution
 * @returns A table row
 */
function skipJobRow(entry: SkipJobRow): string {
  const status = chip(
    SKIP_STATUS_VARIANT[entry.status] ?? "unknown",
    entry.status,
    SKIP_STATUS_TEXT[entry.status] ?? ""
  );
  const gate = entry.gate === null ? chip("none", "no gate") : code(entry.gate);
  const declaration =
    entry.declaration === null
      ? chip("none", "nothing to paste")
      : code(entry.declaration);
  return `<tr><td>${code(entry.token)}</td><td>${status}</td><td>${gate}</td><td>${declaration}</td></tr>`;
}

/**
 * The tokens this project still forwards, and what replaces each.
 * @param report - The whole report
 * @returns A section of HTML
 */
export function skipJobsSection(report: GateReport): string {
  if (report.skipJobs.state !== "verified") {
    return `<p class="lgr-note">${escapeHtml(report.skipJobs.message)}</p>`;
  }
  const rows = report.skipJobs.value;
  if (rows.length === 0) {
    return '<p class="lgr-note">This project forwards no <code>skip_jobs</code> tokens, so nothing here is switched off by name. That is a checked answer, not an absence of information.</p>';
  }
  return [
    `<p class="lgr-lede">Each token below switches a cloud job off <em>by name</em>, which no declaration governs. The last column is the line that replaces it — this report never writes it for you, but it can hand it over.</p>`,
    '<div class="lgr-scroll"><table><thead><tr><th>Token</th><th>Migration</th><th>Replaced by</th><th>Declaration to paste</th></tr></thead><tbody>',
    rows.map(skipJobRow).join(""),
    "</tbody></table></div>",
  ].join("");
}

/**
 * What fires on every file an agent writes.
 * @param report - The whole report
 * @returns A section of HTML
 */
export function agentHooksSection(report: GateReport): string {
  if (report.agentHooks.state !== "verified") {
    return `<p class="lgr-note">Which hooks run on every edit was not determined this run — <strong>${escapeHtml(report.agentHooks.reason)}</strong>. ${escapeHtml(report.agentHooks.message)}</p>`;
  }
  const hooks = report.agentHooks.value;
  if (hooks.length === 0) {
    return '<p class="lgr-note">No enabled plugin registers a hook on the tools that write files, so nothing runs at this moment. That is a checked answer, not an absence of information.</p>';
  }
  return [
    `<p class="lgr-lede"><strong>${hooks.length} script${hooks.length === 1 ? "" : "s"} run on every file an agent writes or edits.</strong> The <code>pre-tool</code> column above is empty because no check in Lisa's registry may be declared at this moment — not because nothing happens here. These are real enforcement, and your settings file has no say over any of them.</p>`,
    '<div class="lgr-scroll"><table><thead><tr><th>Script</th><th>Fires at</th><th>On tools</th><th>From plugin</th><th>Governed by settings</th></tr></thead><tbody>',
    hooks
      .map(
        hook =>
          `<tr><td>${code(hook.script)}</td><td>${escapeHtml(hook.event)}</td><td>${code(hook.matcher)}</td><td>${code(hook.plugin)}</td><td>${chip("bad", "no — not declarable")}</td></tr>`
      )
      .join(""),
    "</tbody></table></div>",
  ].join("");
}

/**
 * Lisa's own limitations, stated once each with a count and a ticket.
 * @param report - The whole report
 * @returns A section of HTML, or an empty string when there are none
 */
export function upstreamSection(report: GateReport): string {
  if (report.upstream.length === 0) {
    return '<p class="lgr-note">Nothing in this report was left unanswered by a limitation of Lisa itself.</p>';
  }
  const lede = report.projectIsUpstream
    ? "This project <em>is</em> Lisa, so these are yours to fix — this is the one place the list below is actionable."
    : "These are limitations of Lisa, not of this project. Nothing you can change here fixes them, and none of them means anything is wrong with your project.";
  return [
    `<p class="lgr-lede">${lede}</p>`,
    ...report.upstream.map(
      limitation =>
        `<div class="lgr-upstream"><h3>${escapeHtml(limitation.headline)}</h3><p>${escapeHtml(limitation.detail)}</p><p class="lgr-upstream-meta">Affects <strong>${limitation.affected}</strong> ${escapeHtml(limitation.unit)} in this report · tracked as ${code(limitation.ticket)}</p></div>`
    ),
  ].join("");
}
