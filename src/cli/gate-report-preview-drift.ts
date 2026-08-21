/**
 * Render the declaration-versus-enforcement comparison.
 *
 * One block per enforcing surface, never merged into a single verdict: a
 * surface this run could read must not vouch for one it could not. An unread
 * surface is drawn in the same hatched, muted style as any other `unknown` and
 * says so in words, because the one rendering rule this report cannot bend is
 * that "not checked" must never look like agreement.
 * @module cli/gate-report-preview-drift
 */
import type {
  DeclarationDriftReport,
  DriftVerdict,
} from "../core/gate-declaration-drift.js";
import { escapeHtml } from "./gate-report-preview-escape.js";
import type { Finding, GateReport } from "./gate-report-types.js";

/** How each verdict is headed, in the operator's words. */
const VERDICT_HEADINGS: Readonly<Record<DriftVerdict, string>> = {
  matched: "Declared required, and enforced",
  "declared-not-enforced": "Declared required — enforced by nothing",
  "enforced-declared-optional": "Enforced, declared optional",
  "enforced-declared-off": "Enforced, declared OFF",
  "enforced-undeclared": "Enforced, governed by no declaration",
  "enforced-not-lisa-owned": "Enforced, produced by no Lisa gate",
};

/** Which verdicts are drawn as sharp rather than neutral. */
const SHARP_VERDICTS: ReadonlySet<DriftVerdict> = new Set<DriftVerdict>([
  "declared-not-enforced",
  "enforced-declared-off",
]);

/** The verdicts, in the order an operator should read them. */
const VERDICT_ORDER: readonly DriftVerdict[] = [
  "enforced-declared-off",
  "declared-not-enforced",
  "enforced-undeclared",
  "enforced-declared-optional",
  "enforced-not-lisa-owned",
  "matched",
];

/**
 * One verdict's card, listing every context that earned it.
 * @param report - The completed comparison
 * @param verdict - The verdict to card
 * @returns A card of HTML, or an empty string when nothing earned it
 */
function verdictCard(
  report: DeclarationDriftReport,
  verdict: DriftVerdict
): string {
  const entries = report.entries.filter(entry => entry.verdict === verdict);
  if (entries.length === 0) return "";
  const items = entries
    .map(
      entry =>
        `<li><code>${escapeHtml(entry.context)}</code><div class="why">${escapeHtml(entry.detail)}</div><div class="why">remedy: <strong>${escapeHtml(entry.remedy)}</strong></div></li>`
    )
    .join("");
  return `<div${SHARP_VERDICTS.has(verdict) ? ' class="sharp"' : ""}><h3>${escapeHtml(VERDICT_HEADINGS[verdict])} <span class="count">${entries.length}</span></h3><ul>${items}</ul></div>`;
}

/**
 * One enforcing surface's comparison — including the case where it was unread.
 * @param finding - The comparison, or why there is none
 * @param title - How to name the surface
 * @returns A block of HTML
 */
function driftBlock(
  finding: Finding<DeclarationDriftReport>,
  title: string
): string {
  if (finding.state !== "verified") {
    return `<h3 class="surface">${escapeHtml(title)}</h3><p class="unknown-note">Not compared this run — <strong>${escapeHtml(finding.reason)}</strong>. ${escapeHtml(finding.message)} This is <em>not</em> a match.</p>`;
  }
  return [
    `<h3 class="surface">${escapeHtml(title)}</h3>`,
    '<div class="cols">',
    VERDICT_ORDER.map(verdict => verdictCard(finding.value, verdict)).join(""),
    "</div>",
  ].join("");
}

/**
 * The declaration-versus-enforcement section, one block per surface.
 * @param report - The whole report
 * @returns A section of HTML
 */
export function declarationDriftSection(report: GateReport): string {
  return [
    driftBlock(
      report.declarationDrift.templates,
      "Against the ruleset template this repository is provisioned from"
    ),
    driftBlock(
      report.declarationDrift.live,
      "Against the live branch-protection ruleset"
    ),
  ].join("");
}
