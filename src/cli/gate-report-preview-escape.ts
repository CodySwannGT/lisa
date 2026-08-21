/**
 * The one escaper both halves of the preview render through.
 *
 * Extracted rather than copied. Two escapers is one escaper and one hole, and
 * the hole is always in the half nobody thought of as rendering untrusted text
 * — which here is the drift section, whose contexts and gate ids come straight
 * out of a settings file.
 * @module cli/gate-report-preview-escape
 */
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
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    character => ESCAPES[character] ?? character
  );
}
