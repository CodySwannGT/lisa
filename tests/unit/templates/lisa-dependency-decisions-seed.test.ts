import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lisa's own filled-in dependency decision record — the dogfooded counterpart
 * to the blank scaffold in `all/create-only/.lisa/DEPENDENCY_DECISIONS.md`.
 */
const SEED_PATH = path.join(process.cwd(), ".lisa", "DEPENDENCY_DECISIONS.md");

/** Heading of the trailing section that holds every dependency entry. */
const RECORDS_HEADING = "## Records";

/** The reserved marker for a field nobody has decided yet. */
const GAP_MARKER = "_Not yet decided_";

/**
 * The umbrella follow-up ticket that carries every open gap in the seeded
 * record. A gap with no tracked work is policy debt hiding in a document.
 */
const GAP_TICKET = "#1918";

/**
 * The nine field labels, in the order the create-only template fixes. The seed
 * must speak the same shape so both files stay mechanically appendable.
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
 * The six trust classes defined by the governed reference rule. Every entry's
 * trust-basis field must name exactly one of them, because an unclassifiable
 * dependency is one nobody has thought about.
 */
const TRUST_CLASSES = [
  "mature ecosystem primitive",
  "fast-moving standard implementation",
  "build/development tool",
  "runtime-critical service client",
  "thin wrapper suitable for in-house ownership",
  "temporary/experimental dependency",
] as const;

/**
 * Read Lisa's seeded dependency decision record.
 * @returns The seeded file contents.
 */
async function readSeed(): Promise<string> {
  return await readFile(SEED_PATH, "utf8");
}

/**
 * Split the trailing `## Records` section into one text block per entry.
 * @param seed The seeded file contents.
 * @returns Each entry's heading text paired with its body.
 */
function readEntries(seed: string): readonly {
  readonly name: string;
  readonly body: string;
  readonly flattened: string;
}[] {
  const records = seed.slice(seed.indexOf(`\n${RECORDS_HEADING}`));

  return records
    .split(/^### /m)
    .slice(1)
    .map(block => {
      const newline = block.indexOf("\n");

      return {
        name: block.slice(0, newline),
        body: block.slice(newline),
        // Markdown wraps prose across lines, so phrase matching needs the
        // entry flattened to single-spaced text first.
        flattened: block.slice(newline).replace(/\s+/g, " "),
      };
    });
}

describe("Lisa's seeded dependency decision records", () => {
  it("keeps Records as the final section so entries stay appendable", async () => {
    const seed = await readSeed();

    const sectionHeadings: readonly string[] = seed.match(/^## .+$/gm) ?? [];

    expect(sectionHeadings[sectionHeadings.length - 1]).toBe(RECORDS_HEADING);
  });

  it("inventories Lisa's material dependencies rather than the whole lockfile", async () => {
    const entries = readEntries(await readSeed());

    // A dozen-ish well-chosen material dependencies is the bar: enough to cover
    // every owned capability, few enough that a human will actually read it.
    expect(entries.length).toBeGreaterThanOrEqual(12);
    expect(entries.length).toBeLessThanOrEqual(30);
  });

  it("covers the dependencies that ship inside the published CLI", async () => {
    const names = readEntries(await readSeed()).map(entry => entry.name);

    // These run on other people's machines and edit their repositories, so a
    // seed that skipped one would be missing the highest-exposure decisions.
    for (const runtimeDependency of [
      "commander",
      "fs-extra",
      "js-yaml",
      "@decimalturn/toml-patch",
    ]) {
      expect(names).toContain(runtimeDependency);
    }
  });

  it("gives every entry all nine fields in the template's order", async () => {
    const entries = readEntries(await readSeed());

    for (const entry of entries) {
      const positions = FIELD_LABELS.map(label => entry.body.indexOf(label));

      expect(
        positions.every(position => position >= 0),
        `${entry.name} is missing a required field`
      ).toBe(true);
      expect(
        positions.every(
          (position, index) => index === 0 || position > positions[index - 1]!
        ),
        `${entry.name} lists its fields out of order`
      ).toBe(true);
    }
  });

  it("names exactly one valid trust class per entry", async () => {
    const entries = readEntries(await readSeed());

    for (const entry of entries) {
      const named = TRUST_CLASSES.filter(trustClass =>
        entry.flattened.includes(`**${trustClass}**`)
      );

      expect(named, `${entry.name} names no valid trust class`).not.toEqual([]);
    }
  });

  it("never leaves a field silently blank", async () => {
    const entries = readEntries(await readSeed());

    for (const entry of entries) {
      for (const label of FIELD_LABELS) {
        const start = entry.body.indexOf(label) + label.length;
        const nextField = entry.body.indexOf("\n- **", start);
        // The final field has no following bullet, so it runs to end of entry.
        const end = nextField === -1 ? entry.body.length : nextField;
        const value = entry.body.slice(start, end).trim();

        expect(value, `${entry.name} leaves ${label} blank`).not.toBe("");
      }
    }
  });

  it("routes every unresolved field to the umbrella follow-up ticket", async () => {
    const seed = await readSeed();

    expect(seed).toContain(
      `**Every \`${GAP_MARKER}\` field in this file is tracked work: ${GAP_TICKET}.**`
    );
  });

  it("records no-successor CDK cleanup while retaining successor sweep as fallback", async () => {
    const entry = readEntries(await readSeed()).find(
      candidate => candidate.name === "aws-cdk-lib"
    );
    expect(entry?.flattened).toContain("detached reaper");
    expect(entry?.flattened).not.toContain("SIGKILL successor recovery");
  });
});
