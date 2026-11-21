// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Find private-key boundaries without making the regex traverse their body. */
const BOUNDARY =
  /-----BEGIN (?:[A-Z ]*PRIVATE KEY-----)?|-----END [A-Z ]*PRIVATE KEY-----/gu;
const BEGIN = "-----BEGIN ";
const PLACEHOLDER = "[REDACTED:PRIVATE_KEY]";

/**
 * Replace each key up to the first closing line or the next block.
 * A final opening line with no following boundary is redacted on its own.
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
      offset = first ? match.index : end;
      key = null;
    }
    if (first && match[0].length > BEGIN.length)
      key = { start: match.index, body: end };
  }
  if (key !== null) {
    output.push(text.slice(offset, key.start), PLACEHOLDER);
    offset = key.body;
  }
  return output.length === 0 ? text : output.join("") + text.slice(offset);
}
