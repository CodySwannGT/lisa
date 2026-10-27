/** Bounded top-level boundaries; examples cannot become runtime declarations. */
import { requireProof } from "./completion-proof-errors.mjs";

/** Retain original offsets while excluding fenced/indented examples and comments. */
export function topLevelLines(body) {
  const rows = [];
  let fence = null;
  let comment = false;
  let start = 0;
  for (const raw of body.split("\n")) {
    const end = start + raw.length + (start + raw.length < body.length ? 1 : 0);
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
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

/** Only actual top-level H2 sections participate in native declarations. */
export function markdownSection(body, heading) {
  const headings = topLevelLines(body).filter(row => row.heading);
  const matches = headings.filter(row => row.text === `## ${heading}`);
  requireProof(
    matches.length <= 1,
    `Duplicate ${heading} sections make completion requirements ambiguous.`
  );
  if (!matches.length) return "";
  const selected = matches[0];
  const next = headings.find(row => row.start > selected.start);
  return body.slice(selected.end, next?.start ?? body.length).trim();
}
