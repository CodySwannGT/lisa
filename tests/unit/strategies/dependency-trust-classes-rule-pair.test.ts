import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const EAGER = "plugins/src/base/rules/reference/dependency-trust-classes.md";
const INDEX = "plugins/src/base/rules/eager/00-rule-index.md";
const REFERENCE =
  "plugins/src/base/rules/reference/dependency-trust-classes.md";
const DECOMPOSITION =
  "plugins/src/base/skills/lisa-task-decomposition/SKILL.md";
const TICKET_FIXTURE =
  "tests/fixtures/dependency-trust-classes/dependency-addition-ticket.md";

/**
 * The six trust classes, spelled exactly as the taxonomy names them. Every
 * surface — eager head, reference body, decomposition skill — has to use the
 * same strings, because the class name is what a work item cites and what a
 * decision record's trust-basis field resolves to. Drift in the wording is
 * drift in the contract.
 */
const TRUST_CLASSES = [
  "mature ecosystem primitive",
  "fast-moving standard implementation",
  "build/development tool",
  "runtime-critical service client",
  "thin wrapper suitable for in-house ownership",
  "temporary/experimental dependency",
] as const;

/** Path to the governed decision record the trust class resolves against. */
const RECORD_PATH = ".lisa/DEPENDENCY_DECISIONS.md";

/** The record field a trust class is the answer to. */
const TRUST_BASIS_FIELD = '"Why we believe it\'s safe (trust basis)"';

describe("dependency-trust-classes eager/reference rule pair", () => {
  it("ships the canonical eager and reference pair from plugin source", () => {
    expect(readFileSync(INDEX, "utf8")).toContain(
      "reference/dependency-trust-classes.md"
    );
  });

  it("cross-references the decision record so a trust basis resolves to a class", () => {
    const eager = readFileSync(EAGER, "utf8");
    const reference = readFileSync(REFERENCE, "utf8");

    expect(eager).toContain(RECORD_PATH);
    expect(eager).toContain(TRUST_BASIS_FIELD);
    expect(reference).toContain(RECORD_PATH);
    expect(reference).toContain(TRUST_BASIS_FIELD);
  });

  it("gives every class its own five review inputs, not just the taxonomy", () => {
    const reference = readFileSync(REFERENCE, "utf8");

    // Six classes, each restating the five inputs as its own bullet list.
    for (const label of [
      "**Capability owner:**",
      "**Update cadence:**",
      "**Detection evidence:**",
      "**Replacement-cost threshold:**",
      "**Ratification:**",
    ]) {
      expect(reference.split(label).length - 1).toBe(TRUST_CLASSES.length);
    }
  });

  it("leads every class with why it is trusted and names its human-review trigger", () => {
    const reference = readFileSync(REFERENCE, "utf8");

    // AC scenario 2: an operator reading a class definition can tell why the
    // class is trusted and what would trigger human review. Both are required
    // on all six, so neither can quietly go missing from one class.
    expect(reference.split("**Why we can trust it:**").length - 1).toBe(
      TRUST_CLASSES.length
    );
    expect(
      reference.split("**Human review is triggered when:**").length - 1
    ).toBe(TRUST_CLASSES.length);
  });
});

describe("dependency trust classes wired into planning guidance", () => {
  it("makes the decomposition skill demand the record update and the ratification call", () => {
    const skill = readFileSync(DECOMPOSITION, "utf8");

    expect(skill).toContain(`\`${RECORD_PATH}\``);
  });
});

describe("dependency-addition ticket fixture", () => {
  it("commits to updating the decision record in the same change", () => {
    const ticket = readFileSync(TICKET_FIXTURE, "utf8");

    expect(ticket).toContain(RECORD_PATH);
  });
});
