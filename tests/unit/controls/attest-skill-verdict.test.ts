/**
 * What the attest skill promises about the verdict (CodySwannGT/lisa#5001).
 *
 * The acceptance scenario: every verdict the skill presents is read from the
 * verdict file after `lisa controls attest --check` has passed, and the
 * agent never writes one. A model cannot be put in a test, so the promise is
 * held to the text the agent follows:
 *
 * - the verdict file is read in exactly one step, that step comes after the
 *   step that runs the check, and it says it needs the check to have passed;
 * - nothing the verdict file holds is named before that step;
 * - no sentence tells the agent to write or change the verdict, the evidence
 *   or the register, and the skill says in so many words that it never does;
 * - the two options that reach outside the repository are never part of the
 *   first run, and the step that offers them asks for a yes;
 * - every word a command can hand the agent is explained, so the agent never
 *   has to make up what one means.
 *
 * The same order is then executed against a real repository, with a verdict
 * edited by hand, in `tests/integration/controls-attest-skill.test.ts`.
 * @module tests/unit/controls/attest-skill-verdict
 */
import { describe, expect, it } from "vitest";

import {
  BEFORE_ENFORCE_OUTCOMES,
  BEFORE_ENFORCE_RESULTS,
} from "../../../src/controls/before-enforce-types.js";
import { EVIDENCE_RUNGS } from "../../../src/controls/evidence-types.js";
import { EVIDENCE_PATH } from "../../../src/controls/evidence.js";
import { CONTROL_REGISTER_PATH } from "../../../src/controls/register-types.js";
import {
  VERDICT_PATH,
  VERDICT_REASONS,
} from "../../../src/controls/verdict-types.js";
import {
  attestSkill,
  attestSkillSection,
  attestSkillSteps,
  sentencesOf,
} from "../../helpers/attest-skill.js";

const CHECK_COMMAND = "lisa controls attest --check";
const RESULT_FILES = [EVIDENCE_PATH, CONTROL_REGISTER_PATH, VERDICT_PATH];

/** What only the verdict file holds, as the skill names it. */
const VERDICT_ONLY_FIELDS = [
  "`prevented_by`",
  "`current_until`",
  "`evidence_as_of`",
];

/** The reasons a requirement is met or does not apply: nothing to act on. */
const SETTLED_REASONS = [
  "control-proved",
  "artifact-located",
  "person-attested",
  "not-applicable",
];

/** The two options that reach outside the repository. */
const OPT_INS = ["--pull-request-canaries", "--acknowledge-external-effects"];

/** How the skill refers to the three files the attest command writes. */
const RESULT_NOUN =
  /verdict\.json|evidence\.json|register\.json|three files|verdict file|\ba verdict\b|\bthe verdict\b/iu;

/** Words that would tell someone to produce or alter a file. */
const EDITING_VERBS: ReadonlySet<string> = new Set([
  "write",
  "writes",
  "edit",
  "edits",
  "correct",
  "corrects",
  "change",
  "changes",
  "changed",
  "fix",
  "fixes",
  "update",
  "updates",
  "adjust",
  "modify",
  "reformat",
  "create",
  "creates",
  "delete",
  "deletes",
  "repair",
  "improve",
  "issue",
  "copy",
]);

/** Words that make a sentence a prohibition. */
const FORBIDDING: ReadonlySet<string> = new Set([
  "never",
  "not",
  "nothing",
  "no",
]);

/** Ways the skill says that a command, and not the agent, is what writes. */
const THE_COMMAND_WRITES = ["`lisa controls attest` writes", "it writes"];

const BEFORE_ENFORCE = "before-enforce";

/**
 * The words of a sentence, lower-cased.
 * @param sentence - The sentence
 * @returns Each run of letters
 */
function wordsOf(sentence: string): readonly string[] {
  return sentence.toLowerCase().split(/[^a-z]+/u);
}

/**
 * Tell whether a sentence tells the agent to write or change a result file.
 * @param sentence - One sentence of the skill
 * @returns Whether it names a result file with an editing verb, and neither
 *   forbids nor says a command is what writes
 */
function tellsTheAgentToWrite(sentence: string): boolean {
  const words = wordsOf(sentence);
  return (
    RESULT_NOUN.test(sentence) &&
    words.some(word => EDITING_VERBS.has(word)) &&
    !words.some(word => FORBIDDING.has(word)) &&
    !THE_COMMAND_WRITES.some(phrase => sentence.includes(phrase))
  );
}

/**
 * Tell whether a piece of the skill tells the agent to read the verdict file.
 * @param text - A piece of the skill
 * @returns Whether a line of it says to read that file
 */
function readsTheVerdictFile(text: string): boolean {
  return text
    .split("\n")
    .some(
      line => wordsOf(line).includes("read") && line.includes("verdict.json")
    );
}

/**
 * The attest commands a step tells the agent to run, one per line.
 * @param body - The step's text
 * @returns Each such line, trimmed
 */
function attestCommands(body: string): readonly string[] {
  return body
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith("lisa controls attest"));
}

const steps = attestSkillSteps("attest");
const checkStep = steps.find(step => step.body.includes(CHECK_COMMAND));
const readingSteps = steps.filter(step => readsTheVerdictFile(step.body));

describe("where the attest skill reads the verdict", () => {
  it("reads the verdict file in exactly one step, after the step that runs the check", () => {
    expect(checkStep).toBeDefined();
    expect(readingSteps).toHaveLength(1);
    expect(readingSteps[0]?.number).toBeGreaterThan(checkStep?.number ?? 0);
  });

  it("says that step needs the check to have passed", () => {
    const [, afterNeeds = ""] = (readingSteps[0]?.body ?? "").split(
      "**Needs:**"
    );
    const [needs] = afterNeeds.split("**Hands on:**");

    expect(needs).toMatch(/check/u);
    expect(needs).toMatch(/passed|exit 0/u);
  });

  it("names nothing the verdict file holds before that step, in either kind of run", () => {
    const reading = readingSteps[0]?.number ?? 0;
    const earlier = [
      attestSkill().split("\n## Steps\n")[0] ?? "",
      ...steps.filter(step => step.number < reading).map(step => step.body),
      attestSkillSection(BEFORE_ENFORCE),
    ].join("\n");

    expect(
      VERDICT_ONLY_FIELDS.filter(field => earlier.includes(field))
    ).toEqual([]);
    expect(readsTheVerdictFile(earlier)).toBe(false);
  });

  it("presents the closing message from the verdict that step read", () => {
    const closing = steps.at(-1);

    expect(closing?.number).toBeGreaterThan(readingSteps[0]?.number ?? 0);
    expect(closing?.body).toMatch(
      /\*\*Needs:\*\*\s+the\s+verdict\s+read\s+in\s+step\s+\d/u
    );
    expect(
      VERDICT_ONLY_FIELDS.filter(field => closing?.body.includes(field))
    ).not.toEqual([]);
  });

  it("tells the agent to present no verdict when the check does not pass", () => {
    expect(checkStep?.body.match(/Present no verdict/gu)).toHaveLength(2);
  });

  it("presents no verdict in a before-enforce run", () => {
    expect(attestSkillSection(BEFORE_ENFORCE)).toMatch(
      /presents\s+no\s+verdict/u
    );
  });
});

describe("what the attest skill tells the agent about the result files", () => {
  it("names all three, and says the agent never creates, edits or deletes them", () => {
    const naming = attestSkill()
      .split("\n\n")
      .find(paragraph => RESULT_FILES.every(file => paragraph.includes(file)));

    expect(naming?.replaceAll(/\s+/gu, " ")).toMatch(
      /You never create, edit, correct, reformat or delete any of the three/u
    );
  });

  it("has no sentence that tells the agent to write or change one", () => {
    expect(sentencesOf(attestSkill()).filter(tellsTheAgentToWrite)).toEqual([]);
  });

  it("would catch a sentence that did tell the agent to change the verdict", () => {
    expect(
      [
        "When the verdict looks wrong, edit `.lisa/controls/verdict.json` so that it matches.",
        "Update the verdict file with the result you worked out.",
      ].filter(tellsTheAgentToWrite)
    ).toHaveLength(2);
  });

  it("says they are meant to be committed and that the agent does not commit them", () => {
    const skill = attestSkill().replaceAll(/\s+/gu, " ");

    expect(skill).toMatch(/meant to be committed/u);
    expect(skill).toMatch(/you have not committed them/u);
  });
});

describe("the two options that reach outside the repository", () => {
  const blocks = steps.map(step => ({
    step,
    passes: OPT_INS.filter(option =>
      attestCommands(step.body).some(command => command.includes(option))
    ),
  }));

  it("are passed by no command but those of one step, which asks the operator first", () => {
    const offering = blocks.filter(({ passes }) => passes.length > 0);

    expect(offering).toHaveLength(1);
    expect(offering[0]?.passes).toEqual(OPT_INS);
    expect(offering[0]?.step.body.match(/On a yes/gu)).toHaveLength(2);
    expect(offering[0]?.step.body).toMatch(/Shall I/u);
  });

  it("come after a first run that passes neither", () => {
    const first = blocks.find(({ step }) =>
      attestCommands(step.body).includes("lisa controls attest --json")
    );
    const offering = blocks.find(({ passes }) => passes.length > 0);

    expect(first?.passes).toEqual([]);
    expect(first?.step.number).toBeLessThan(offering?.step.number ?? 0);
  });
});

describe("the words a command can hand the agent", () => {
  it.each(VERDICT_REASONS.filter(reason => !SETTLED_REASONS.includes(reason)))(
    "include what to do about a requirement held back for %s",
    reason => {
      expect(readingSteps[0]?.body).toContain(`| \`${reason}\``);
    }
  );

  it.each(EVIDENCE_RUNGS)("include the basis %s", rung => {
    expect(readingSteps[0]?.body).toContain(`| \`${rung}\` |`);
  });

  it.each([...BEFORE_ENFORCE_RESULTS, ...BEFORE_ENFORCE_OUTCOMES])(
    "include the before-enforce word %s",
    word => {
      expect(attestSkillSection(BEFORE_ENFORCE)).toContain(`| \`${word}\` |`);
    }
  );
});

describe("where a proof's test change has to be", () => {
  it.each(["attest", BEFORE_ENFORCE] as const)(
    "is said in the %s run: inside the check's own folder",
    run => {
      expect(attestSkillSection(run)).toMatch(
        /edit\s+a\s+file\s+inside\s+the\s+check's\s+own\s+folder/u
      );
    }
  );
});
