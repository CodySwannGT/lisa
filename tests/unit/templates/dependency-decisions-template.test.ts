import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "all",
  "create-only",
  ".lisa",
  "DEPENDENCY_DECISIONS.md"
);

/** Heading of the trailing section that holds every dependency entry. */
const RECORDS_HEADING = "## Records";

/** The bullet every entry must open with, ahead of the package name. */
const WHY_LABEL = "Why we keep it";

/**
 * The nine field labels, in the order every entry must use. Each leads with the
 * operator's question and keeps the technical term in parentheses, so the
 * record reads as decisions rather than package-manager trivia.
 */
const FIELD_LABELS = [
  "**Why we keep it:**",
  "**What it is (dependency):**",
  "**What it does for us (owned capability):**",
  "**Why we believe it's safe (trust basis):**",
  "**What breaks if this is compromised (exposure):**",
  "**What it would take to replace (replacement cost):**",
  "**What would catch a bad update (detection evidence):**",
  "**Who owns this and how often we recheck (owner / review cadence):**",
  "**Last reviewed:**",
] as const;

/**
 * Read the governed dependency decision-record scaffold that `lisa apply`
 * seeds into every host project.
 * @returns The template file contents.
 */
async function readTemplate(): Promise<string> {
  return await readFile(TEMPLATE_PATH, "utf8");
}

describe("dependency decisions create-only template", () => {
  it("carries the versioned scaffold marker and title", async () => {
    const template = await readTemplate();

    expect(template).toContain("# Dependency Decisions");
    expect(template).toContain("<!-- lisa-dependency-decisions:v1 -->");
  });

  it("names every required record field", async () => {
    const template = await readTemplate();

    for (const label of FIELD_LABELS) {
      expect(template).toContain(label);
    }
  });

  it("leads every entry with the plain-language why, not the version range", async () => {
    const template = await readTemplate();

    // Each entry heading must be followed by the "why" bullet first — the file
    // promises entries "start with a plain-language explanation".
    const entryOpenings = [
      ...template.matchAll(/^### .+\n\n- \*\*(.+?):\*\*/gm),
    ].map(match => match[1]);

    // The template block plus both seeded example entries.
    expect(entryOpenings).toEqual(Array<string>(3).fill(WHY_LABEL));
  });

  it("ships a copyable entry template and a records section", async () => {
    const template = await readTemplate();

    expect(template).toContain("## Entry template");
    expect(template).toContain(RECORDS_HEADING);
    expect(template).toContain("### <dependency name>");
  });

  it("explains what each field means so an operator can fill one in", async () => {
    const template = await readTemplate();

    expect(template).toContain("## What each field means");
    expect(template).toContain("## How to use this file");
  });

  it("tells the operator when to escalate rather than only how to read", async () => {
    const template = await readTemplate();

    expect(template).toContain("## When to escalate");
    expect(template).toContain("**Nothing would catch a bad update.**");
    expect(template).toContain("**The review is older than the dependency.**");
    expect(template).toContain("**Nobody is behind it.**");
    expect(template).toContain(
      "An entry full of `_Not yet decided_` is not itself an escalation"
    );
  });

  it("leads the operator with the plain-language why and the detection gap", async () => {
    const template = await readTemplate();

    expect(template).toContain(
      "This file is the project's record of **why we keep each material dependency**."
    );
    expect(template).toContain(
      "the specific check\n  that would **fail** if an update"
    );
    expect(template).toContain(
      'If the honest answer is "nothing would catch it",'
    );
  });

  it("keeps the highest-stakes example field in plain language", async () => {
    const template = await readTemplate();

    expect(template).toContain(
      "Warning sign: if lint passes a change we know breaks a rule, the checking\n  has silently stopped working"
    );
  });

  it("never lets the worked example look freshly reviewed", async () => {
    const template = await readTemplate();

    // A hardcoded date would read as a recent review on any project applying
    // Lisa later, undercutting the keep/replace/escalate call.
    expect(template).toContain(
      "**Last reviewed:** _Not yet decided_ (example entry — never reviewed)"
    );
    expect(template).not.toMatch(/\*\*Last reviewed:\*\* \d{4}-\d{2}-\d{2}/);
  });

  it("shows an honest gap in place via a half-filled entry", async () => {
    const template = await readTemplate();

    expect(template).toContain(
      "### sharp (EXAMPLE — an entry still being filled in)"
    );
    expect(template).toContain(
      "**Why we believe it's safe (trust basis):** _Not yet decided_ — nobody has"
    );
    expect(template).toContain(
      "**What would catch a bad update (detection evidence):** _Not yet decided_ —"
    );
  });

  it("documents a stable appendable entry format so entries can be seeded mechanically", async () => {
    const template = await readTemplate();

    expect(template).toContain("### Entry format (stable, appendable)");
    expect(template).toContain(
      "Every entry is a level-3 heading (`### <name>`) followed by the nine field"
    );
    expect(template).toContain(
      "Nothing after `## Records` is guidance, so appending to the end of the file is"
    );
  });

  it("reserves an explicit marker for an undecided field so gaps are honest, not blank", async () => {
    const template = await readTemplate();

    expect(template).toContain("`_Not yet decided_`");
    expect(template).toContain("never leave a field blank and never guess");
  });

  it("keeps Records as the final section so appends are always safe", async () => {
    const template = await readTemplate();

    const sectionHeadings = template.match(/^## .+$/gm) ?? [];

    expect(sectionHeadings).toEqual([
      "## How to use this file",
      "## The rest of the dependency-ownership layer",
      "## When to escalate",
      "## What each field means",
      "## Entry template",
      RECORDS_HEADING,
    ]);
  });

  it("carries no host-project dependency inventory beyond the marked examples", async () => {
    const template = await readTemplate();

    // Entries are `###` headings inside the trailing `## Records` section —
    // that scoping is the contract a seeding script appends against. Both
    // seeded entries stay explicitly marked EXAMPLE so no host project ships
    // an unmarked claim about a dependency it may not even use.
    const records = template.slice(template.indexOf(`\n${RECORDS_HEADING}`));
    const entryHeadings = records.match(/^### .+$/gm) ?? [];

    expect(entryHeadings).toEqual([
      "### ESLint (EXAMPLE — a complete entry)",
      "### sharp (EXAMPLE — an entry still being filled in)",
    ]);
  });
});
