/**
 * Text typed on any line of a question but its answer line is refused, with
 * the line number, and never dropped without a word.
 *
 * Only the answer line is read, and the next passing check writes every other
 * line of a question again from the record. So what a person typed on the
 * question, on a candidate, on the status, or on a bullet they added under
 * the candidates used to be ignored and then erased. Each entry now carries
 * one comment line holding a mark for each line Lisa wrote, and a line whose
 * mark is not there is refused the way every other stray line already was
 * (CodySwannGT/lisa#4978).
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { parseQuestionBlock } from "../../../src/controls/audit-inline-answers.js";
import {
  ENTRY_MARKS_START,
  entryMarksLine,
  entryMarksOf,
  lineMark,
} from "../../../src/controls/audit-question-lines.js";
import { renderGapsQuestionBlock } from "../../../src/controls/audit-questions-markdown.js";
import { validateAuditReport } from "../../../src/controls/audit-report.js";
import { completeAuditReport } from "../../helpers/control-audit-report.js";
import { context, CRITERIA } from "./audit-report-facts.js";
import {
  changed,
  document,
  entry,
  FILE,
  LINE,
  read,
} from "./support/question-block.js";

const TRACKER = "tracker";
const GAPS = "wiki/gaps.md";
const STATUS_OPEN_LINE = "- **Status**: open";

const TRACKER_HEADING = "### tracker";

/** How the id of the tracker question stands on the comment line. */
const ID_ON_LINE = "id=tracker";

/**
 * What the reader says about one line that is not as Lisa wrote it.
 * @param line - The line's number
 * @param file - The file it is in
 * @returns The sentence, up to the way out
 */
function refused(line: number, file = FILE): string {
  return `${file} line ${line} is not as Lisa wrote it: it was typed on, or added. Only the answer line is read, so what is typed there would be lost. Type the answer on the line that starts "- **Answer**:", and leave every other line as it was.`;
}

/**
 * The mark of a line, worked out here and not by the code under test.
 * @param line - The line, which opens with no bullet but `-`
 * @returns The first eight characters of the SHA-256 digest of the line
 *   without the characters a formatter adds or swaps (`\`, `*`, `_` and the
 *   backtick) and with its white space evened out
 */
function markOf(line: string): string {
  return createHash("sha256")
    .update(
      line
        .replaceAll(/[\\*_`]/gu, "")
        .replaceAll(/\s+/gu, " ")
        .trim()
    )
    .digest("hex")
    .slice(0, 8);
}

describe("the comment line under a question", () => {
  it("holds the question's id, then one mark for each line of the entry but the blank ones and the answer line", () => {
    const [heading, , question, candidates, candidate, , status, marks] =
      entry(TRACKER);

    expect(marks).toBe(
      `${ENTRY_MARKS_START} ${ID_ON_LINE} ${[
        heading,
        question,
        candidates,
        candidate,
        status,
      ]
        .map(line => markOf(line ?? ""))
        .join(" ")} -->`
    );
  });

  it("writes an id as one word that cannot close the comment, and reads it back whole", () => {
    const id = "AC1.1@my app/__generated__/a*b/50%/-->/é";
    const line = entryMarksLine([`### ${id}`, STATUS_OPEN_LINE]);

    expect(line).toContain(
      " id=AC1.1@my%20app/__generated__/a*b/50%25/--%3E/%C3%A9 "
    );
    expect(entryMarksOf(line)?.id).toBe(id);
  });

  it("gives a line the same mark however it is spaced, and another when a word changes", () => {
    expect(lineMark("  - Jira.   Found: two commits")).toBe(
      markOf("- Jira. Found: two commits")
    );
    expect(lineMark("- Jira. Found: two commits!")).not.toBe(
      markOf("- Jira. Found: two commits")
    );
  });

  it("is the same whatever the answer line holds, because that line is the person's", () => {
    expect(entry(TRACKER, " Jira").at(-1)).toBe(entry(TRACKER).at(-1));
  });

  it("reads back as the id and the marks it was written with, and as nothing when it is damaged", () => {
    const line = entryMarksLine([TRACKER_HEADING, STATUS_OPEN_LINE]);

    expect(entryMarksOf(line)).toEqual({
      id: TRACKER,
      marks: [markOf(TRACKER_HEADING), markOf(STATUS_OPEN_LINE)],
    });
    expect(entryMarksOf(line.replace("-->", "Jira -->"))).toBeNull();
    expect(entryMarksOf(STATUS_OPEN_LINE)).toBeNull();
  });

  it.each([
    { name: "none", id: "id=" },
    { name: "one that is not in the written form", id: "id=%zz" },
    {
      name: "one holding a character Lisa would have written out",
      id: "id=my<app",
    },
    { name: "one written out where Lisa would not have", id: "id=%74racker" },
    { name: "no label", id: TRACKER },
  ])("reads as nothing when the id on it is $name", ({ id }) => {
    const line = entryMarksLine([TRACKER_HEADING, STATUS_OPEN_LINE]);

    expect(line).toContain(` ${ID_ON_LINE} `);
    expect(entryMarksOf(line.replace(ID_ON_LINE, id))).toBeNull();
  });

  it("is written under every question Lisa renders", () => {
    const { report } = validateAuditReport(completeAuditReport(), context());
    const lines =
      report === null ? [] : renderGapsQuestionBlock(report, CRITERIA);
    const status = lines.indexOf(STATUS_OPEN_LINE);

    expect(status).toBeGreaterThan(0);
    expect(entryMarksOf(lines[status + 1] ?? "")?.marks).toHaveLength(5);
    expect(
      parseQuestionBlock(lines.join("\n"), GAPS, { lisaRendered: false })
        .problems
    ).toEqual([]);
  });
});

describe("text typed on another line of a question", () => {
  it.each([
    {
      name: "on a candidate",
      line: LINE.candidate,
      change: (text: string) => [`${text} <- this one, yes`],
    },
    {
      name: "in place of a candidate",
      line: LINE.candidate,
      change: () => ["  - We use Jira"],
    },
    {
      name: "on the question",
      line: LINE.question,
      change: (text: string) => [`${text} Jira.`],
    },
    {
      name: "on the status",
      line: LINE.status,
      change: (text: string) => [`${text}, it is Jira`],
    },
    {
      name: "over the status, to show the question as answered",
      line: LINE.status,
      change: () => ["- **Status**: absorbed"],
    },
    {
      name: "over the heading, to make it another question",
      line: LINE.heading,
      change: () => ["### hosting-platform"],
    },
  ])(
    "is refused, with its line named, when typed $name",
    ({ line, change }) => {
      const block = read(changed(line, change));

      expect(block.entries).toEqual([]);
      expect(block.problems).toEqual([expect.stringContaining(refused(line))]);
    }
  );

  it("is refused when typed as a new bullet under the candidates", () => {
    const block = read(
      changed(LINE.candidate, text => [text, "  - We use Jira"])
    );

    expect(block.entries).toEqual([]);
    expect(block.problems).toEqual([
      expect.stringContaining(refused(LINE.candidate + 1)),
    ]);
  });

  it("names every such line, not only the first", () => {
    const block = read(
      document(
        entry(TRACKER).map(text =>
          text.startsWith("- **Question**") || text.startsWith("- **Status**")
            ? `${text} Jira`
            : text
        )
      )
    );

    expect(block.problems).toEqual([
      expect.stringContaining(refused(LINE.question)),
      expect.stringContaining(refused(LINE.status)),
    ]);
  });

  it("says how to start the question over when a line cannot be put back", () => {
    const [problem] = read(
      changed(LINE.question, text => [`${text} Jira.`])
    ).problems;

    expect(problem).toBe(
      `${refused(LINE.question)} If the line cannot be put back, delete the whole question, from its "###" line to the comment line under its Status line, and run the audit again: Lisa writes the question again.`
    );
  });

  it("is refused in the wiki's gaps file as well", () => {
    const text = changed(LINE.question, line => [`${line} Jira.`]);

    expect(
      parseQuestionBlock(text, GAPS, { lisaRendered: false }).problems
    ).toEqual([expect.stringContaining(refused(LINE.question, GAPS))]);
  });
});

describe("a question that lost a line Lisa wrote", () => {
  it("is refused when a candidate is gone", () => {
    const block = read(changed(LINE.candidate, () => []));

    expect(block.entries).toEqual([]);
    expect(block.problems).toEqual([
      expect.stringContaining(
        `${FILE}: The question "tracker", which starts on line 7, has lost a line Lisa wrote.`
      ),
    ]);
  });

  it("is refused when its comment line of marks is gone, because nothing could then be noticed", () => {
    const block = read(changed(LINE.marks, () => []));

    expect(block.entries).toEqual([]);
    expect(block.problems).toEqual([
      expect.stringContaining(
        `The question "tracker", which starts on line 7, has lost the comment line that starts "${ENTRY_MARKS_START}"`
      ),
    ]);
  });

  it("is refused when its comment line of marks is there twice", () => {
    const block = read(changed(LINE.marks, text => [text, text]));

    expect(block.problems).toEqual([
      expect.stringContaining(
        `line ${LINE.marks + 1} is a second comment line of marks`
      ),
    ]);
  });
});

describe("what is not a change", () => {
  it("is a line that was only indented again", () => {
    const block = read(
      changed(LINE.candidate, text => [`    ${text.trim()}  `])
    );

    expect(block.problems).toEqual([]);
    expect(block.entries.map(found => found.id)).toEqual([TRACKER]);
  });

  it("is an answer, typed on the one line a person types on", () => {
    const block = read(document(entry(TRACKER, " Jira, the OPS board")));

    expect(block.problems).toEqual([]);
    expect(block.entries.map(found => found.answer)).toEqual([
      "Jira, the OPS board",
    ]);
  });
});
