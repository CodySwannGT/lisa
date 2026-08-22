/**
 * The report's HTML primitives.
 *
 * One escaper and one chip vocabulary, shared by every renderer, so a state
 * cannot acquire a second spelling. The rule the chips exist to hold: an
 * `unknown` must never look like a pass, and — the gap that shipped in the
 * first cut — it must never look like nothing either. A caller that omits a
 * chip because it had nothing to show has invented a fourth outcome the
 * three-state design never sanctioned, and silence is the one outcome a reader
 * cannot tell from "fine".
 * @module cli/gate-report-html
 */
import type { Finding } from "./gate-report-types.js";

/** Characters that must not reach the browser as markup. */
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
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    character => ESCAPES[character] ?? character
  );
}

/**
 * One chip.
 * @param variant - The chip's state class
 * @param text - Its label
 * @param title - Hover text explaining it
 * @returns One chip of HTML
 */
export function chip(variant: string, text: string, title = ""): string {
  const attribute = title === "" ? "" : ` title="${escapeHtml(title)}"`;
  return `<span class="lgr-chip lgr-${escapeHtml(variant)}"${attribute}>${escapeHtml(text)}</span>`;
}

/**
 * The chip for a finding this run could not determine.
 *
 * Carries the human message as hover text rather than dropping it: a report
 * that says "not checked here" without saying why is indistinguishable from a
 * bug in the report.
 * @param finding - An unknown or not-applicable finding
 * @param label - What to call it
 * @returns One chip of HTML
 */
export function unknownChip(
  finding: Extract<Finding<unknown>, { reason: string }>,
  label = "not checked here"
): string {
  return chip("unknown", label, finding.message);
}

/**
 * One monospaced fragment.
 * @param value - Raw text
 * @returns The text inside a `code` element, escaped
 */
export function code(value: string): string {
  return `<code>${escapeHtml(value)}</code>`;
}
