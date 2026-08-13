/**
 * Contract tests for usage-note well-formedness.
 *
 * The contract has always claimed Rule A — "the note must exist and be
 * well-formed", enforced statically by `verify` and by `doctor`. Only the first
 * half of that was ever true: the code tested `note.trim()` for emptiness and
 * reported a warning. Nothing validated the format, so a note that promised a
 * scope and delivered a bare colon, or a `tool:` line naming a URL instead of a
 * CLI, passed every check Lisa had.
 *
 * These tests pin the grammar the contract documents — first line prose, then
 * `key: value` lines, with `tool:`/`tools:` naming bare CLI names — so prose and
 * enforcement say the same thing.
 * @module tests/unit/secrets/note-format
 */
import { describe, expect, it } from "vitest";

import {
  TOOL_LINE,
  validateNote,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/note-format.mjs";

/**
 * Codes of the blocking defects a note produced, in report order.
 * @param note Note text to validate.
 * @returns The error-level codes.
 */
const errorCodes = (note: string | undefined | null): string[] =>
  validateNote(note)
    .filter(d => d.level === "error")
    .map(d => d.code);

/**
 * Codes of the non-blocking defects a note produced, in report order.
 * @param note Note text to validate.
 * @returns The warn-level codes.
 */
const warnCodes = (note: string | undefined | null): string[] =>
  validateNote(note)
    .filter(d => d.level === "warn")
    .map(d => d.code);

const MISSING_NOTE = "missing-note";
const BAD_TOOL_NAME = "bad-tool-name";
const EMPTY_FIELD = "empty-field";
const PROSE = "Purpose statement.";

const WELL_FORMED = [
  "Attio CRM - system of record for the sales funnel.",
  "scope: object_configuration, record, list_entry - read-write",
  "owner: platform-team",
  "ci: yes - injected by the release workflow",
  "docs: wiki/integrations/attio.md",
].join("\n");

describe("a note that is absent", () => {
  it("reports a blocking defect when the note is undefined", () => {
    expect(errorCodes(undefined)).toEqual([MISSING_NOTE]);
  });

  it("reports a blocking defect when the note is null", () => {
    expect(errorCodes(null)).toEqual([MISSING_NOTE]);
  });

  it("reports a blocking defect when the note is the empty string", () => {
    expect(errorCodes("")).toEqual([MISSING_NOTE]);
  });

  it("reports a blocking defect when the note is only whitespace", () => {
    // A note of spaces and newlines reads as present to a truthiness check,
    // which is exactly how an empty note survived the old presence test.
    expect(errorCodes("   \n\t  \n")).toEqual([MISSING_NOTE]);
  });

  it("reports a blocking defect when the note is not a string at all", () => {
    expect(errorCodes(42 as unknown as string)).toEqual([MISSING_NOTE]);
  });

  it("tells the operator what a note is for rather than only that it is absent", () => {
    const [defect] = validateNote("");
    expect(defect.message).toMatch(/what this credential is for/i);
  });

  it("raises exactly one defect for an absent note", () => {
    // An absent note should not also be accused of lacking a prose line; one
    // cause, one instruction, or the operator cannot tell what to fix first.
    expect(validateNote("")).toHaveLength(1);
  });
});

describe("a note in the documented shape", () => {
  it("accepts the format the contract documents", () => {
    expect(validateNote(WELL_FORMED)).toEqual([]);
  });

  it("accepts a note that is prose alone", () => {
    // The documented shape is prose *then* metadata lines. A note carrying only
    // the prose still answers the question the note exists to answer.
    expect(validateNote("Attio CRM - system of record for sales.")).toEqual([]);
  });

  it("accepts prose that happens to contain a colon", () => {
    // "Attio CRM: system of record" is prose, not a `key: value` line. The
    // discriminator is whether the text before the colon is a single bare
    // token; anything with a space in it is a sentence.
    expect(validateNote("Attio CRM: system of record for sales.")).toEqual([]);
  });

  it("accepts blank lines between the prose and the metadata", () => {
    expect(validateNote(`${PROSE}\n\nowner: platform-team`)).toEqual([]);
  });

  it("accepts leading blank lines before the prose", () => {
    expect(validateNote(`\n\n${PROSE}\nowner: someone`)).toEqual([]);
  });

  it("accepts further prose after the metadata lines", () => {
    // Free text is not a defect. Over-tightening here would fail good notes and
    // teach operators that the check is noise.
    expect(
      validateNote(`${PROSE}\nowner: someone\nRotate this before an audit.`)
    ).toEqual([]);
  });
});

describe("a note with no plain-language purpose", () => {
  it("blocks a note whose first line is a metadata line", () => {
    // Without a prose line an agent has fields but no statement of what the
    // credential is for, which is the one thing the note exists to supply.
    expect(errorCodes("owner: platform-team\nscope: read")).toEqual([
      "no-prose",
    ]);
  });

  it("names the fix rather than only the fault", () => {
    const [defect] = validateNote("owner: platform-team");
    expect(defect.message).toMatch(/first line/i);
  });

  it("blocks a note that is only a tool line", () => {
    expect(errorCodes("tool: sonar")).toEqual(["no-prose"]);
  });
});

describe("a metadata line that promises a fact and delivers none", () => {
  it("blocks a field with an empty value", () => {
    expect(errorCodes(`${PROSE}\nscope:`)).toEqual([EMPTY_FIELD]);
  });

  it("blocks a field whose value is only whitespace", () => {
    expect(errorCodes(`${PROSE}\nowner:   \t  `)).toEqual([EMPTY_FIELD]);
  });

  it("names the offending field so the operator knows which line to edit", () => {
    const [defect] = validateNote(`${PROSE}\nscope:`);
    expect(defect.message).toContain("scope");
  });

  it("reports every empty field, not just the first", () => {
    expect(errorCodes(`${PROSE}\nscope:\nowner:`)).toEqual([
      EMPTY_FIELD,
      EMPTY_FIELD,
    ]);
  });
});

describe("the tool line grammar", () => {
  it("accepts a single tool", () => {
    expect(validateNote("SonarCloud token.\ntool: sonar")).toEqual([]);
  });

  it("accepts a comma-separated list", () => {
    expect(validateNote("A token.\ntools: sonar, gh, aws")).toEqual([]);
  });

  it("accepts the spelling and casing variants the reader already accepts", () => {
    // The validator and the reader must agree on what a tool line *is*, or a
    // note passes doctor and is then ignored at install time.
    expect(validateNote("A token.\nTOOLS :  Sonar , GH ")).toEqual([]);
  });

  it("accepts a name carrying a dot, plus, or hyphen", () => {
    expect(validateNote("A token.\ntool: sonar-scanner")).toEqual([]);
  });

  it("blocks a tool line that names nothing", () => {
    // The line asks for an install and supplies no name, so setup silently
    // installs nothing and the session fails later for an unrelated-looking
    // reason.
    expect(errorCodes("A token.\ntool:")).toEqual(["empty-tool-line"]);
  });

  it("blocks a tool entry that is not a bare CLI name", () => {
    expect(errorCodes("A token.\ntool: sonar (for CI)")).toEqual([
      BAD_TOOL_NAME,
    ]);
  });

  it("blocks a tool entry that is a URL", () => {
    // A note is remote-influenced input. Lisa never executes these names, but a
    // note asking for a URL is either a mistake or an attempt, and both are
    // worth surfacing rather than silently dropping.
    expect(
      errorCodes("A token.\ntool: https://example.test/install.sh")
    ).toEqual([BAD_TOOL_NAME]);
  });

  it("blocks a tool entry carrying shell metacharacters", () => {
    expect(errorCodes("A token.\ntool: sonar; rm -rf /")).toEqual([
      BAD_TOOL_NAME,
    ]);
  });

  it("reports each malformed entry in a list separately", () => {
    expect(errorCodes("A token.\ntools: sonar, bad name, worse|name")).toEqual([
      BAD_TOOL_NAME,
      BAD_TOOL_NAME,
    ]);
  });

  it("quotes the offending entry so the operator can find it", () => {
    const [defect] = validateNote("A token.\ntool: sonar (for CI)");
    expect(defect.message).toContain("sonar (for CI)");
  });

  it("warns rather than blocks on a stray separator", () => {
    // A trailing comma is sloppy, not broken — the reader drops the empty
    // entry. Blocking on it would fail a vault over punctuation.
    expect(warnCodes("A token.\ntools: sonar,")).toEqual(["stray-separator"]);
    expect(errorCodes("A token.\ntools: sonar,")).toEqual([]);
  });

  it("does not treat an unknown-but-well-formed name as a defect", () => {
    // The contract is explicit: a name Lisa cannot install is a request from a
    // future version, not a broken environment.
    expect(validateNote("A token.\ntool: some-future-cli")).toEqual([]);
  });

  it("checks tool lines on notes that are otherwise fine", () => {
    expect(errorCodes(`${WELL_FORMED}\ntool: bad name`)).toEqual([
      BAD_TOOL_NAME,
    ]);
  });
});

describe("the shared tool-line matcher", () => {
  it("is exported so the validator and the reader cannot drift apart", () => {
    // Same argument as the values-file writer and parser living in one module:
    // two copies of this pattern means a note that validates here and is
    // ignored there, with nothing to reveal the disagreement.
    expect(TOOL_LINE).toBeInstanceOf(RegExp);
    expect(TOOL_LINE.flags).toContain("g");
  });

  it("matches the spellings the documented format uses", () => {
    expect([..."tool: sonar".matchAll(TOOL_LINE)]).toHaveLength(1);
    expect([..."tools: a, b".matchAll(TOOL_LINE)]).toHaveLength(1);
    expect([..."TOOLS: a".matchAll(TOOL_LINE)]).toHaveLength(1);
  });

  it("does not match a field that merely starts with the same letters", () => {
    expect([..."toolchain: a".matchAll(TOOL_LINE)]).toHaveLength(0);
  });
});
