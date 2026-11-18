/**
 * A Markdown formatter run over a rendered questions block changes nothing
 * the reader cares about.
 *
 * Each question carries a comment line of marks, one for each line Lisa
 * wrote, and a line whose mark is missing is refused as typed on. A formatter
 * rewrites such a line without changing a word of it: Prettier writes `*` as
 * `\*`, `__name__` as `**name**`, `*word*` as `_word_`, `+` and `*` bullets
 * as `-`, and `1)` as `1.`. Every question holding one of those was refused,
 * and the way out the message gave (delete the question and run the audit
 * again) broke again on the next format run. The same rewriting reaches the
 * heading, which is the question's id, so the id is read from the comment
 * line, where a formatter leaves it alone (CodySwannGT/lisa#4978).
 *
 * The block is formatted here by the Prettier this repository installs, with
 * its default settings, which is what was reported.
 */
import { format } from "prettier";
import { describe, expect, it } from "vitest";

import { parseQuestionBlock } from "../../../src/controls/audit-inline-answers.js";
import {
  entryMarksLine,
  entryMarksOf,
  lineMark,
} from "../../../src/controls/audit-question-lines.js";
import {
  questionsSection,
  renderGapsQuestionBlock,
} from "../../../src/controls/audit-questions-markdown.js";
import {
  validateAuditReport,
  type AuditReport,
} from "../../../src/controls/audit-report.js";
import { completeAuditReport } from "../../helpers/control-audit-report.js";
import { context, CRITERIA, PART_FIRST } from "./audit-report-facts.js";

const REPORT = ".lisa/audit/report.md";
const GAPS = "wiki/gaps.md";
const LONG = `${"The audit read every pipeline file it could find. ".repeat(8)}None names an owner.`;
const PLATFORM_TEAM = "The platform team";

/** Ids whose folder a formatter spells another way in a heading. */
const ID = {
  underscore: `${PART_FIRST}@_private`,
  dunder: `${PART_FIRST}@packages/__generated__`,
  star: `${PART_FIRST}@a*b`,
  answered: `${PART_FIRST}@_infra`,
} as const;

/** Questions holding everything a formatter was seen to rewrite. */
const QUESTIONS = [
  {
    id: ID.underscore,
    text: "Who owns * @org/platform and docs/__policy__.md?",
    candidates: [
      { answer: "a *starred* word", found_in: "an _underlined_ one" },
      {
        answer: PLATFORM_TEAM,
        found_in: ".github/CODEOWNERS line 3: * @org/platform",
      },
      { answer: "docs/__policy__.md", found_in: "src/__init__.py names it" },
      { answer: "+ a plus sign first", found_in: "a list in the notes" },
      { answer: "* a star first", found_in: "another list" },
      { answer: "1) a numbered answer", found_in: "a numbered list" },
      { answer: "| lint | bun run lint |", found_in: "a row of a table" },
      { answer: "``bun run lint``", found_in: "the notes, in code" },
    ],
  },
  {
    id: ID.dunder,
    text: LONG,
    candidates: [],
    no_candidates_reason: `${LONG} It looked for * and for __names__ too.`,
  },
  {
    id: ID.star,
    text: "Is a ** b the same as a __ b?",
    candidates: [{ answer: "_", found_in: "*" }],
  },
] as const;

/** One answer on record, for the answered half of the readable report. */
const ANSWERS = [
  {
    id: ID.answered,
    question: "Which team reviews changes to __init__.py and to * globs?",
    answer: PLATFORM_TEAM,
  },
] as const;

/**
 * A report that holds the questions and the answer above.
 * @returns The report, as the renderer takes it
 * @throws {Error} When the sample it starts from does not pass its check
 */
function report(): AuditReport {
  const checked = validateAuditReport(completeAuditReport(), context()).report;
  if (checked === null) throw new Error("The sample report did not pass.");
  return { ...checked, questions: QUESTIONS, answers: ANSWERS };
}

/**
 * The readable report's questions block, in a file of its own.
 * @returns The file's text
 */
function reportText(): string {
  return [
    "# Audit report",
    "",
    ...questionsSection(report(), CRITERIA),
    "",
  ].join("\n");
}

/**
 * The gaps file of a wiki, with the audit's block among other content.
 * @returns The file's text
 */
function gapsText(): string {
  return [
    "# Gaps",
    "",
    "| Topic | Owner |",
    "| --- | --- |",
    "| Releases | nobody yet |",
    "",
    ...renderGapsQuestionBlock(report(), CRITERIA),
    "",
  ].join("\n");
}

/**
 * Format a Markdown file the way `prettier --write` does with no settings.
 * @param text - The file's text
 * @returns The formatted text
 */
async function formatted(text: string): Promise<string> {
  return format(text, { parser: "markdown" });
}

describe("a questions block a formatter was run over", () => {
  it("was rewritten by the formatter, so the cases below are about something", async () => {
    const text = await formatted(reportText());

    expect(text).not.toBe(reportText());
    expect(text).toContain(String.raw`line 3: \* @org/platform`);
    expect(text).toContain("docs/**policy**.md");
    expect(text).toContain("a _starred_ word");
    expect(text).toContain("  - - a plus sign first");
    expect(text).toContain("  - 1. a numbered answer");
    expect(text).toContain("  - `bun run lint`. Found:");
    expect(text).toContain(String.raw`### ${PART_FIRST}@\_private`);
    expect(text).toContain(`### ${PART_FIRST}@packages/**generated**`);
  });

  it("reads back with nothing refused, in the readable report", async () => {
    const block = parseQuestionBlock(await formatted(reportText()), REPORT, {
      lisaRendered: true,
    });

    expect(block.problems).toEqual([]);
    expect(block.entries.map(entry => entry.id)).toEqual([
      ID.underscore,
      ID.star,
      ID.dunder,
      ID.answered,
    ]);
  });

  it("reads back with nothing refused, in a wiki's gaps file", async () => {
    const block = parseQuestionBlock(await formatted(gapsText()), GAPS, {
      lisaRendered: false,
    });

    expect(block.problems).toEqual([]);
    expect(block.entries.map(entry => entry.id)).toEqual([
      ID.underscore,
      ID.star,
      ID.dunder,
    ]);
  });

  it("reads the same after the formatter was run a second time", async () => {
    const once = await formatted(reportText());

    expect(await formatted(once)).toBe(once);
  });

  it("keeps an answer that is on record under the id Lisa gave its question", async () => {
    const block = parseQuestionBlock(await formatted(reportText()), REPORT, {
      lisaRendered: true,
    });

    expect(block.entries.find(entry => entry.answered)).toMatchObject({
      id: ID.answered,
      answer: PLATFORM_TEAM,
    });
  });

  it("still refuses a word typed on a line Lisa wrote", async () => {
    const text = (await formatted(reportText())).replace(
      "a _starred_ word.",
      "a _starred_ word (Ana does)."
    );
    const block = parseQuestionBlock(text, REPORT, { lisaRendered: true });

    expect(block.entries).toEqual([]);
    expect(block.problems).toEqual([
      expect.stringContaining("is not as Lisa wrote it"),
    ]);
  });

  it("still refuses a heading that was changed into another question's", async () => {
    const text = (await formatted(reportText())).replace(
      String.raw`### ${PART_FIRST}@\_private`,
      `### ${PART_FIRST}@_public`
    );
    const block = parseQuestionBlock(text, REPORT, { lisaRendered: true });

    expect(block.entries).toEqual([]);
    expect(block.problems).toEqual([
      expect.stringContaining("is not as Lisa wrote it"),
    ]);
  });
});

describe("the mark of a line", () => {
  it.each([
    {
      name: "a star was escaped",
      written: "- **Question**: Who owns * @org/platform?",
      found: String.raw`- **Question**: Who owns \* @org/platform?`,
    },
    {
      name: "doubled underscores became doubled stars",
      written: "  - docs/__policy__.md. Found: src/__init__.py",
      found: "  - docs/**policy**.md. Found: src/**init**.py",
    },
    {
      name: "a starred word became an underlined one",
      written: "- **Question**: Is it *really* so?",
      found: "- **Question**: Is it _really_ so?",
    },
    {
      name: "an underscore was escaped",
      written: "### AC1.1@_private",
      found: String.raw`### AC1.1@\_private`,
    },
    {
      name: "a plus bullet became a dash",
      written: "  - + a plus sign first. Found: a list",
      found: "  - - a plus sign first. Found: a list",
    },
    {
      name: "a star bullet became a dash",
      written: "  - * a star first. Found: a list",
      found: "  - - a star first. Found: a list",
    },
    {
      name: "a bracket after a number became a full stop",
      written: "  - 1) a numbered answer. Found: a list",
      found: "  - 1. a numbered answer. Found: a list",
    },
    {
      name: "doubled backticks around code became single ones",
      written: "- **Question**: Does ``bun run lint`` run on every commit?",
      found: "- **Question**: Does `bun run lint` run on every commit?",
    },
    {
      name: "the cells of a table row were padded",
      written: "  - | lint | bun run lint |. Found: a table",
      found: "  - | lint   | bun run lint   |. Found: a table  ",
    },
  ])("is the same when $name", ({ written, found }) => {
    expect(lineMark(found)).toBe(lineMark(written));
  });

  it.each([
    {
      name: "a word was added",
      written: "- **Question**: Who owns * @org/platform?",
      found: String.raw`- **Question**: Who owns \* @org/platform? Ana`,
    },
    {
      name: "a word was changed",
      written: "  - docs/__policy__.md. Found: src/__init__.py",
      found: "  - docs/**policy**.txt. Found: src/**init**.py",
    },
    {
      name: "a number was changed",
      written: "  - 1) a numbered answer. Found: a list",
      found: "  - 2. a numbered answer. Found: a list",
    },
    {
      name: "a plus sign inside the line was changed",
      written: "- **Question**: Is 1 + 1 two?",
      found: "- **Question**: Is 1 - 1 two?",
    },
  ])("is another when $name", ({ written, found }) => {
    expect(lineMark(found)).not.toBe(lineMark(written));
  });
});

describe("the id on the comment line under a question", () => {
  it.each(Object.values(ID))(
    "reads back as the id %s after the formatter was run over the line",
    async id => {
      const line = entryMarksLine([`### ${id}`, "- **Status**: open"]);
      const text = await formatted(`- **Status**: open\n${line}\n`);

      expect(text).toContain(line);
      expect(entryMarksOf(line)?.id).toBe(id);
    }
  );

  it("is refused when the line carries no id", () => {
    const line = entryMarksLine(["### tracker", "- **Status**: open"]);

    expect(entryMarksOf(line.replace(/ id=\S+/u, ""))).toBeNull();
  });
});
