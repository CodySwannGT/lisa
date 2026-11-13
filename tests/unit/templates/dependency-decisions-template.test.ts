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
 * Read the governed dependency decision-record scaffold that `lisa apply`
 * seeds into every host project.
 * @returns The template file contents.
 */
async function readTemplate(): Promise<string> {
  return await readFile(TEMPLATE_PATH, "utf8");
}

describe("dependency decisions create-only template", () => {
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

  it("shows an honest gap in place via a half-filled entry", async () => {
    const template = await readTemplate();

    expect(template).toContain(
      "### sharp (EXAMPLE — an entry still being filled in)"
    );
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
