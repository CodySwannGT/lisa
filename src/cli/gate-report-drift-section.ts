/**
 * Render the declaration-versus-enforcement comparison.
 *
 * One block per enforcing surface, never merged into a single verdict: a
 * surface this run could read must not vouch for one it could not. An unread
 * surface is drawn in the same hatched, muted style as any other `unknown` and
 * says so in words, because the one rendering rule this report cannot bend is
 * that "not checked" must never look like agreement.
 *
 * And the sharper thing this section has to say, which its own headings cannot:
 * **agreement is not proof.** A `matched` row means the settings file and the
 * ruleset name the same required context. It does not mean the check proves
 * anything — one required context in this very repository ships a skip step
 * that prints "This job going green does NOT mean any ast-grep rule has test
 * coverage", and a required review context has gone green carrying "Review
 * skipped". So the section says it in the lede rather than letting a column of
 * agreements imply it.
 * @module cli/gate-report-drift-section
 */
import type {
  DeclarationDriftReport,
  DriftVerdict,
} from "../core/gate-declaration-drift.js";
import { escapeHtml } from "./gate-report-html.js";
import type { Finding, GateReport } from "./gate-report-types.js";

/** How each verdict is headed, in the operator's words. */
const VERDICT_HEADINGS: Readonly<Record<DriftVerdict, string>> = {
  matched: "Declared required, and enforced",
  "declared-not-enforced": "Declared required — enforced by nothing",
  "enforced-declared-optional": "Enforced, declared optional",
  "enforced-declared-off": "Enforced, declared OFF",
  "enforced-undeclared": "Enforced, governed by no declaration",
  "enforced-not-lisa-owned": "Enforced, produced by no Lisa gate",
  "enforced-context-retired":
    "Enforced, and NOTHING WILL EVER POST IT — Lisa renamed the job",
};

/** Which verdicts are drawn as sharp rather than neutral. */
const SHARP_VERDICTS: ReadonlySet<DriftVerdict> = new Set<DriftVerdict>([
  "declared-not-enforced",
  "enforced-declared-off",
  "enforced-context-retired",
]);

/** The verdicts, in the order an operator should read them. */
const VERDICT_ORDER: readonly DriftVerdict[] = [
  // First, ahead of every contradiction. A retired context does not fail a
  // pull request, it holds one at "Expected" forever, so it is the only
  // verdict here that can be blocking an entire repository right now.
  "enforced-context-retired",
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
        `<li><code>${escapeHtml(entry.context)}</code><div class="lgr-why">${escapeHtml(entry.detail)}</div><div class="lgr-why">remedy: <strong>${escapeHtml(entry.remedy)}</strong></div></li>`
    )
    .join("");
  return `<div${SHARP_VERDICTS.has(verdict) ? ' class="lgr-sharp"' : ""}><h3>${escapeHtml(VERDICT_HEADINGS[verdict])} <span class="lgr-count">${entries.length}</span></h3><ul>${items}</ul></div>`;
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
    return `<h3 class="lgr-surface">${escapeHtml(title)}</h3><p class="lgr-note">Not compared this run — <strong>${escapeHtml(finding.reason)}</strong>. ${escapeHtml(finding.message)} This is <em>not</em> a match.</p>`;
  }
  return [
    `<h3 class="lgr-surface">${escapeHtml(title)}</h3>`,
    '<div class="lgr-cols">',
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
