/**
 * Reading what a person typed on the answer lines of a rendered report.
 *
 * The reader is strict because what it reads becomes a recorded fact. An
 * answer counts only on the answer line of a question, inside the marked
 * block. An untouched or empty line is not an answer. Text anywhere else is
 * never taken for one, and a block that is not in the written form is refused
 * with the line named, never skipped (CodySwannGT/lisa#4980).
 */
import { describe, expect, it } from "vitest";

import { parseQuestionBlock } from "../../../src/controls/audit-inline-answers.js";
import {
  ANSWER_PLACEHOLDER,
  QUESTIONS_END,
  QUESTIONS_START,
} from "../../../src/controls/audit-questions-format.js";

const FILE = ".lisa/audit/report.md";

/**
 * One question entry in the written form.
 * @param id - The question's id
 * @param answer - What stands after the answer label
 * @returns The entry's lines
 */
function entry(id: string, answer = ` ${ANSWER_PLACEHOLDER}`): string[] {
  return [
    `### ${id}`,
    "",
    "- **Question**: Which tracker does the team plan its work in?",
    "- **Candidates**:",
    "  - GitHub Issues (found: the remote named origin is on github.com)",
    `- **Answer**:${answer}`,
    "- **Status**: open",
  ];
}

/**
 * A document holding one marked block.
 * @param inside - The lines between the markers
 * @param around - Lines before and after the block
 * @param around.before - Lines before the start marker
 * @param around.after - Lines after the end marker
 * @returns The document
 */
function document(
  inside: readonly string[],
  around: { before?: readonly string[]; after?: readonly string[] } = {}
): string {
  return [
    ...(around.before ?? ["# Audit report", ""]),
    QUESTIONS_START,
    "",
    "## Open questions",
    "",
    ...inside,
    "",
    QUESTIONS_END,
    ...(around.after ?? []),
    "",
  ].join("\n");
}

/**
 * Read a document the way the report's own file is read.
 * @param text - The document
 * @returns What the reader found
 */
function read(text: string): ReturnType<typeof parseQuestionBlock> {
  return parseQuestionBlock(text, FILE, { lisaRendered: true });
}

describe("an answer line", () => {
  it.each([
    { name: "left as written", answer: ` ${ANSWER_PLACEHOLDER}` },
    { name: "emptied", answer: "" },
    { name: "holding only spaces", answer: "   " },
  ])("is not an answer when $name", ({ answer }) => {
    const block = read(document(entry("tracker", answer)));

    expect(block.problems).toEqual([]);
    expect(block.entries).toEqual([
      {
        id: "tracker",
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
    const block = read(document(entry("tracker", typed)));

    expect(block.problems).toEqual([]);
    expect(block.entries.map(found => found.answer)).toEqual([answer]);
  });

  it("is told apart, when empty, by whether its question was shown as answered", () => {
    const answered = entry("tracker", "").map(line =>
      line === "- **Status**: open" ? "- **Status**: absorbed" : line
    );

    expect(read(document(answered)).entries).toMatchObject([
      { answer: null, answered: true },
    ]);
  });

  it("is read for every question of the block, each on its own line", () => {
    const block = read(
      document([...entry("tracker", " Jira"), "", ...entry("AC1.7@.")])
    );

    expect(block.entries.map(found => [found.id, found.answer])).toEqual([
      ["tracker", "Jira"],
      ["AC1.7@.", null],
    ]);
    expect(block.entries.map(found => found.line)).toEqual([12, 20]);
  });
});

describe("text that is not on an answer line", () => {
  it("is refused, with its line named, when typed under the answer line", () => {
    const lines = entry("tracker");
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
      document([...entry("tracker"), "We use Jira.", ...entry("AC1.7@.")])
    );

    expect(block.problems).toEqual([expect.stringContaining("line 14 ")]);
  });

  it("is refused when typed as a bullet under the answer line", () => {
    const lines = entry("tracker");
    const block = read(
      document([...lines.slice(0, 6), "  - Jira", ...lines.slice(6)])
    );

    expect(block.problems).toEqual([expect.stringContaining("line 13 ")]);
  });

  it("is never read as an answer outside the marked block", () => {
    const block = read(
      document(entry("tracker"), {
        after: ["", "## Whole repository", "", "The tracker is Jira."],
      })
    );

    expect(block.problems).toEqual([]);
    expect(block.entries.map(found => found.answer)).toEqual([null]);
  });

  it("is refused when an answer line sits outside the block of a rendered report", () => {
    const block = read(
      document(entry("tracker"), { after: ["", "- **Answer**: Jira"] })
    );

    expect(block.problems).toEqual([
      expect.stringMatching(/line 17 is an answer line outside the questions/u),
    ]);
  });

  it("is left alone outside the block of a file Lisa shares with others", () => {
    const text = document(entry("tracker"), {
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
      text: ["# Audit report", QUESTIONS_START, ...entry("tracker")].join("\n"),
      says: /line 2 opens the questions block, but nothing closes it/u,
    },
    {
      name: "an end marker with no start",
      text: [...entry("tracker"), QUESTIONS_END].join("\n"),
      says: /line 8 closes a questions block that was never opened/u,
    },
    {
      name: "a rendered report whose markers were both deleted",
      text: entry("tracker", " Jira").join("\n"),
      says: /line 6 is an answer line outside the questions block/u,
    },
    {
      name: "a second block",
      text: `${document(entry("tracker"))}${document(entry("AC1.7@."), { before: [] })}`,
      says: /line 16 opens a second questions block/u,
    },
    {
      name: "a question with no answer line",
      text: document(entry("tracker").filter(line => !line.includes("Answer"))),
      says: /The question "tracker", which starts on line 7, has no answer line/u,
    },
    {
      name: "a question with two answer lines",
      text: document([...entry("tracker", " Jira"), "- **Answer**: Linear"]),
      says: /line 14 is a second answer line for the question "tracker"/u,
    },
    {
      name: "a question with no question line",
      text: document(
        entry("tracker").filter(line => !line.includes("Question"))
      ),
      says: /The question "tracker", which starts on line 7, has no question line/u,
    },
    {
      name: "a label Lisa does not write",
      text: document([...entry("tracker"), "- **Note**: ask Sam"]),
      says: /line 14 has the label "Note", which is not part of a question/u,
    },
    {
      name: "a heading that is not a question's id",
      text: document(entry("Which tracker")),
      says: /line 7: "Which tracker" is not the id of a question/u,
    },
    {
      name: "the same question twice",
      text: document([...entry("tracker"), "", ...entry("tracker")]),
      says: /line 15 repeats the question "tracker"/u,
    },
    {
      name: "a field before any question",
      text: document(["- **Answer**: Jira", ...entry("tracker")]),
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
    expect(read(document(entry("tracker"))).region).toEqual({
      start: 2,
      end: 14,
    });
  });
});
