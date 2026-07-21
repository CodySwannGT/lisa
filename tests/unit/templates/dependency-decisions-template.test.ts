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

    expect(template).toContain("**Dependency:**");
    expect(template).toContain("**Why we keep it:**");
    expect(template).toContain("**Owned capability:**");
    expect(template).toContain("**Trust basis:**");
    expect(template).toContain("**Exposure:**");
    expect(template).toContain("**Replacement cost:**");
    expect(template).toContain("**Detection evidence:**");
    expect(template).toContain("**Owner / review cadence:**");
    expect(template).toContain("**Last reviewed:**");
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

  it("leads the operator with the plain-language why and the detection gap", async () => {
    const template = await readTemplate();

    expect(template).toContain(
      "This file is the project's record of **why we keep each material dependency**."
    );
    expect(template).toContain(
      "the specific check that would **fail** if an update"
    );
    expect(template).toContain('"nothing would catch it", write that down');
  });

  it("includes one worked example entry that is clearly marked as an example", async () => {
    const template = await readTemplate();

    expect(template).toContain(
      "### ESLint (EXAMPLE — replace with your own dependencies)"
    );
    expect(template).toContain("**The entry below is an EXAMPLE.**");
    expect(template).toContain("`eslint` `^9`");
    expect(template).toContain("**Last reviewed:** 2026-07-21");
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
      "## What each field means",
      "## Entry template",
      RECORDS_HEADING,
    ]);
  });

  it("carries no host-project dependency inventory beyond the marked example", async () => {
    const template = await readTemplate();

    // Entries are `###` headings inside the trailing `## Records` section —
    // that scoping is the contract a seeding script appends against.
    const records = template.slice(template.indexOf(`\n${RECORDS_HEADING}`));
    const entryHeadings = records.match(/^### .+$/gm) ?? [];

    expect(entryHeadings).toEqual([
      "### ESLint (EXAMPLE — replace with your own dependencies)",
    ]);
  });
});
