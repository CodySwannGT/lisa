// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Bounded top-level boundaries; examples cannot become runtime declarations. */
import { requireProof } from "./completion-proof-errors.mjs";

/** Scan the same maximal fence run without ambiguous regex partitions. */
function fenceMarker(line) {
  let start = 0;
  while (start < 3 && line[start] === " ") start += 1;
  const character = line[start];
  if (character !== "`" && character !== "~") return null;
  let end = start;
  while (line[end] === character) end += 1;
  if (end - start < 3) return null;
  const suffix = line.slice(end);
  if (/[\r\n\u2028\u2029]/.test(suffix)) return null;
  return [line, line.slice(start, end), suffix];
}

/** Retain original offsets while excluding fenced/indented examples and comments. */
export function topLevelLines(body) {
  const rows = [];
  let fence = null;
  let comment = false;
  let start = 0;
  for (const raw of body.split("\n")) {
    const end = start + raw.length + (start + raw.length < body.length ? 1 : 0);
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const marker = fenceMarker(line);
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence.character &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = null;
    } else if (comment) {
      if (line.includes("-->")) comment = false;
    } else if (marker && !(marker[1][0] === "`" && marker[2].includes("`"))) {
      fence = { character: marker[1][0], length: marker[1].length };
    } else if (/^ {0,3}<!--/.test(line) && !line.includes("-->")) {
      comment = true;
    } else if (!/^ {4}|^\t/.test(line)) {
      rows.push({
        text: line.trim(),
        start,
        end,
        heading: /^ {0,3}##[ \t]+/.test(line),
      });
    }
    start = end;
  }
  return rows;
}

/**
 * Fold an H2 line to the heading text a reader sees: case, runs of internal
 * whitespace and an optional closing `#` sequence do not change it.
 * @param {string} text - Trimmed top-level heading line
 * @returns {string} Comparable heading key
 */
function headingKey(text) {
  return withoutClosingHashes(text.replace(/^##[ \t]+/, ""))
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Drop an ATX closing `#` run with one backward scan. A regex such as
 * `(?:^|[ \t]+)#+$` backtracks super-linearly on long space runs.
 * The run only closes the heading when a space or tab precedes it, or when
 * it is the whole text, so `C#` keeps its hash.
 * @param {string} text - Heading text after the opening `## `
 * @returns {string} Text without its closing sequence
 */
function withoutClosingHashes(text) {
  let start = text.length;
  while (start > 0 && text[start - 1] === "#") start -= 1;
  if (start === text.length) return text;
  if (start === 0 || text[start - 1] === " " || text[start - 1] === "\t")
    return text.slice(0, start);
  return text;
}

/**
 * Find a visible line that names a section but is not its readable H2
 * heading: another heading level, a bold line, or the name with extra text
 * such as `## Acceptance Criteria:`, or a setext heading (the name underlined
 * by `---` or `===`), which renders as a heading but is no section boundary
 * here. A caller that would otherwise read a missing section as empty refuses
 * on it instead of passing trivially (CodySwannGT/lisa#4700). Fenced, indented
 * and commented examples are not visible lines, so they never match.
 * @param {string} body - Markdown document
 * @param {string} heading - Heading text without the `## ` prefix
 * @returns {string | null} The first near-miss line, or null when none exists
 */
export function nearMissHeading(body, heading) {
  const words = heading
    .trim()
    .split(/\s+/)
    .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  // `\b` would never end `__Acceptance criteria__`, since `_` is a word character.
  const name = `${words}(?![A-Za-z0-9])`;
  const marked = new RegExp(`^(?:#{1,6}[ \\t]*|\\*\\*|__)${name}`, "i");
  const plain = new RegExp(`^${name}`, "i");
  const wanted = headingKey(`## ${heading}`);
  const rows = topLevelLines(body);
  const row = rows.find(
    (line, index) =>
      (marked.test(line.text) || setextNamed(rows, index, plain)) &&
      !(line.heading && headingKey(line.text) === wanted)
  );
  return row ? row.text : null;
}

/** A visible line naming the section, directly underlined as a setext heading. */
function setextNamed(rows, index, named) {
  const next = rows[index + 1];
  return Boolean(
    next &&
    next.start === rows[index].end &&
    named.test(rows[index].text) &&
    /^(?:=+|-+)$/.test(next.text)
  );
}

/**
 * Only actual top-level H2 sections participate in native declarations.
 * Machine-owned sections (`## Lisa Usage`, `## Target Backend Environment`)
 * keep an exact match so a recased stray heading never stands in for them.
 * A human-authored section such as `## Acceptance Criteria` passes
 * `{ anyCase: true }`, because a missing heading silently yields an empty
 * section and an empty section can make a check pass trivially
 * (CodySwannGT/lisa#4700). Duplicates are judged by the same comparison.
 * @param {string} body - Markdown document
 * @param {string} heading - Heading text without the `## ` prefix
 * @param {{ anyCase?: boolean }} [options] - Normalised heading comparison
 * @returns {string} Trimmed section body, or "" when the heading is absent
 */
export function markdownSection(body, heading, { anyCase = false } = {}) {
  const headings = topLevelLines(body).filter(row => row.heading);
  const wanted = anyCase ? headingKey(`## ${heading}`) : `## ${heading}`;
  const matches = headings.filter(
    row => (anyCase ? headingKey(row.text) : row.text) === wanted
  );
  requireProof(
    matches.length <= 1,
    `Duplicate ${heading} sections make completion requirements ambiguous.`
  );
  if (!matches.length) return "";
  const selected = matches[0];
  const next = headings.find(row => row.start > selected.start);
  return body.slice(selected.end, next?.start ?? body.length).trim();
}
