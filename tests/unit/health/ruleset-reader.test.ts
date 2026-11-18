/**
 * The ruleset reader `lisa health` and the read-back of
 * `lisa controls protect` share (CodySwannGT/lisa#4993).
 *
 * It takes a list for the whole list exactly when the shipped reconciler
 * does: when the page it asked for did not come back full. It used to refuse
 * anything past thirty-two rulesets, which the reconciler reads without
 * complaint, so the two disagreed about every repository in between. Reading
 * more rulesets must not mean starting more requests at once than it ever
 * did, so the details are read thirty-two at a time.
 */
import { describe, expect, it } from "vitest";

import {
  rulesetReaderOver,
  type RulesetJsonReader,
} from "../../../src/health/ruleset-inspection.js";

const LIST = "repos/example-owner/example-repo/rulesets?per_page=100";

/** What one stand-in platform recorded. */
interface Recorded {
  /** The paths asked for, in order. */
  readonly paths: string[];
  /** The most detail reads that were under way at one time. */
  mostAtOnce: number;
}

/**
 * A stand-in for the platform that holds some rulesets and answers each
 * detail read a moment later, so reads started together overlap.
 * @param count - How many rulesets it holds
 * @returns The read function and what it recorded
 */
function platform(count: number): {
  readonly readJson: RulesetJsonReader;
  readonly recorded: Recorded;
} {
  const recorded: Recorded = { paths: [], mostAtOnce: 0 };
  const state = { underWay: 0 };
  const readJson: RulesetJsonReader = async argv => {
    const path = String(argv.at(-1));
    const id = Number(path.split("/").at(-1));
    recorded.paths.push(path);
    if (path === LIST) {
      return Array.from({ length: count }, (_, index) => ({ id: index + 1 }));
    }
    state.underWay += 1;
    recorded.mostAtOnce = Math.max(recorded.mostAtOnce, state.underWay);
    await new Promise(resolve => {
      setTimeout(resolve, 1);
    });
    state.underWay -= 1;
    return {
      name: `ruleset ${String(count - id).padStart(3, "0")}`,
      target: "branch",
      enforcement: "active",
      conditions: {},
      rules: [],
    };
  };
  return { readJson, recorded };
}

/**
 * Read the rulesets of the stand-in repository.
 * @param readJson - The read function
 * @returns The rulesets
 */
async function read(readJson: RulesetJsonReader): Promise<readonly string[]> {
  const rulesets = await rulesetReaderOver(readJson)(
    "example-owner",
    "example-repo",
    process.cwd(),
    1000,
    new AbortController().signal
  );
  return rulesets.map(ruleset => ruleset.name);
}

describe("the shared ruleset reader", () => {
  it.each([33, 40, 99])(
    "reads every one of %i rulesets, sorted by name",
    async count => {
      const { readJson, recorded } = platform(count);

      const names = await read(readJson);

      expect(names).toHaveLength(count);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
      expect(recorded.paths).toHaveLength(count + 1);
    }
  );

  it("refuses a list that came back as a full page, before reading any ruleset", async () => {
    const { readJson, recorded } = platform(100);

    await expect(read(readJson)).rejects.toThrow(
      /full page of 100, so there may be more rulesets than were read/u
    );
    expect(recorded.paths).toEqual([LIST]);
  });

  it("refuses an answer that is not a list", async () => {
    await expect(
      read(() => Promise.resolve({ message: "no" }))
    ).rejects.toThrow(/was not a list/u);
  });

  it("never has more than thirty-two detail reads under way at once", async () => {
    const { readJson, recorded } = platform(99);

    await read(readJson);

    expect(recorded.mostAtOnce).toBe(32);
  });

  it("still reads a short list all at once", async () => {
    const { readJson, recorded } = platform(5);

    await read(readJson);

    expect(recorded.mostAtOnce).toBe(5);
  });
});
