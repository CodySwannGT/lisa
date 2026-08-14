import { readFile, readdir } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every lane that ships templates. Kept explicit rather than globbed so a new
 * lane has to be added here deliberately, with its headers checked.
 */
const LANES = [
  "all",
  "cdk",
  "expo",
  "harper-fabric",
  "nestjs",
  "npm-package",
  "phaser",
  "rails",
  "typescript",
] as const;

/**
 * The header each strategy's templates must carry, minus the comment prefix.
 *
 * These sentences are the file's OWNERSHIP CONTRACT, and getting them backwards
 * has a cost in both directions:
 *
 * - A `create-only` file that claims it will be overwritten deters durable,
 *   correct edits to a file the consuming repo owns. That is issue #2538: a fix
 *   closing a live vacuous green in a downstream `ci.yml` was declined for an
 *   hour because the header said it would revert. It would not have.
 * - A `copy-overwrite` file that reads as editable silently loses downstream
 *   hardening on the next sync — already observed on a hook.
 */
const HEADERS = {
  "create-only": [
    "Seeded by Lisa on first setup — this file is YOURS.",
    "Lisa will not overwrite it. (copy-overwrite assets ARE replaced each run.)",
  ],
  "copy-overwrite": [
    "This file is managed by Lisa and IS replaced on each `lisa` run.",
    "Do not edit directly — durable changes belong upstream in Lisa.",
  ],
} as const;

/** The two copy strategies whose headers this file governs. */
type Strategy = keyof typeof HEADERS;

/** The strategies, in the order the report lists them. */
const STRATEGIES = Object.keys(HEADERS) as Strategy[];

/**
 * The retired header. It asserted the `copy-overwrite` contract on BOTH lanes,
 * which is what made it false for half of them.
 */
const RETIRED = "changes will be overwritten on the next `lisa` run";

/**
 * Every file under one lane/strategy tree.
 * @param lane - Project-type lane.
 * @param strategy - Copy strategy directory.
 * @returns Absolute paths, or an empty list when the tree does not exist.
 */
const templateFiles = async (
  lane: string,
  strategy: Strategy
): Promise<string[]> => {
  const root = path.join(process.cwd(), lane, strategy);
  try {
    const entries = await readdir(root, {
      recursive: true,
      withFileTypes: true,
    });
    return entries
      .filter(entry => entry.isFile())
      .map(entry => path.join(entry.parentPath, entry.name));
  } catch {
    return [];
  }
};

/**
 * Files that carry SOME ownership header, paired with their contents.
 *
 * Absence is deliberately not an assertion here: many templates are JSON,
 * `.nvmrc`, or `.gitkeep` files that cannot hold a comment at all. The claim
 * under test is that a header, where one exists, tells the truth about its
 * lane.
 * @param strategy - Copy strategy to collect for.
 * @returns Repo-relative path and contents for each headered template.
 */
const headeredTemplates = async (
  strategy: Strategy
): Promise<{ relativePath: string; contents: string }[]> => {
  const collected: { relativePath: string; contents: string }[] = [];
  for (const lane of LANES) {
    for (const file of await templateFiles(lane, strategy)) {
      const contents = await readFile(file, "utf8");
      if (
        !contents.includes("managed by Lisa") &&
        !contents.includes("YOURS")
      ) {
        continue;
      }
      collected.push({
        relativePath: path.relative(process.cwd(), file),
        contents,
      });
    }
  }
  return collected;
};

describe("template ownership headers state their real contract (#2538)", () => {
  for (const strategy of STRATEGIES) {
    describe(strategy, () => {
      it("carries the header for its own strategy, on every lane", async () => {
        const templates = await headeredTemplates(strategy);
        // A lane rename or a moved tree would empty this silently, and the
        // test would then pass by testing nothing.
        expect(templates.length).toBeGreaterThan(10);

        const offenders = templates
          .filter(
            ({ contents }) =>
              !HEADERS[strategy].every(line => contents.includes(line))
          )
          .map(({ relativePath }) => relativePath);

        expect(offenders).toEqual([]);
      });

      it("never carries the OTHER strategy's header", async () => {
        const other = STRATEGIES.find(name => name !== strategy) as Strategy;
        const templates = await headeredTemplates(strategy);

        // The distinguishing sentence, not the shared boilerplate: both
        // headers name Lisa, so only the contract clause discriminates.
        const [otherClaim] = HEADERS[other];
        const offenders = templates
          .filter(({ contents }) => contents.includes(otherClaim))
          .map(({ relativePath }) => relativePath);

        expect(offenders).toEqual([]);
      });

      it("no longer carries the retired one-size-fits-both warning", async () => {
        const offenders = (await headeredTemplates(strategy))
          .filter(({ contents }) => contents.includes(RETIRED))
          .map(({ relativePath }) => relativePath);

        expect(offenders).toEqual([]);
      });
    });
  }

  it("gives the two lanes headers that actually differ", async () => {
    // Guards the guard: if both entries were edited to the same text, every
    // assertion above would still pass while distinguishing nothing.
    expect(HEADERS["create-only"]).not.toEqual(HEADERS["copy-overwrite"]);
    expect(HEADERS["create-only"][0]).not.toBe(HEADERS["copy-overwrite"][0]);
  });
});
