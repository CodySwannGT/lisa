/**
 * The questions of an audit as an operator reads and answers them.
 *
 * Each is written in the form `/lisa:agent-ready` uses in `wiki/gaps.md`: a
 * heading that is the question's stable id, the question as one plain
 * sentence, and an answer line to type on. Whatever is rendered must read
 * back, through the strict reader, as exactly what the record holds;
 * otherwise a passing check would itself break the next one
 * (CodySwannGT/lisa#4980).
 */
import { describe, expect, it } from "vitest";

import { parseQuestionBlock } from "../../../src/controls/audit-inline-answers.js";
import { renderGapsQuestionBlock } from "../../../src/controls/audit-questions-markdown.js";
import { renderAuditReportMarkdown } from "../../../src/controls/audit-report-markdown.js";
import {
  validateAuditReport,
  type AuditReport,
} from "../../../src/controls/audit-report.js";
import {
  amendFinding,
  askAbout,
  completeAuditReport,
  sampleTrackerQuestion,
  type SampleReport,
} from "../../helpers/control-audit-report.js";
import {
  API,
  AT_FIRST,
  context,
  CRITERIA,
  FIRST,
  PART_FIRST,
  WHOLE,
} from "./audit-report-facts.js";

const FILE = ".lisa/audit/report.md";
const FIRST_ID = `${FIRST}@${WHOLE}`;
const START = "<!-- lisa:audit-questions:start -->";
const END = "<!-- lisa:audit-questions:end -->";
const TRACKER_HEADING = "### tracker";
const TRACKER_LINE =
  "- **Question**: Which tracker does the team plan and follow its work in?";
const HEAD = "The head of engineering";
const TRACKER_WITH_CANDIDATES = {
  ...sampleTrackerQuestion(),
  candidates: [
    {
      answer: "GitHub Issues",
      found_in: "The address of the remote named origin is on github.com.",
    },
    {
      answer: "Jira",
      found_in: "Two commit messages start with a key such as OPS-12.",
    },
  ],
  no_candidates_reason: undefined,
};

/**
 * Validate a sample report and hand back the typed one.
 * @param sample - A report expected to pass
 * @returns The report
 * @throws {Error} When the sample does not pass, so a case cannot render junk
 */
function typed(sample: SampleReport): AuditReport {
  const { report, violations } = validateAuditReport(sample, context());
  if (report === null) throw new Error(JSON.stringify(violations));
  return report;
}

/**
 * Render a sample report.
 * @param sample - A report expected to pass
 * @returns The lines of the readable report
 */
function rendered(sample: SampleReport): readonly string[] {
  return renderAuditReportMarkdown(typed(sample), CRITERIA).split("\n");
}

/**
 * The lines of the questions block of a rendered report, markers included.
 * @param lines - The readable report
 * @returns The block
 */
function block(lines: readonly string[]): readonly string[] {
  return lines.slice(lines.indexOf(START), lines.indexOf(END) + 1);
}

describe("an open question in the readable report", () => {
  it("is written in the inline-answer form, with where each candidate was found", () => {
    const lines = rendered({
      ...completeAuditReport(),
      questions: [TRACKER_WITH_CANDIDATES],
    });

    expect(block(lines)).toEqual([
      START,
      "",
      "## Open questions (type each answer on its Answer line, then run the audit again)",
      "",
      TRACKER_HEADING,
      "",
      TRACKER_LINE,
      "- **Candidates**:",
      "  - GitHub Issues. Found: The address of the remote named origin is on github.com.",
      "  - Jira. Found: Two commit messages start with a key such as OPS-12.",
      "- **Answer**: _(human fills in)_",
      "- **Status**: open",
      "",
      END,
    ]);
  });

  it("says none were found, and where the audit looked", () => {
    expect(block(rendered(completeAuditReport())).slice(6, 9)).toEqual([
      TRACKER_LINE,
      "- **Candidates**: none found",
      "- **Where the audit looked**: The audit read the git remotes, the pipeline files and the configuration files, and none of them names a tracker.",
    ]);
  });

  it("comes after the summary and before the first part", () => {
    const headings = rendered(completeAuditReport()).filter(line =>
      line.startsWith("## ")
    );

    expect(headings.map(heading => heading.split(" (")[0])).toEqual([
      "## Summary",
      "## Open questions",
      "## Whole repository",
    ]);
  });

  it("lists setup questions first, then requirement questions in catalogue order", () => {
    const asked = [API, "web"].reduce(
      (report, scope) => askAbout(report, { criterion: PART_FIRST, scope }),
      askAbout(completeAuditReport([WHOLE, API, "web"]), AT_FIRST)
    );
    const reversed = {
      ...asked,
      questions: [...(asked.questions ?? [])].reverse(),
    };

    expect(
      rendered(reversed)
        .filter(line => line.startsWith("### ") && !line.includes("?"))
        .map(line => line.slice(4))
    ).toEqual(["tracker", FIRST_ID, `${PART_FIRST}@api`, `${PART_FIRST}@web`]);
  });

  it("is pointed at from the finding that needs the answer", () => {
    const lines = rendered(askAbout(completeAuditReport(), AT_FIRST));

    expect(lines).toContain(
      `- **Where to answer:** under "Open questions" near the top of this report, at \`${FIRST_ID}\``
    );
  });
});

describe("an answered question in the readable report", () => {
  const answered: SampleReport = {
    ...completeAuditReport(),
    questions: [],
    answers: [
      {
        id: "tracker",
        question: "Which tracker does the team plan and follow its work in?",
        answer: "Jira, the OPS board",
      },
      {
        id: FIRST_ID,
        question: "Who decides what happens when this goes wrong?",
        answer: HEAD,
      },
    ],
  };

  it("is shown with its answer and no longer as open", () => {
    expect(block(rendered(answered))).toEqual([
      START,
      "",
      "## Answered questions (to change an answer, edit its Answer line, then run the audit again)",
      "",
      TRACKER_HEADING,
      "",
      TRACKER_LINE,
      "- **Answer**: Jira, the OPS board",
      "- **Status**: absorbed",
      "",
      `### ${FIRST_ID}`,
      "",
      "- **Question**: Who decides what happens when this goes wrong?",
      "- **Answer**: The head of engineering",
      "- **Status**: absorbed",
      "",
      END,
    ]);
  });

  it("is shown under the finding it was about", () => {
    expect(rendered(answered)).toContain(
      "- **Your answer on record:** The head of engineering"
    );
  });
});

describe("a report with nothing to ask and nothing answered", () => {
  it("has no questions block at all", () => {
    const lines = renderAuditReportMarkdown(
      { ...typed(completeAuditReport()), questions: [] },
      CRITERIA
    ).split("\n");

    expect(lines.filter(line => line === START || line === END)).toEqual([]);
  });
});

describe("what is rendered reads back as what the record holds", () => {
  it.each([
    "Jira",
    "**Jira** - the `OPS` board, #4",
    "- **Answer**: a line that looks like the form itself",
    TRACKER_HEADING,
    "<!-- lisa:audit-questions:end --> and more",
    "ends with a backslash \\",
  ])("for the answer %j", answer => {
    const sample = {
      ...askAbout(completeAuditReport(), AT_FIRST),
      answers: [
        {
          id: `${PART_FIRST}@retired`,
          question: "Is this checked before a change is merged?",
          answer,
        },
      ],
    };
    const read = parseQuestionBlock(rendered(sample).join("\n"), FILE, {
      lisaRendered: true,
    });

    expect(read.problems).toEqual([]);
    expect(read.entries.map(entry => [entry.id, entry.answer])).toEqual([
      ["tracker", null],
      [FIRST_ID, null],
      [`${PART_FIRST}@retired`, answer],
    ]);
  });

  it("for a question whose words run over several lines of the record", () => {
    const sample = amendFinding(completeAuditReport(), AT_FIRST, {});
    const read = parseQuestionBlock(
      rendered({
        ...sample,
        answers: [
          {
            id: FIRST_ID,
            question: "Who decides\n  what happens?",
            answer: HEAD,
          },
        ],
      }).join("\n"),
      FILE,
      { lisaRendered: true }
    );

    expect(read.problems).toEqual([]);
    expect(read.entries.at(-1)?.question).toBe("Who decides what happens?");
  });
});

describe("the block written to a wiki's gaps file", () => {
  it("holds the open questions only, in the same form", () => {
    const report = typed({
      ...completeAuditReport(),
      answers: [
        {
          id: FIRST_ID,
          question: "Who decides what happens when this goes wrong?",
          answer: HEAD,
        },
      ],
    });
    const lines = renderGapsQuestionBlock(report, CRITERIA);

    expect(lines.slice(0, 5)).toEqual([
      START,
      "",
      "## Open questions from the audit (type each answer on its Answer line, then run the audit again)",
      "",
      TRACKER_HEADING,
    ]);
    expect(lines.at(-1)).toBe(END);
    expect(lines.join("\n")).not.toContain(HEAD);
    expect(
      parseQuestionBlock(lines.join("\n"), "wiki/gaps.md", {
        lisaRendered: false,
      })
    ).toMatchObject({ problems: [], entries: [{ id: "tracker" }] });
  });

  it("says so when no question is open", () => {
    const report = { ...typed(completeAuditReport()), questions: [] };

    expect(renderGapsQuestionBlock(report, CRITERIA)).toEqual([
      START,
      "",
      "## Open questions from the audit (none open)",
      "",
      END,
    ]);
  });
});
