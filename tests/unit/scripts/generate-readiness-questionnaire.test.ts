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
 * Per the Test Isolation house rule, expected values are HARDCODED. Deriving a
 * heading or a count from the generator would make the assertion agree with
 * whatever the generator happens to print.
 * @module tests/unit/scripts/generate-readiness-questionnaire
 */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  requiresReadinessQuestionnaireCheck,
  staleArtifacts,
} from "../../../scripts/check-derived-artifacts.mjs";
import {
  familyOf,
  familyTitles,
  inspectQuestionnaire,
  renderQuestionnaire,
  writeQuestionnaire,
} from "../../../scripts/generate-readiness-questionnaire.mjs";
import {
  CATALOGUE_PATH,
  loadCatalogue,
  readRepositoryFile,
  SPECIFICATION_PATH,
  type InScopeCriterion,
} from "../../helpers/criterion-catalogue.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The generated document. */
const QUESTIONNAIRE_PATH = "docs/agentic-readiness-questionnaire.md";

/** The generator, as the derived-artifact check runs it. */
const GENERATOR_SCRIPT = "scripts/generate-readiness-questionnaire.mjs";

/** The command an operator is told to run. */
const GENERATOR_COMMAND = "bun run build:readiness-questionnaire";

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

const catalogue = loadCatalogue();
const specification = readRepositoryFile(SPECIFICATION_PATH);
const committed = readRepositoryFile(QUESTIONNAIRE_PATH);
const inScope = catalogue.criteria.filter(
  (criterion): criterion is InScopeCriterion => criterion.in_scope
);

/**
 * The numbered questions of a rendered questionnaire, in order.
 * @param document - A questionnaire's Markdown
 * @returns Each question's number and text
 */
function numberedQuestions(
  document: string
): { number: number; text: string }[] {
  return [...document.matchAll(/^(?<number>\d+)\. (?<text>.+)$/gmu)].map(
    match => ({
      number: Number(match.groups?.number),
      text: match.groups?.text ?? "",
    })
  );
}

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

/** Temporary repositories this file built, removed after each case. */
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Build a directory holding only what the generator reads — the catalogue and
 * the specification — and the questionnaire generated from them.
 * @returns The directory, standing in for a repository root
 */
function temporaryRepository(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "readiness-questionnaire-"));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, "docs"));
  cpSync(path.join(REPO_ROOT, "spec"), path.join(root, "spec"), {
    recursive: true,
  });
  writeQuestionnaire(root);
  return root;
}

/**
 * Change one question in a generated questionnaire, the way a hand edit would.
 * @param root - Directory built by {@link temporaryRepository}
 */
function editByHand(root: string): void {
  const file = path.join(root, QUESTIONNAIRE_PATH);
  const [first] = numberedQuestions(readFileSync(file, "utf8"));
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace(
      first?.text ?? "",
      "Do your agents sign their own work?"
    )
  );
}

/**
 * Run the generator from the command line.
 * @param args - Arguments after the script name
 * @param script - Repository-relative generator path
 * @returns Its exit code and everything it printed
 */
function runGenerator(
  args: readonly string[],
  script: string = GENERATOR_SCRIPT
): { status: number | null; output: string } {
  const child = boundedSpawnSync({
    label: `${script} ${args.join(" ")}`,
    command: process.execPath,
    args: [script, ...args],
    cwd: REPO_ROOT,
  });
  return {
    status: child.status,
    output: `${child.stdout}${child.stderr}`.trim(),
  };
}

/**
 * Run the generator's `--check` against a directory, as the derived-artifact
 * check runs it against the repository.
 * @param root - Directory to check
 * @param script - Repository-relative generator path
 * @returns Whether the check passed, and what it printed
 */
function runCheckAt(
  root: string,
  script: string
): { ok: boolean; output: string } {
  const { status, output } = runGenerator(["--check", "--root", root], script);
  return { ok: status === 0, output };
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

describe("a hand-edited questionnaire is caught", () => {
  it("passes when the document is what the generator renders", () => {
    const root = temporaryRepository();

    expect(readFileSync(path.join(root, QUESTIONNAIRE_PATH), "utf8")).toBe(
      committed
    );
    expect(inspectQuestionnaire(root)).toEqual({ current: true, message: "" });
  });

  it("names the document, the line that differs and the generator command", () => {
    const root = temporaryRepository();
    editByHand(root);

    const verdict = inspectQuestionnaire(root);

    expect(verdict.current).toBe(false);
    expect(verdict.message).toContain(`${QUESTIONNAIRE_PATH} is stale.`);
    expect(verdict.message).toContain("Do your agents sign their own work?");
    expect(verdict.message).toContain(CATALOGUE_PATH);
    expect(verdict.message).toContain(GENERATOR_COMMAND);
  });

  it("is caught when a question is added below the last one", () => {
    // Every generated line still matches, so the difference is the first line
    // the generator did not print.
    const root = temporaryRepository();
    const file = path.join(root, QUESTIONNAIRE_PATH);
    writeFileSync(file, `${committed}78. Is the office coffee any good?\n`);

    const verdict = inspectQuestionnaire(root);

    expect(verdict.current).toBe(false);
    expect(verdict.message).toContain("78. Is the office coffee any good?");
    expect(verdict.message).toContain("the document ends here");
  });

  it("says so when only the end of the file differs", () => {
    // An editor that drops the final newline changes no line a person can
    // see, so pointing at a line would send them looking for nothing.
    const root = temporaryRepository();
    writeFileSync(path.join(root, QUESTIONNAIRE_PATH), committed.trimEnd());

    const verdict = inspectQuestionnaire(root);

    expect(verdict.current).toBe(false);
    expect(verdict.message).toContain("line ending at the end of the file");
  });

  it("is caught when the document is missing altogether", () => {
    const root = temporaryRepository();
    rmSync(path.join(root, QUESTIONNAIRE_PATH));

    const verdict = inspectQuestionnaire(root);

    expect(verdict.current).toBe(false);
    expect(verdict.message).toContain(GENERATOR_COMMAND);
  });

  it("is caught when the catalogue changes and the document does not", () => {
    const root = temporaryRepository();
    const file = path.join(root, CATALOGUE_PATH);
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(
        inScope[0]?.question ?? "",
        "Does every agent act under its own account?"
      )
    );

    expect(inspectQuestionnaire(root).current).toBe(false);
  });

  it("exits 1 from the command line and leaves the edit in place", () => {
    const root = temporaryRepository();
    editByHand(root);
    const edited = readFileSync(path.join(root, QUESTIONNAIRE_PATH), "utf8");

    const result = runGenerator(["--check", "--root", root]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(`${QUESTIONNAIRE_PATH} is stale.`);
    expect(result.output).toContain(GENERATOR_COMMAND);
    expect(readFileSync(path.join(root, QUESTIONNAIRE_PATH), "utf8")).toBe(
      edited
    );
  });

  it("is repaired by running the generator again", () => {
    const root = temporaryRepository();
    editByHand(root);

    const result = runGenerator(["--root", root]);

    expect(result.status).toBe(0);
    expect(result.output).toContain("77 questions");
    expect(inspectQuestionnaire(root).current).toBe(true);
  });

  it("reports a missing catalogue as an error, not as a stale document", () => {
    const root = temporaryRepository();
    rmSync(path.join(root, CATALOGUE_PATH));

    const result = runGenerator(["--check", "--root", root]);

    expect(result.status).toBe(2);
    expect(result.output).toContain("could not be generated");
    expect(result.output).not.toContain("is stale");
  });

  it("refuses --root with no directory after it", () => {
    expect(runGenerator(["--check", "--root"]).status).toBe(2);
  });

  it("refuses a mistyped flag instead of writing the document", () => {
    // Ignored, `--chekc` would fall through to generation and exit 0, which
    // reads as a check that passed.
    const root = temporaryRepository();
    editByHand(root);
    const edited = readFileSync(path.join(root, QUESTIONNAIRE_PATH), "utf8");

    const result = runGenerator(["--chekc", "--root", root]);

    expect(result.status).toBe(2);
    expect(result.output).toContain("--chekc");
    expect(readFileSync(path.join(root, QUESTIONNAIRE_PATH), "utf8")).toBe(
      edited
    );
  });
});

describe("the derived-artifact check owns the questionnaire", () => {
  it("owes the check when the document, its sources or its generator are staged", () => {
    for (const staged of [
      QUESTIONNAIRE_PATH,
      CATALOGUE_PATH,
      SPECIFICATION_PATH,
      GENERATOR_SCRIPT,
    ]) {
      expect(requiresReadinessQuestionnaireCheck([staged])).toBe(true);
    }
  });

  it("owes nothing for an unrelated file or an empty commit", () => {
    expect(
      requiresReadinessQuestionnaireCheck(["README.md", "docs/npm-updater.md"])
    ).toBe(false);
    expect(requiresReadinessQuestionnaireCheck([])).toBe(false);
  });

  it("fails on a hand-edited questionnaire and names the generator command", () => {
    const root = temporaryRepository();
    editByHand(root);
    const ran: string[] = [];

    const failures = staleArtifacts([QUESTIONNAIRE_PATH], script => {
      ran.push(script);
      return runCheckAt(root, script);
    });

    expect(ran).toEqual([GENERATOR_SCRIPT]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("readiness questionnaire is stale.");
    expect(failures[0]).toContain(`${QUESTIONNAIRE_PATH} is stale.`);
    expect(failures[0]).toContain(`Fix: ${GENERATOR_COMMAND}`);
  });

  it("passes a questionnaire nobody edited", () => {
    const root = temporaryRepository();

    expect(
      staleArtifacts([QUESTIONNAIRE_PATH], script => runCheckAt(root, script))
    ).toEqual([]);
  });

  it("passes against this repository, from the command line", () => {
    expect(runGenerator(["--check"]).status).toBe(0);
  });
});
