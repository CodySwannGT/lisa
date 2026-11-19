/**
 * The operator questionnaire is generated from the criterion catalogue
 * (CodySwannGT/lisa#4977).
 *
 * `docs/agentic-readiness-questionnaire.md` was written by hand, apart from the
 * specification, and the two had drifted: 122 questions against 77 requirements.
 * The catalogue (`spec/tasc-criteria.json`) is now the one place a question is
 * written, and the document is output. This suite pins the two things that make
 * that true:
 *
 * - the document holds exactly one question per in-scope criterion, in the
 *   catalogue's order, under headings an operator can read;
 * - an edit made to the document by hand is refused by the derived-artifact
 *   check, which names the command that regenerates it.
 *
 * The first is held here; the second is in
 * `generate-readiness-questionnaire-check.test.ts`.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED. Deriving a
 * heading or a count from the generator would make the assertion agree with
 * whatever the generator happens to print.
 * @module tests/unit/controls/generate-readiness-questionnaire
 */
import { describe, expect, it } from "vitest";

import {
  familyOf,
  familyTitles,
  renderQuestionnaire,
} from "../../../scripts/generate-readiness-questionnaire.mjs";
import {
  CATALOGUE_PATH,
  readRepositoryFile,
  SPECIFICATION_PATH,
} from "../../helpers/criterion-catalogue.js";
import {
  catalogue,
  committed,
  GENERATOR_COMMAND,
  inScope,
  numberedQuestions,
} from "./support/readiness-questionnaire-helpers.js";

/** How many criteria the catalogue puts in scope for Level 1. */
const IN_SCOPE_COUNT = 77;

/**
 * The specification's own section titles, in its order, with the criterion
 * prefix and the trailing SOC 2 note removed.
 */
const FAMILY_HEADINGS = [
  "Governance and Accountability",
  "Communication and Operator Legibility",
  "Risk Assessment: the Agent Threat Model",
  "Monitoring, Sensors, and Finding Integrity",
  "Enforcement Integrity",
  "Identity, Credentials, and Access",
  "System Operations and Recovery",
  "Change Management",
  "Third Parties and Supply Chain",
  "Software Integrity",
  "Data Protection",
  "User-Facing Integrity",
];

/** The introduction the hand-written document opened with, kept verbatim. */
const INTRODUCTION = [
  "# Agentic Readiness Questionnaire",
  "",
  "This is intended for operators, teams, and stakeholders",
  "who want to understand what an autonomous software factory needs without reading",
  "the formal control specification first.",
].join("\n");

/** A specification with three families, one of which states no requirement. */
const FIXTURE_SPECIFICATION = [
  "## Part III — The Criteria",
  "",
  "### AC1 — Governance and Accountability *(mirrors CC1, Control Environment)*",
  "",
  "- **AC1.1 Attribution.** Every action is attributed.",
  "",
  "### AC2 — Communication and Operator Legibility *(mirrors CC2, Communication)*",
  "",
  "- **AC2.1 Boundary communications.** Messages SHOULD be readable.",
  "",
  "### SI — Software Integrity *(supplemental; applies to all production software output)*",
  "",
  "- **SI1 Unit behavior.** Unit behavior is proven.",
  "",
].join("\n");

/** A catalogue over that specification: three questions in two families. */
const FIXTURE_CATALOGUE = {
  specification: "spec/example.md",
  specification_version: "0.0.1",
  level: 1,
  criteria: [
    {
      id: "AC1.1",
      title: "Attribution",
      in_scope: true,
      question: "Is every action recorded under the agent's own account?",
    },
    {
      id: "AC1.2",
      title: "Traceability of intent",
      in_scope: false,
      excluded_reason: "Stated only as a recommendation.",
    },
    {
      id: "AC2.1",
      title: "Boundary communications",
      in_scope: false,
      excluded_reason: "Stated only as a recommendation.",
    },
    {
      id: "SI1",
      title: "Unit behavior",
      in_scope: true,
      question: "Is a change refused when the unit tests fail?",
    },
    {
      id: "SI2",
      title: "Coverage floors",
      in_scope: true,
      question: "Is a change refused when coverage falls below your minimum?",
    },
  ],
};

/** Exactly what the generator must print for the fixture. */
const FIXTURE_DOCUMENT = [
  "<!--",
  "  GENERATED FILE. Do not edit it by hand: the next regeneration overwrites it.",
  "  It is rendered from the `question` of every in-scope criterion in",
  "  spec/tasc-criteria.json, under the section titles of",
  "  spec/example.md.",
  "  To change a question, edit the catalogue, then run:",
  "    bun run build:readiness-questionnaire",
  "-->",
  "",
  INTRODUCTION,
  "",
  "## Governance and Accountability",
  "",
  "1. Is every action recorded under the agent's own account?",
  "",
  "## Software Integrity",
  "",
  "2. Is a change refused when the unit tests fail?",
  "3. Is a change refused when coverage falls below your minimum?",
  "",
].join("\n");

const specification = readRepositoryFile(SPECIFICATION_PATH);

/**
 * The second-level headings of a rendered questionnaire, in order.
 * @param document - A questionnaire's Markdown
 * @returns Each heading's text
 */
function headings(document: string): string[] {
  return [...document.matchAll(/^## (?<heading>.+)$/gmu)].map(
    match => match.groups?.heading ?? ""
  );
}

describe("the questionnaire is generated from the catalogue", () => {
  it("asks one question for every in-scope criterion, in the catalogue's order", () => {
    // The count is pinned once, deliberately: a reader that finds no questions
    // would otherwise agree with an empty catalogue.
    expect(inScope).toHaveLength(IN_SCOPE_COUNT);
    expect(numberedQuestions(committed).map(question => question.text)).toEqual(
      inScope.map(criterion => criterion.question)
    );
  });

  it("numbers the questions from one, without a gap, across every section", () => {
    expect(
      numberedQuestions(committed).map(question => question.number)
    ).toEqual(
      Array.from({ length: IN_SCOPE_COUNT }, (_unused, index) => index + 1)
    );
  });

  it("groups them under the specification's own section titles", () => {
    expect(headings(committed)).toEqual(FAMILY_HEADINGS);
  });

  it("shows an operator no criterion id", () => {
    // Ids are detail for readers who know the specification. The document is
    // for the people who do not.
    const visible = committed.slice(committed.indexOf("-->"));

    expect(visible).not.toMatch(
      /\b(?:AC[1-9]\d*(?:\.\d+)?|(?:SI|DP|UX)\d+)\b/u
    );
  });

  it("keeps the introduction the hand-written document opened with", () => {
    expect(committed).toContain(`${INTRODUCTION}\n\n## `);
  });

  it("opens with a banner naming its source and the command that regenerates it", () => {
    const banner = committed.slice(0, committed.indexOf("-->"));

    expect(committed.startsWith("<!--\n  GENERATED FILE.")).toBe(true);
    expect(banner).toContain(CATALOGUE_PATH);
    expect(banner).toContain(SPECIFICATION_PATH);
    expect(banner).toContain(GENERATOR_COMMAND);
  });

  it("is exactly what the generator renders today", () => {
    expect(renderQuestionnaire(catalogue, specification)).toBe(committed);
  });
});

describe("renderQuestionnaire", () => {
  it("renders the banner, the introduction and one numbered list per family", () => {
    expect(renderQuestionnaire(FIXTURE_CATALOGUE, FIXTURE_SPECIFICATION)).toBe(
      FIXTURE_DOCUMENT
    );
  });

  it("gives no heading to a family with no question to ask", () => {
    const rendered = renderQuestionnaire(
      FIXTURE_CATALOGUE,
      FIXTURE_SPECIFICATION
    );

    expect(headings(rendered)).not.toContain(
      "Communication and Operator Legibility"
    );
  });

  it("ignores catalogue fields it does not render", () => {
    // Other tools add their own fields to each entry. The questionnaire reads
    // the question and nothing else, so it must not move when they do.
    const widened = {
      ...FIXTURE_CATALOGUE,
      criteria: FIXTURE_CATALOGUE.criteria.map(criterion => ({
        ...criterion,
        kind: "gate",
        minimum_rung: "exercised",
        gates: ["unit-tests"],
        no_gate_reason: "none",
      })),
    };

    expect(renderQuestionnaire(widened, FIXTURE_SPECIFICATION)).toBe(
      FIXTURE_DOCUMENT
    );
  });

  it("refuses a family the specification gives no section title", () => {
    // A heading invented here, or the bare prefix, is what an operator would
    // be shown instead. Stopping is the only answer that cannot mislead.
    const orphaned = {
      ...FIXTURE_CATALOGUE,
      criteria: [
        ...FIXTURE_CATALOGUE.criteria,
        {
          id: "UX1",
          title: "Constrained construction",
          in_scope: true,
          question: "Are screens built from approved components?",
        },
      ],
    };

    expect(() => renderQuestionnaire(orphaned, FIXTURE_SPECIFICATION)).toThrow(
      /UX.*spec\/example\.md/u
    );
  });

  it("refuses an in-scope criterion with no question", () => {
    const silent = {
      ...FIXTURE_CATALOGUE,
      criteria: [
        { id: "AC1.1", title: "Attribution", in_scope: true, question: " " },
      ],
    };

    expect(() => renderQuestionnaire(silent, FIXTURE_SPECIFICATION)).toThrow(
      /AC1\.1.*question/u
    );
  });
});

describe("familyOf", () => {
  it("is the section a criterion id belongs to", () => {
    expect(familyOf("AC1.1")).toBe("AC1");
    expect(familyOf("AC12.34")).toBe("AC12");
    expect(familyOf("SI10")).toBe("SI");
    expect(familyOf("DP3")).toBe("DP");
    expect(familyOf("UX5")).toBe("UX");
  });

  it("refuses an id that is not a criterion id", () => {
    expect(() => familyOf("Annex B")).toThrow(/Annex B/u);
  });
});

describe("familyTitles", () => {
  it("reads every section title out of the specification", () => {
    expect([...familyTitles(specification).values()]).toEqual(FAMILY_HEADINGS);
  });

  it("drops the criterion prefix and the trailing note", () => {
    expect(familyTitles(FIXTURE_SPECIFICATION).get("SI")).toBe(
      "Software Integrity"
    );
  });
});
