/**
 * The one input that tells Lisa's `Work-Item:` reader apart from git's (#3747).
 *
 * Two definitions of "a `Work-Item:` trailer" are in use across this fleet.
 * Git's reads only a message's FINAL contiguous block of `Key: value` lines;
 * Lisa's reads the whole message with the prefix anchored at column zero.
 * They agree on every well-formed message, which is exactly the problem: a
 * checker exercised only against those passes under either, and three separate
 * audits shipped confident, specific, wrong findings before anyone noticed.
 *
 * **A trailer sitting ABOVE a non-trailer line is the only input that
 * separates them**, so it is pinned here — and pinned against a real
 * `git interpret-trailers` run rather than a description of one, because the
 * claim "git would miss this" is the claim under test. Measured over non-merge
 * commits that name an item: git's parser found none on 47 of 51 on a single
 * multi-agent branch, and missed 477 of 1,730 over full default-branch history.
 *
 * See the `work-item-trailer-definition` rule for why Definition B wins.
 */

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { GIT_BIN } from "../../support/git-executable.js";
import { workItemRef } from "../../../all/copy-overwrite/scripts/check-orphaned-branches.mjs";
import {
  declaredWorkItemNumbers,
  soleWorkItem,
  workItemLines,
} from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";

const REPOSITORY = "acme/code";

/** The tracker contract `soleWorkItem` canonicalizes against. */
const CONTRACT = Object.freeze({
  provider: "github",
  repository: REPOSITORY,
});

/**
 * The fleet's own commit shape: the trailer, then boilerplate, then attribution.
 *
 * Written out literally rather than assembled from the module under test. A
 * fixture built from the reader's own constants would pass for whatever the
 * reader happened to accept, and what this pins is the shape real commits have.
 */
const NON_CONTIGUOUS = [
  "feat: land the change",
  "",
  `Work-Item: ${REPOSITORY}#42`,
  "",
  "🤖 Generated with Claude Code",
  "",
  "Co-Authored-By: Claude <noreply@anthropic.com>",
  "",
].join("\n");

/**
 * What git's own trailer parser makes of a message.
 *
 * Executed, not described. `git interpret-trailers --parse` needs no
 * repository, so this is the same parser `%(trailers:key=Work-Item)` uses,
 * answering for itself.
 * @param message The commit message to parse.
 * @returns The trailer lines git recognises.
 */
const gitTrailers = (message: string): string[] => {
  const result = boundedSpawnSync({
    label: "git interpret-trailers --parse",
    command: GIT_BIN,
    args: ["interpret-trailers", "--parse"],
    input: message,
  });
  if (result.error || result.status !== 0)
    throw new Error(`git interpret-trailers unavailable: ${result.status}`);
  return result.stdout.split("\n").filter(line => line.trim() !== "");
};

describe("the input that distinguishes the two trailer definitions (#3747)", () => {
  // The control. Without it "Lisa reads this" is a fact about one reader and
  // says nothing about why a second reader may not be written.
  it("git's parser does NOT see a trailer above a non-trailer line", () => {
    const seen = gitTrailers(NON_CONTIGUOUS);

    expect(seen.some(line => line.startsWith("Work-Item:"))).toBe(false);
    expect(seen).toContain("Co-Authored-By: Claude <noreply@anthropic.com>");
  });

  it("the authoritative reader reports it as present", () => {
    expect(workItemLines(NON_CONTIGUOUS)).toEqual([`${REPOSITORY}#42`]);
  });

  it("resolves it to the one canonical reference", () => {
    expect(soleWorkItem(NON_CONTIGUOUS, CONTRACT, "commit message")).toBe(
      `${REPOSITORY}#42`
    );
  });

  it("counts it as a declaration in the shipped-work audit", () => {
    expect(declaredWorkItemNumbers(NON_CONTIGUOUS, REPOSITORY)).toEqual([42]);
  });

  // A git stand-in that answers each `--format` the way git would, so this
  // separates the two definitions rather than the two argument lists. Asking
  // for `%(trailers…)` here yields what git itself yields above: no Work-Item.
  // The branch name carries no number, so a reader that misses the trailer
  // returns undefined and cannot pass by falling back.
  it("finds it in an orphaned-branch verdict, as a trailer and not an inference", () => {
    const fakeGit = (_command: string, args: readonly string[]) => {
      if (args.some(arg => arg.includes("%(trailers")))
        return gitTrailers(NON_CONTIGUOUS)
          .filter(line => line.startsWith("Work-Item:"))
          .join("\n");
      return NON_CONTIGUOUS.trimEnd();
    };
    const found = workItemRef(
      "chore/no-number-here",
      "main",
      "origin",
      fakeGit
    );

    expect(found).toEqual({ ref: "42", refSource: "trailer" });
  });
});

/**
 * Column zero, which is the half of Definition B that is easy to lose.
 *
 * The two Lisa-side readers had drifted on exactly this axis — one anchored at
 * column zero, the other tolerating leading whitespace — and the looser form
 * matches the context line of a verbose commit's own diff. Measured over full
 * default-branch history: 2,059 trailer lines at column zero, ZERO indented, so
 * the anchor costs no real input.
 */
describe("column zero is part of the definition (#3747)", () => {
  it("refuses an indented trailer", () => {
    const indented = `feat: x\n\n  Work-Item: ${REPOSITORY}#42\n`;

    expect(workItemLines(indented)).toEqual([]);
    expect(declaredWorkItemNumbers(indented, REPOSITORY)).toEqual([]);
  });

  it("refuses a trailer quoted inside a diff or a comment", () => {
    for (const line of [
      `+Work-Item: ${REPOSITORY}#42`,
      `-Work-Item: ${REPOSITORY}#42`,
      ` Work-Item: ${REPOSITORY}#42`,
      `# Work-Item: ${REPOSITORY}#42`,
    ]) {
      expect(workItemLines(`feat: x\n\n${line}\n`), line).toEqual([]);
    }
  });
});

/**
 * The layering the readers must NOT converge.
 *
 * `workItemLines` sees every value; the shape filter lives above it. Moving the
 * filter down would make a malformed trailer invisible instead of refused —
 * the gate would report "no Work-Item trailer anywhere" about a message
 * carrying exactly one, which is the #2672 failure one layer down.
 */
describe("a malformed value is seen, then refused (#3747)", () => {
  const URL_FORM = `feat: x\n\nWork-Item: https://github.com/${REPOSITORY}/issues/42\n`;

  it("the reader sees the value the caller will reject", () => {
    expect(workItemLines(URL_FORM)).toEqual([
      `https://github.com/${REPOSITORY}/issues/42`,
    ]);
  });

  it("the layer above refuses it by name, never as an absence", () => {
    expect(() => soleWorkItem(URL_FORM, CONTRACT, "commit message")).toThrow(
      /expected owner\/repo#123/
    );
  });

  it("the declaration audit drops it, and says nothing about the gate's verdict", () => {
    expect(declaredWorkItemNumbers(URL_FORM, REPOSITORY)).toEqual([]);
  });
});
