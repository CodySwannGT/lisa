// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Find private-key boundaries without making the regex traverse their body. */
const BOUNDARY =
  /-----BEGIN (?:[A-Z ]*PRIVATE KEY-----)?|-----END [A-Z ]*PRIVATE KEY-----/gu;
const BEGIN = "-----BEGIN ";
const PLACEHOLDER = "[REDACTED:PRIVATE_KEY]";
const KEY_PAYLOAD = /^[A-Za-z0-9+/]+={0,2}$/u;
const KEY_METADATA = /^(?:Proc-Type|DEK-Info):[ \t]*[\w,-]+$/u;

/**
 * Consume PEM body lines still present when output was cut before the footer.
 * @param {string} text Captured output.
 * @param {number} start First character after the opening boundary.
 * @returns {number} The end of the visible key material, or the given start.
 */
function unterminatedKeyEnd(text, start) {
  const rows = /(?:\r\n|\r|\n)([^\r\n]*)/y;
  rows.lastIndex = start;
  let end = start;
  for (let row = rows.exec(text); row !== null; row = rows.exec(text)) {
    const line = row[1].trim();
    if (line === "") continue;
    if (!KEY_PAYLOAD.test(line) && !KEY_METADATA.test(line)) break;
    end = rows.lastIndex;
  }
  return end;
}

/**
 * Replace each key up to the first closing line or the next block.
 * When the footer is missing, consume the visible PEM body before any prose.
 * @param {string} text Text which may contain key material.
 * @returns {string} Text with private keys replaced.
 */
export function redactPrivateKeyBlocks(text) {
  /** @type {string[]} */
  const output = [];
  /** @type {{ start: number, body: number } | null} */
  let key = null;
  let offset = 0;
  for (const match of text.matchAll(BOUNDARY)) {
    const first = match[0].startsWith(BEGIN);
    const end = match.index + match[0].length;
    if (key !== null && (first || match.index > key.body)) {
      output.push(text.slice(offset, key.start), PLACEHOLDER);
      offset = first ? unterminatedKeyEnd(text, key.body) : end;
      key = null;
    }
    if (first && match[0].length > BEGIN.length)
      key = { start: match.index, body: end };
  }
  if (key !== null) {
    output.push(text.slice(offset, key.start), PLACEHOLDER);
    offset = unterminatedKeyEnd(text, key.body);
  }
  return output.length === 0 ? text : output.join("") + text.slice(offset);
}
