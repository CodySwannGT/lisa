import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const EAGER = "plugins/src/base/rules/eager/dependency-trust-classes.md";
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
    const eager = readFileSync(EAGER, "utf8");
    const reference = readFileSync(REFERENCE, "utf8");

    expect(eager).toContain("# Dependency Trust Classes (load-bearing)");
    expect(eager).toContain(
      "[reference/dependency-trust-classes.md](../reference/dependency-trust-classes.md)"
    );
    expect(reference).toContain("# Dependency Trust Classes");
  });

  it("names all six trust classes on both halves of the pair", () => {
    const eager = readFileSync(EAGER, "utf8").toLowerCase();
    const reference = readFileSync(REFERENCE, "utf8").toLowerCase();

    for (const trustClass of TRUST_CLASSES) {
      expect(eager).toContain(trustClass);
      expect(reference).toContain(trustClass);
    }
  });

  it("cross-references the decision record so a trust basis resolves to a class", () => {
    const eager = readFileSync(EAGER, "utf8");
    const reference = readFileSync(REFERENCE, "utf8");

    expect(eager).toContain(RECORD_PATH);
    expect(eager).toContain(TRUST_BASIS_FIELD);
    expect(reference).toContain(RECORD_PATH);
    expect(reference).toContain(TRUST_BASIS_FIELD);
  });

  it("states all five review inputs for the taxonomy", () => {
    const reference = readFileSync(REFERENCE, "utf8");

    expect(reference).toContain("## The five review inputs");
    expect(reference).toContain("**Capability owner**");
    expect(reference).toContain("**Update cadence**");
    expect(reference).toContain("**Detection evidence**");
    expect(reference).toContain("**Replacement-cost threshold**");
    expect(reference).toContain("**Product/human ratification**");
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

  it("requires human ratification on the lower-trust and higher-exposure classes", () => {
    const eager = readFileSync(EAGER, "utf8");
    const reference = readFileSync(REFERENCE, "utf8");

    expect(eager).toContain(
      "runtime-critical service clients always need human\nratification"
    );
    expect(reference).toContain("## Ratification, summarized");
    expect(reference).toContain(
      "**product/human ratification is required** before adding the\n  dependency and before any major upgrade"
    );
    expect(reference).toContain(
      "**required to extend past the expiry date** or to promote it"
    );
    expect(reference).toContain(
      "Not required for mature ecosystem primitives or build/development tools"
    );
  });

  it("forbids blind detection evidence on the runtime-critical class", () => {
    const reference = readFileSync(REFERENCE, "utf8");

    expect(reference).toContain(
      '"Nothing would catch it" is not an acceptable answer in this class'
    );
  });

  it("requires reclassification instead of quiet re-trust when exposure changes", () => {
    const eager = readFileSync(EAGER, "utf8");
    const reference = readFileSync(REFERENCE, "utf8");

    expect(eager).toContain("Reclassify — do not quietly re-trust —");
    expect(reference).toContain("## Reclassification");
  });

  it("documents the uniform six-agent enforcement gap", () => {
    const reference = readFileSync(REFERENCE, "utf8");

    expect(reference).toContain("## Agent parity");
    expect(reference).toContain(
      "no agent runtime enforces\nthat a dependency carries a correct class"
    );
  });
});

describe("dependency trust classes wired into planning guidance", () => {
  it("makes the decomposition skill demand a trust class for a new material dependency", () => {
    const skill = readFileSync(DECOMPOSITION, "utf8");
    const lowered = skill.toLowerCase();

    expect(skill).toContain("### 4.5. Classify Any New Material Dependency");
    expect(skill).toContain("**Name its trust class**");
    for (const trustClass of TRUST_CLASSES) {
      expect(lowered).toContain(trustClass);
    }
  });

  it("makes the decomposition skill demand the record update and the ratification call", () => {
    const skill = readFileSync(DECOMPOSITION, "utf8");

    expect(skill).toContain(`\`${RECORD_PATH}\``);
    expect(skill).toContain("**State the class's required evidence**");
    expect(skill).toContain(
      "a proposed material dependency with no named class is not ready to build"
    );
  });
});

describe("dependency-addition ticket fixture", () => {
  it("names the dependency's trust class", () => {
    const ticket = readFileSync(TICKET_FIXTURE, "utf8");

    expect(ticket).toContain(
      "**Trust class:** runtime-critical service client"
    );
    expect(ticket).toContain("**Why that class:**");
  });

  it("states the required review evidence for that class", () => {
    const ticket = readFileSync(TICKET_FIXTURE, "utf8");

    expect(ticket).toContain("### Required evidence for this trust class");
    expect(ticket).toContain("**Capability owner:**");
    expect(ticket).toContain("**Update cadence:**");
    expect(ticket).toContain("**Detection evidence:**");
    expect(ticket).toContain("**Replacement cost:**");
    expect(ticket).toContain("**Product/human ratification:** **required**");
  });

  it("commits to updating the decision record in the same change", () => {
    const ticket = readFileSync(TICKET_FIXTURE, "utf8");

    expect(ticket).toContain(RECORD_PATH);
    expect(ticket).toContain("naming its trust class");
  });
});
