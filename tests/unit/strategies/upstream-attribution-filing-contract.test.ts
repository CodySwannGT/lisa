/**
 * Machine-read contract for the automatic upstream Lisa filing loop (#1583).
 *
 * lisa-persist-learning's `handoff-upstream` disposition tells the agent what
 * to write into an upstream filing. Two parts of it are read by shipped code
 * (`src/core/upstream-attribution-body.ts`): the
 * `[lisa-upstream-attribution] key=<root-cause-key>` dedupe marker, and the
 * closed vocabulary of failure classes the body builder accepts. Those are
 * asserted across the canonical source and every checked-in runtime
 * projection. The surrounding prose is guidance and is reviewed, not pinned
 * (#4867).
 * @module tests/unit/strategies/upstream-attribution-filing-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

describe.each(SKILL_ROOTS)("upstream filing contract (%s)", skillRoot => {
  const skill = read(`${skillRoot}/lisa-persist-learning/SKILL.md`);
  const handoff = skill.slice(
    skill.indexOf("### `handoff-upstream`"),
    skill.indexOf("### `persist`")
  );

  it("files with the attribution marker the body builder parses", () => {
    expect(handoff).toContain(
      "[lisa-upstream-attribution] key=<root-cause-key>"
    );
  });

  it("names every failure class the body builder accepts", () => {
    for (const failureClass of [
      "access-control-failure",
      "agent-parity-regression",
      "configuration-regression",
      "data-integrity-failure",
      "dependency-regression",
      "generated-artifact-regression",
      "installation-regression",
      "observability-gap",
      "pagination-truncation",
      "performance-regression",
      "public-data-exposure",
      "release-regression",
      "runtime-regression",
      "stale-artifact-overwrite",
      "test-coverage-gap",
      "validation-gap",
      "workflow-contract-violation",
    ]) {
      expect(handoff).toContain(`\`${failureClass}\``);
    }
  });
});
