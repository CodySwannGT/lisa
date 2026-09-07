/**
 * A bespoke tracker write path skips the validation gates
 * (CodySwannGT/lisa#3663).
 *
 * The vendor write skills gate every item twice — pre-write validate at Phase
 * 5.5 and post-write verify at Phase 7 — and both phases delegate to the same
 * validator so the bar cannot drift. A consumer writing through its own script
 * enters neither phase, and the script's own read-back confirms the tracker
 * stored what was sent while asserting nothing about quality. Before this
 * contract shipped, no write skill said a word about that: the reproduction
 * grep returned zero hits in all three at commit 687ee7ba8.
 *
 * These are agent instructions, so the assertions cover the editable plugin
 * source and every regenerated per-agent copy — a phrase that survives in one
 * root and vanishes from another is a fan-out failure, not a formatting
 * difference.
 * @module tests/unit/strategies/bespoke-write-path-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONTRACT_TARGETS,
  matchesBespokePathSearch,
  missingPhrases,
  skillPaths,
} from "./bespoke-write-path-contract-helpers.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * Reads a repository-relative file.
 * @param relative - Path relative to the repository root.
 * @returns The file contents as UTF-8 text.
 */
function readRepoFile(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

describe("bespoke tracker write path contract", () => {
  for (const target of CONTRACT_TARGETS) {
    for (const relative of skillPaths(target.skill)) {
      it(`${relative} carries the ${target.kind} contract`, () => {
        expect(missingPhrases(readRepoFile(relative), target)).toEqual([]);
      });
    }
  }

  const writeTargets = CONTRACT_TARGETS.filter(
    target => target.kind === "write"
  );

  for (const target of writeTargets) {
    for (const relative of skillPaths(target.skill)) {
      it(`${relative} answers the bespoke-path search`, () => {
        expect(matchesBespokePathSearch(readRepoFile(relative))).toBe(true);
      });
    }
  }
});
