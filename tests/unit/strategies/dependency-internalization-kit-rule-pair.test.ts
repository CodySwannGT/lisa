import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const EAGER =
  "plugins/src/base/rules/reference/dependency-internalization-kit.md";
const INDEX = "plugins/src/base/rules/eager/00-rule-index.md";
const REFERENCE =
  "plugins/src/base/rules/reference/dependency-internalization-kit.md";
const DECOMPOSITION =
  "plugins/src/base/skills/lisa-task-decomposition/SKILL.md";
const INTERNALIZATION_FIXTURE =
  "tests/fixtures/dependency-internalization-kit/dependency-internalization-ticket.md";
const BUMP_FIXTURE =
  "tests/fixtures/dependency-internalization-kit/version-bump-ticket.md";

/**
 * Collapses markdown soft-wrapping so prose assertions survive reflowing by the
 * formatter. The contract is the sentence, not where the line happened to break.
 *
 * @param text - Raw markdown source read from a rule, skill, or fixture file.
 * @returns The same text with every run of whitespace collapsed to one space.
 */
const flat = (text: string): string => text.replace(/\s+/gu, " ");

/**
 * The seven evidence types, each paired with the plain question it answers.
 * The question is the operator-readable half — a non-technical reader judges a
 * removal by whether these seven have answers — so both halves are asserted on
 * every surface. Drift in either is drift in the contract.
 */
const KIT_CRITERIA = [
  ["Real corpus", "did we test it on real inputs, not toy examples?"],
  ["Conformance fixtures", "does the new code do what the dependency did?"],
  ["Negative fixtures", "does it still reject what it should reject?"],
  ["Coverage as a gap detector", "what behavior is still untested?"],
  [
    "Provenance and license review",
    "where did this code come from, and are we allowed to use it?",
  ],
  [
    "Migration and update plan",
    "how do existing call sites move, and how does the new code stay current?",
  ],
  [
    "Rollback or replacement criteria",
    "what would make us go back, and to what?",
  ],
] as const;

/** The trust class an internalized capability lands in. */
const IN_HOUSE_CLASS = "thin wrapper suitable for in-house ownership";

describe("dependency-internalization-kit eager/reference rule pair", () => {
  it("ships the canonical eager and reference pair from plugin source", () => {
    expect(readFileSync(INDEX, "utf8")).toContain(
      "reference/dependency-internalization-kit.md"
    );
  });

  it("names all seven evidence types on both halves of the pair", () => {
    const eager = readFileSync(EAGER, "utf8").toLowerCase();
    const reference = readFileSync(REFERENCE, "utf8").toLowerCase();

    for (const [name] of KIT_CRITERIA) {
      expect(eager).toContain(name.toLowerCase());
      expect(reference).toContain(name.toLowerCase());
    }
  });

  it("leads every evidence type with the plain question it answers", () => {
    const eager = readFileSync(EAGER, "utf8");
    const reference = readFileSync(REFERENCE, "utf8");

    // Operator-readability: the seven are legible to a non-technical reader
    // only because each one leads with its question. Asserted on both halves so
    // a question cannot go missing from the summary or the prose.
    for (const [name, question] of KIT_CRITERIA) {
      expect(flat(eager)).toContain(`**${name}** — ${question}`);
      expect(flat(reference)).toContain(`${name} — ${question}`);
    }
  });

  it("gives each of the seven its own reference section", () => {
    const reference = readFileSync(REFERENCE, "utf8");
    for (const [index, [name]] of KIT_CRITERIA.entries()) {
      expect(reference).toContain(`### ${index + 1}. ${name} —`);
    }
  });
});

describe("confidence-rebuild kit wired into planning guidance", () => {
  it("adds a decomposition step for dependencies moving in-house", () => {
    const skill = readFileSync(DECOMPOSITION, "utf8");
    expect(skill).toContain("`dependency-internalization-kit`");
  });

  it("enumerates all seven criteria with their plain questions in the skill", () => {
    const skill = readFileSync(DECOMPOSITION, "utf8");
    for (const [name, question] of KIT_CRITERIA) {
      expect(flat(skill)).toContain(`**${name}** — ${question}`);
    }
  });
});

describe("dependency-internalization ticket fixture", () => {
  it("declares the ownership move and that the dependency is material", () => {
    const ticket = readFileSync(INTERNALIZATION_FIXTURE, "utf8");
    expect(ticket).toContain(
      `**Trust class after the move:** ${IN_HOUSE_CLASS}`
    );
  });

  it("carries all seven kit criteria as Gherkin acceptance criteria", () => {
    const ticket = readFileSync(INTERNALIZATION_FIXTURE, "utf8");
    for (const [name, question] of KIT_CRITERIA) {
      expect(flat(ticket)).toContain(`Scenario: ${name} -- ${question}`);
    }
    // Seven criteria, seven scenarios -- no extras masking a missing one.
    expect(ticket.split("Scenario:").length - 1).toBe(KIT_CRITERIA.length);
  });
});

describe("version-bump ticket fixture", () => {
  it("does NOT carry the confidence-rebuild kit", () => {
    const ticket = readFileSync(BUMP_FIXTURE, "utf8");

    // The negative proof: none of the seven criteria appear as acceptance
    // criteria on an ordinary bump. Scenario titles are checked rather than
    // free prose, because the ticket names the kit once to explain its absence.
    for (const [name] of KIT_CRITERIA) {
      expect(ticket).not.toContain(`Scenario: ${name}`);
    }
    expect(ticket.split("Scenario:").length - 1).toBe(2);
  });
});
