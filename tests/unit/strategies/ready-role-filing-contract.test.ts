/**
 * Contract coverage for work unit D — closing the non-ready filing paths.
 *
 * The originating failure: an agent closed a non-reproducing ticket, filed a
 * real defect it found beside it, and left the new ticket sitting. Filing
 * without the ready role is an incomplete handoff — no other agent will ever
 * pick it up.
 *
 * The guidance prose in the ready-role-filing and claim-time-guards rules and
 * in the skills that cite them is reviewed, not pinned. What stays pinned is
 * structural or machine-read: both rules stay reachable from the eager rule
 * index, and the `[lisa-human-gate]` marker — which
 * `block-direct-issue-create.sh` parses — stays in the documents agents follow
 * when they file or sweep held work.
 *
 * Every assertion runs against both the skill/rule source (`plugins/src/...`)
 * and the generated artifact (`plugins/lisa/...`).
 * @module tests/unit/strategies/ready-role-filing-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Source + generated plugin roots for the base plugin. */
const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The marker `block-direct-issue-create.sh` reads to recognise a human hold. */
const HUMAN_GATE_MARKER = "[lisa-human-gate]";

/**
 * Read a file relative to a plugin root.
 * @param root plugin root directory
 * @param rel path relative to that root
 * @returns file contents
 */
const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("ready-role-filing rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/ready-role-filing.md"
      );
    });

    it("carries the human-gate marker the filing guard parses", () => {
      expect(read(root, "rules/reference/ready-role-filing.md")).toContain(
        HUMAN_GATE_MARKER
      );
    });
  });
});

describe("claim-time-guards rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/claim-time-guards.md"
      );
    });
  });
});

describe("repair-intake sweeps ungated non-ready filings", () => {
  describe.each(ROOTS)("%s", root => {
    it("carries the human-gate marker the filing guard parses", () => {
      expect(read(root, "skills/lisa-repair-intake/SKILL.md")).toContain(
        HUMAN_GATE_MARKER
      );
    });
  });
});
