/**
 * Regression tests for repository governance contracts that intake issues
 * rely on during scheduled runs.
 *
 * Skill guidance prose is reviewed, not pinned. What stays pinned is the root
 * `CLAUDE.md` import line, which Claude Code reads to load `AGENTS.md`.
 *
 * @module tests/unit/governance-contracts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

describe("governance text contracts", () => {
  it("keeps root CLAUDE.md as a thin pointer to AGENTS.md", () => {
    expect(readFileSync(path.resolve("CLAUDE.md"), "utf8")).toBe(
      "@AGENTS.md\n"
    );
  });
});
