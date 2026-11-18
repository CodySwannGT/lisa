/**
 * Reading what a person typed on the answer lines of a rendered report.
 *
 * The reader is strict because what it reads becomes a recorded fact. An
 * answer counts only on the answer line of a question, inside the marked
 * block. An untouched or empty line is not an answer. Text anywhere else is
 * never taken for one, and a block that is not in the written form is refused
 * with the line named, never skipped (CodySwannGT/lisa#4980).
 *
 * What stands in for an answer without being one has a suite of its own
 * (`audit-inline-placeholders.test.ts`), as has text typed on another line of
 * a question (`audit-question-lines.test.ts`).
 */
import { describe, expect, it } from "vitest";

import { parseQuestionBlock } from "../../../src/controls/audit-inline-answers.js";
import {
  ANSWER_PLACEHOLDER,
  QUESTIONS_END,
  QUESTIONS_START,
} from "../../../src/controls/audit-questions-format.js";
import { document, entry, FILE, read } from "./support/question-block.js";

const TRACKER = "tracker";

describe("an answer line", () => {
  it.each([
    { name: "left as written", answer: ` ${ANSWER_PLACEHOLDER}` },
    { name: "emptied", answer: "" },
    { name: "holding only spaces", answer: "   " },
  ])("is not an answer when $name", ({ answer }) => {
    const block = read(document(entry(TRACKER, answer)));

    expect(block.problems).toEqual([]);
    expect(block.entries).toEqual([
      {
        id: TRACKER,
        question: "Which tracker does the team plan its work in?",
        answer: null,
        answered: false,
        file: FILE,
        line: 12,
      },
    ]);
  });

  it.each([
    { name: "typed in place of the hint", typed: " Jira", answer: "Jira" },
    {
      name: "typed after the hint",
      typed: ` ${ANSWER_PLACEHOLDER} Jira`,
      answer: "Jira",
    },
    {
      name: "typed before the hint",
      typed: ` Jira ${ANSWER_PLACEHOLDER}`,
      answer: "Jira",
    },
    {
      name: "full of Markdown of its own",
      typed: " **Jira** - the `OPS` board, #4",
      answer: "**Jira** - the `OPS` board, #4",
    },
    { name: "ended with a carriage return", typed: " Jira\r", answer: "Jira" },
  ])("is the answer when $name", ({ typed, answer }) => {
    const block = read(document(entry(TRACKER, typed)));

    expect(block.problems).toEqual([]);
    expect(block.entries.map(found => found.answer)).toEqual([answer]);
  });

  it("is told apart, when empty, by whether its question was shown as answered", () => {
    const answered = entry(TRACKER, "", "absorbed");

    expect(read(document(answered)).entries).toMatchObject([
      { answer: null, answered: true },
    ]);
  });

  it("is read for every question of the block, each on its own line", () => {
    const block = read(
      document([...entry(TRACKER, " Jira"), "", ...entry("AC1.7@.")])
    );

    expect(block.entries.map(found => [found.id, found.answer])).toEqual([
      [TRACKER, "Jira"],
      ["AC1.7@.", null],
    ]);
    expect(block.entries.map(found => found.line)).toEqual([12, 21]);
  });
});

describe("text that is not on an answer line", () => {
  it("is refused, with its line named, when typed under the answer line", () => {
    const lines = entry(TRACKER);
    const block = read(
      document([...lines.slice(0, 6), "Jira", ...lines.slice(6)])
    );

    expect(block.problems).toEqual([
      expect.stringMatching(
        /^\.lisa\/audit\/report\.md line 13 is not part of a question\. Type the answer on the line that starts "- \*\*Answer\*\*:"/u
      ),
    ]);
  });

  it("is refused when typed between two questions", () => {
    const block = read(
      document([...entry(TRACKER), "We use Jira.", ...entry("AC1.7@.")])
    );

    expect(block.problems).toEqual([expect.stringContaining("line 15 ")]);
  });

  it("is refused when typed as a bullet under the answer line", () => {
    const lines = entry(TRACKER);
    const block = read(
      document([...lines.slice(0, 6), "  - Jira", ...lines.slice(6)])
    );

    expect(block.problems).toEqual([expect.stringContaining("line 13 ")]);
  });

  it("is never read as an answer outside the marked block", () => {
    const block = read(
      document(entry(TRACKER), {
        after: ["", "## Whole repository", "", "The tracker is Jira."],
      })
    );

    expect(block.problems).toEqual([]);
    expect(block.entries.map(found => found.answer)).toEqual([null]);
  });

  it("is refused when an answer line sits outside the block of a rendered report", () => {
    const block = read(
      document(entry(TRACKER), { after: ["", "- **Answer**: Jira"] })
    );

    expect(block.problems).toEqual([
      expect.stringMatching(/line 18 is an answer line outside the questions/u),
    ]);
  });

  it("is left alone outside the block of a file Lisa shares with others", () => {
    const text = document(entry(TRACKER), {
      before: ["### some-gap", "- **Answer**: we ship on Fridays", ""],
    });

    expect(
      parseQuestionBlock(text, "wiki/gaps.md", { lisaRendered: false })
    ).toMatchObject({ problems: [], entries: [{ answer: null }] });
  });
});

describe("a block that is not in the written form", () => {
  it.each([
    {
      name: "a start marker with no end",
      text: ["# Audit report", QUESTIONS_START, ...entry(TRACKER)].join("\n"),
      says: /line 2 opens the questions block, but nothing closes it/u,
    },
    {
      name: "an end marker with no start",
      text: [...entry(TRACKER), QUESTIONS_END].join("\n"),
      says: /line 9 closes a questions block that was never opened/u,
    },
    {
      name: "a rendered report whose markers were both deleted",
      text: entry(TRACKER, " Jira").join("\n"),
      says: /line 6 is an answer line outside the questions block/u,
    },
    {
      name: "a second block",
      text: `${document(entry(TRACKER))}${document(entry("AC1.7@."), { before: [] })}`,
      says: /line 17 opens a second questions block/u,
    },
    {
      name: "a question with no answer line",
      text: document(entry(TRACKER).filter(line => !line.includes("Answer"))),
      says: /The question "tracker", which starts on line 7, has no answer line/u,
    },
    {
      name: "a question with two answer lines",
      text: document([...entry(TRACKER, " Jira"), "- **Answer**: Linear"]),
      says: /line 15 is a second answer line for the question "tracker"/u,
    },
    {
      name: "a question with no question line",
      text: document(entry(TRACKER).filter(line => !line.includes("Question"))),
      says: /The question "tracker", which starts on line 7, has no question line/u,
    },
    {
      name: "a label Lisa does not write",
      text: document([...entry(TRACKER), "- **Note**: ask Sam"]),
      says: /line 15 has the label "Note", which is not part of a question/u,
    },
    {
      name: "a heading that is not a question's id",
      text: document(entry("Which tracker")),
      says: /line 7: "Which tracker" is not the id of a question/u,
    },
    {
      name: "the same question twice",
      text: document([...entry(TRACKER), "", ...entry(TRACKER)]),
      says: /line 16 repeats the question "tracker"/u,
    },
    {
      name: "a field before any question",
      text: document(["- **Answer**: Jira", ...entry(TRACKER)]),
      says: /line 7 is not part of a question/u,
    },
  ])("is refused for $name", ({ text, says }) => {
    const block = read(text);

    expect(block.problems.join("\n")).toMatch(says);
    expect(block.problems.join("\n")).toContain(FILE);
  });
});

describe("a document with no questions block", () => {
  it("holds no answers and nothing wrong", () => {
    expect(read("# Audit report\n\n## Summary\n")).toEqual({
      entries: [],
      problems: [],
      region: null,
    });
  });

  it("says where the block is when there is one", () => {
    expect(read(document(entry(TRACKER))).region).toEqual({
      start: 2,
      end: 15,
    });
  });
});
