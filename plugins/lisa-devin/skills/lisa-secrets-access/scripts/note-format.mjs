/**
 * Validate a credential's usage note against the format the contract documents.
 *
 * The contract states Rule A — "the note must exist and be well-formed",
 * enforced statically by `verify` and by `doctor`. Only half of that was ever
 * true. Both consumers tested the note for emptiness and nothing tested its
 * shape, so a note that promised a scope and delivered a bare colon, or a
 * `tool:` line naming a URL instead of a CLI, passed every check Lisa had. The
 * prose described an enforcement that did not exist, which is worse than no
 * rule: readers stopped checking because they believed something else was.
 *
 * This module is that missing half, and it lives in one place on purpose. The
 * same argument the values file makes for keeping its writer and its parser
 * together applies here: `tools-from-notes.mjs` decides what a `tool:` line
 * *is*, and if this validator held a second copy of that pattern, a note could
 * pass doctor and then be silently ignored at install time with nothing to
 * reveal the disagreement. So the matcher is defined here once and imported
 * there.
 *
 * Messages are written for the person who has to fix the vault, who is often
 * not an engineer. Each one names the secret's defect and the edit that clears
 * it, never only the rule that was broken.
 * @module note-format
 */

/**
 * A `key: value` metadata line.
 *
 * The key must be a single bare lowercase token. That is what separates
 * `scope: read-write` from prose that happens to contain a colon, such as
 * "Attio CRM: system of record for sales" — a sentence has spaces before its
 * colon, and a capitalised word opening a sentence is prose, not a field. The
 * discriminator is deliberately generous: mistaking a field for prose only
 * loosens a check, while mistaking prose for a field would fail a good note.
 */
const FIELD_LINE = /^[ \t]*([a-z][a-z0-9_-]*)[ \t]*:[ \t]*(.*)$/;

/** Matches `tool: name` or `tools: a, b`, case-insensitively, on one line. */
const TOOL_LINE_SINGLE = /^[ \t]*tools?[ \t]*:[ \t]*(.*)$/i;

/**
 * The same matcher, global and multiline, for scanning a whole note.
 *
 * Derived from the single-line pattern rather than written out again, so the
 * two can never disagree about what a tool line is.
 */
export const TOOL_LINE = new RegExp(TOOL_LINE_SINGLE.source, "gim");

/**
 * A bare CLI name: what a `tool:` entry is permitted to be.
 *
 * Names are matched against Lisa's catalogue and never executed, so this is not
 * the security boundary — the catalogue is. It is the check that tells an
 * operator their entry will be silently dropped, which is the failure mode
 * worth catching: a note asking for `sonar (for CI)` installs nothing, and the
 * session fails much later for a reason that looks unrelated.
 */
const TOOL_NAME = /^[a-z0-9][a-z0-9._+-]*$/;

/**
 * Whether a line is structured metadata rather than a sentence.
 * @param {string} line One line of a note.
 * @returns {boolean} True when the line is a field or a tool line.
 */
function isMetadataLine(line) {
  return FIELD_LINE.test(line) || TOOL_LINE_SINGLE.test(line);
}

/**
 * Check the entries on one `tool:` / `tools:` line.
 * @param {string} value The text after the colon.
 * @param {object[]} defects Collector to append to.
 */
function checkToolLine(value, defects) {
  if (!value.trim()) {
    defects.push({
      level: "error",
      code: "empty-tool-line",
      message:
        "has a `tool:` line that names no tool. Either name the command-line " +
        "tool this credential is for (for example `tool: sonar`) or delete " +
        "the line — as written it asks for a tool and supplies none, so " +
        "nothing gets installed",
    });
    return;
  }

  for (const raw of value.split(",")) {
    const entry = raw.trim();
    if (!entry) {
      // A trailing or doubled comma is sloppy punctuation, not a broken note:
      // the reader drops the empty entry and installs the rest correctly.
      // Blocking a vault over a comma would teach operators the check is noise.
      defects.push({
        level: "warn",
        code: "stray-separator",
        message:
          "has a `tool:` line with a stray comma. Nothing breaks, but tidy it " +
          "so the list reads as the tools it actually names",
      });
      continue;
    }
    if (!TOOL_NAME.test(entry.toLowerCase())) {
      defects.push({
        level: "error",
        code: "bad-tool-name",
        message:
          `has a \`tool:\` entry that is not a tool name: "${entry}". Each ` +
          "entry must be one plain name such as `sonar` or `gh`, separated by " +
          "commas — no descriptions, links, versions, or punctuation. As " +
          "written this entry is ignored, so the tool never gets installed",
      });
    }
  }
}

/**
 * Report every way a usage note departs from the documented format.
 *
 * Returns defects rather than throwing so a caller can list a whole vault's
 * problems in one pass. An operator fixing a vault wants every edit at once,
 * not one error per run.
 * @param {unknown} note The note text stored beside the secret.
 * @returns {{level: string, code: string, message: string}[]} Defects found.
 */
export function validateNote(note) {
  if (typeof note !== "string" || !note.trim()) {
    // One cause, one instruction. Also accusing an absent note of lacking a
    // first line would leave the operator guessing which fix comes first.
    return [
      {
        level: "error",
        code: "missing-note",
        message:
          "has no usage note. Write one in the secret's own description field " +
          "in the vault: a first line saying what this credential is for and " +
          "what it can reach, then `key: value` lines such as `scope:`, " +
          "`owner:`, and `tool:`. Guessing a credential's purpose from its " +
          "name is exactly the guess that writes to the wrong system",
      },
    ];
  }

  const defects = [];
  const lines = note.split(/\r?\n/);
  const populated = lines.filter(line => line.trim());

  if (!populated.some(line => !isMetadataLine(line))) {
    defects.push({
      level: "error",
      code: "no-prose",
      message:
        "has no plain-language first line. Add a sentence at the top saying " +
        "what this credential is for and what it can reach — the `key: value` " +
        "lines below it list details, but they never say what the thing is",
    });
  }

  for (const line of populated) {
    const tool = TOOL_LINE_SINGLE.exec(line);
    if (tool) {
      checkToolLine(tool[1], defects);
      continue;
    }
    const field = FIELD_LINE.exec(line);
    if (field && !field[2].trim()) {
      defects.push({
        level: "error",
        code: "empty-field",
        message:
          `has an empty \`${field[1]}:\` line. Either fill in the value or ` +
          "delete the line — a field with nothing after the colon promises a " +
          "fact the reader then cannot find anywhere",
      });
    }
  }

  return defects;
}
