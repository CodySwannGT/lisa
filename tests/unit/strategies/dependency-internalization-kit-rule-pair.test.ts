import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const EAGER = "plugins/src/base/rules/eager/dependency-internalization-kit.md";
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
    const eager = readFileSync(EAGER, "utf8");
    const reference = readFileSync(REFERENCE, "utf8");

    expect(eager).toContain("# Dependency Internalization Kit (load-bearing)");
    expect(eager).toContain(
      "[reference/dependency-internalization-kit.md](../reference/dependency-internalization-kit.md)"
    );
    expect(reference).toContain("# Dependency Internalization Kit");
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

    expect(reference).toContain("## The seven required evidence types");
    for (const [index, [name]] of KIT_CRITERIA.entries()) {
      expect(reference).toContain(`### ${index + 1}. ${name} —`);
    }
  });

  it("requires all seven and refuses a partial kit", () => {
    const eager = readFileSync(EAGER, "utf8");

    expect(eager).toContain("All seven are required.");
    expect(eager).toContain("A partial kit is the finding");
  });

  it("frames the risk shift that makes the kit necessary", () => {
    const eager = readFileSync(EAGER, "utf8");
    const reference = readFileSync(REFERENCE, "utf8");

    expect(flat(eager)).toContain(
      "**prove we rebuilt the capability correctly**"
    );
    expect(reference).toContain(
      '"is upstream trustworthy?" to "did we actually rebuild what upstream did?"'
    );
  });

  it("draws the ownership boundary: in-house moves inherit, version bumps do not", () => {
    const eager = readFileSync(EAGER, "utf8");
    const reference = readFileSync(REFERENCE, "utf8");

    expect(eager).toContain(
      "**When the kit applies:** ownership moves in-house"
    );
    expect(eager).toContain("**When the kit does NOT apply:**");
    expect(flat(eager)).toContain(
      "**within its existing trust class**. Ownership does not move"
    );
    expect(eager).toContain(IN_HOUSE_CLASS);

    expect(reference).toContain(
      "## Applying the kit — and not over-applying it"
    );
    expect(reference).toContain("**Inherits the kit** — ownership moves:");
    expect(reference).toContain(
      "**Does not inherit the kit** — ownership does not move:"
    );
    expect(reference).toContain(
      "Over-applying the kit is a real failure, not a harmless excess of caution."
    );
  });

  it("keeps a bump that becomes a fork inside the kit", () => {
    const reference = readFileSync(REFERENCE, "utf8");

    expect(flat(reference)).toContain(
      "is an internalization wearing a bump's clothing, and it inherits the kit"
    );
  });

  it("allows only an explicit non-material justification as an escape hatch", () => {
    const eager = readFileSync(EAGER, "utf8");
    const reference = readFileSync(REFERENCE, "utf8");

    expect(flat(eager)).toContain(
      "**non-material**. Silence is not a justification."
    );
    expect(reference).toContain("## The non-material escape hatch");
    expect(flat(reference)).toContain(
      "a removal ticket with no kit and no stated reason is not ready to build"
    );
  });

  it("states the operator-facing promise the kit exists to keep", () => {
    const reference = readFileSync(REFERENCE, "utf8");

    expect(reference).toContain("## For the operator at the gate");
    expect(flat(reference)).toContain(
      "**explains how confidence will be rebuilt before the dependency is dropped**"
    );
  });

  it("documents the uniform six-agent enforcement gap", () => {
    const reference = readFileSync(REFERENCE, "utf8");

    expect(reference).toContain("## Agent parity");
    expect(flat(reference)).toContain(
      "Antigravity has no separate rules tree of its own and inherits the same content through the shared mirror"
    );
    expect(flat(reference)).toContain(
      "nothing enforces that a removal ticket actually carries the kit"
    );
  });
});

describe("confidence-rebuild kit wired into planning guidance", () => {
  it("adds a decomposition step for dependencies moving in-house", () => {
    const skill = readFileSync(DECOMPOSITION, "utf8");

    expect(skill).toContain(
      "### 4.6. Inherit the Confidence-Rebuild Kit When Ownership Moves In-House"
    );
    expect(skill).toContain("**inherits all seven acceptance criteria**");
    expect(skill).toContain("`dependency-internalization-kit`");
  });

  it("enumerates all seven criteria with their plain questions in the skill", () => {
    const skill = readFileSync(DECOMPOSITION, "utf8");
    for (const [name, question] of KIT_CRITERIA) {
      expect(flat(skill)).toContain(`**${name}** — ${question}`);
    }
  });

  it("makes the version-bump boundary explicit so the kit is not over-applied", () => {
    const skill = readFileSync(DECOMPOSITION, "utf8");

    expect(skill).toContain("**Do not over-apply the kit.**");
    expect(flat(skill)).toContain(
      "**within its existing trust class** does not move ownership, so it does not inherit the kit"
    );
    expect(flat(skill)).toContain(
      "a bump taken *as* a fork or declined *in favor of* owning the code, which is an internalization"
    );
  });

  it("requires an explicit non-material justification to skip the kit", () => {
    const skill = readFileSync(DECOMPOSITION, "utf8");

    expect(skill).toContain("**explicit non-material justification**");
    expect(skill).toContain("Silence is not a justification.");
    expect(skill).toContain(
      "unless it explicitly justifies why the dependency is non-material; a within-trust-class version bump does not carry the kit"
    );
  });
});

describe("dependency-internalization ticket fixture", () => {
  it("declares the ownership move and that the dependency is material", () => {
    const ticket = readFileSync(INTERNALIZATION_FIXTURE, "utf8");

    expect(ticket).toContain("**Move:** removed and reimplemented in-house.");
    expect(ticket).toContain(
      `**Trust class after the move:** ${IN_HOUSE_CLASS}`
    );
    expect(ticket).toContain("**Material?** Yes.");
    expect(ticket).toContain(
      "The confidence-rebuild kit is inherited in full."
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

  it("names a real corpus rather than hand-written examples", () => {
    const ticket = readFileSync(INTERNALIZATION_FIXTURE, "utf8");

    expect(ticket).toContain(
      "Given the 12,400 published titles already in the content table"
    );
  });

  it("runs conformance differentially while the dependency is still installed", () => {
    const ticket = readFileSync(INTERNALIZATION_FIXTURE, "utf8");

    expect(ticket).toContain(
      "Given slugify is still installed during this change"
    );
    expect(ticket).toContain("the outputs match on every title");
  });

  it("treats coverage as a gap list rather than a percentage", () => {
    const ticket = readFileSync(INTERNALIZATION_FIXTURE, "utf8");

    expect(ticket).toContain("rather than a coverage percentage");
  });

  it("names concrete rollback conditions and what we roll back to", () => {
    const ticket = readFileSync(INTERNALIZATION_FIXTURE, "utf8");

    expect(ticket).toContain("Then we reinstall slugify at the pinned version");
  });
});

describe("version-bump ticket fixture", () => {
  it("stays inside its existing trust class", () => {
    const ticket = readFileSync(BUMP_FIXTURE, "utf8");

    expect(ticket).toContain("**Move:** none. Version bump only.");
    expect(flat(ticket)).toContain("unchanged before and after this bump");
  });

  it("does NOT carry the confidence-rebuild kit", () => {
    const ticket = readFileSync(BUMP_FIXTURE, "utf8");

    expect(flat(ticket)).toContain(
      "the confidence-rebuild kit does **not** apply"
    );

    // The negative proof: none of the seven criteria appear as acceptance
    // criteria on an ordinary bump. Scenario titles are checked rather than
    // free prose, because the ticket names the kit once to explain its absence.
    for (const [name] of KIT_CRITERIA) {
      expect(ticket).not.toContain(`Scenario: ${name}`);
    }
    expect(ticket.split("Scenario:").length - 1).toBe(2);
  });

  it("says why over-applying the kit here would be wrong", () => {
    const ticket = readFileSync(BUMP_FIXTURE, "utf8");

    expect(flat(ticket)).toContain(
      "would be over-application — no capability was rebuilt"
    );
  });

  it("keeps the lightweight bar the trust class already sets", () => {
    const ticket = readFileSync(BUMP_FIXTURE, "utf8");

    expect(flat(ticket)).toContain(
      "our unit tests over the wrapped behavior, re-read at every upgrade"
    );
    expect(ticket).toContain(
      "Then they pass unchanged, with no new fixtures added"
    );
  });
});
