/**
 * What stands in for an answer is never read as one.
 *
 * An answer line holds a hint until a person types over it. The hint used to
 * be recognised in one spelling only, so an editor that rewrote its emphasis
 * marks turned it into a recorded answer; and "TBD", "?" or "n/a" on an
 * answer line were recorded as what the person said. A person's answer can
 * settle a requirement only a person may vouch for, so none of these counts:
 * the line holds no answer, and the question stays open
 * (CodySwannGT/lisa#4978).
 */
import { describe, expect, it } from "vitest";

import {
  ANSWER_PLACEHOLDER,
  isInlineAnswer,
  isPlaceholderAnswer,
  normaliseInlineAnswer,
} from "../../../src/controls/audit-questions-format.js";
import { document, entry, read } from "./support/question-block.js";

const TRACKER = "tracker";

/** What an answer line may hold without holding an answer. */
const NOT_ANSWERS = [
  { name: "the hint between asterisks", typed: "*(human fills in)*" },
  { name: "the hint in bold", typed: "**(human fills in)**" },
  {
    name: "the hint with its underscores escaped",
    typed: String.raw`\_(human fills in)\_`,
  },
  { name: "the hint in capitals", typed: "_(Human Fills In)_" },
  { name: "the hint with no marks around it", typed: "(human fills in)" },
  { name: "the hint with one mark lost", typed: "_(human fills in)" },
  {
    name: "the hint written twice",
    typed: `${ANSWER_PLACEHOLDER} *(human fills in)*`,
  },
  { name: "TBD", typed: "TBD" },
  { name: "tbd with a full stop, in emphasis", typed: "_tbd._" },
  { name: "a question mark", typed: "?" },
  { name: "several question marks", typed: "???" },
  { name: "n/a", typed: "n/a" },
  { name: "N/A in brackets", typed: "(N/A)" },
  { name: "a dash", typed: "-" },
  { name: "todo", typed: "TODO" },
] as const;

/** What is an answer, though it sits beside the hint or uses its words. */
const ANSWERS = [
  {
    name: "typed after the hint in another spelling",
    typed: "*(human fills in)* Jira",
    answer: "Jira",
  },
  {
    name: "typed before the hint in another spelling",
    typed: String.raw`Jira \_(human fills in)\_`,
    answer: "Jira",
  },
  {
    name: "in emphasis of its own, right beside the hint",
    typed: `${ANSWER_PLACEHOLDER}**Jira**`,
    answer: "**Jira**",
  },
  {
    name: "as a sentence that uses a placeholder word",
    typed: "TBD by the platform lead in March",
    answer: "TBD by the platform lead in March",
  },
  {
    name: "as a sentence that ends in brackets of its own",
    typed: "The release form (human fills in)",
    answer: "The release form (human fills in)",
  },
  { name: "as a number", typed: "42", answer: "42" },
] as const;

describe("an answer line that holds only a placeholder", () => {
  it.each(NOT_ANSWERS)("is not an answer when it holds $name", ({ typed }) => {
    const block = read(document(entry(TRACKER, ` ${typed}`)));

    expect(block.problems).toEqual([]);
    expect(block.entries.map(found => found.answer)).toEqual([null]);
  });

  it.each(ANSWERS)("still reads an answer $name", ({ typed, answer }) => {
    const block = read(document(entry(TRACKER, ` ${typed}`)));

    expect(block.problems).toEqual([]);
    expect(block.entries.map(found => found.answer)).toEqual([answer]);
  });
});

describe("an answer as the record may hold it", () => {
  it.each(NOT_ANSWERS)("is never $name", ({ typed }) => {
    expect(normaliseInlineAnswer(typed)).toBe("");
    expect(isInlineAnswer(typed)).toBe(false);
  });

  it.each(ANSWERS)("may be what was $name", ({ answer }) => {
    expect(isInlineAnswer(answer)).toBe(true);
  });

  it("tells a placeholder from words that only contain one", () => {
    expect(isPlaceholderAnswer("n/a")).toBe(true);
    expect(
      isPlaceholderAnswer("n/a for the library, see the release notes")
    ).toBe(false);
  });
});
