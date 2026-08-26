/**
 * The one direct-merge exception is narrow enough to bypass only a proven
 * vendor cap, never an in-progress bot review or an unmet human approval.
 * @module tests/unit/strategies/drive-pr-admin-bypass-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

describe.each(ROOTS)("%s drive-pr admin bypass", root => {
  const skill = readFileSync(
    path.resolve(root, "skills/lisa-drive-pr-to-merge/SKILL.md"),
    "utf8"
  );

  it("requires an explicit live vendor-cap description", () => {
    expect(skill).toContain("gh pr checks <pr> --json name,state,description");
    expect(skill).toMatch(/merely pending or queued.*not proof/is);
    expect(skill).not.toMatch(
      /Review rate limited` \(or stays pending\/queued because of the vendor cap\)/
    );
  });

  it("proves the current human-approval policy before admin merge", () => {
    expect(skill).toMatch(
      /human-approval requirement is demonstrably satisfied/i
    );
    expect(skill).toMatch(/reviewDecision == APPROVED/);
    expect(skill).toMatch(/non-dismissed approval count/i);
    expect(skill).toMatch(
      /required count is zero, record that live\s+policy result/is
    );
    expect(skill).toMatch(/`REVIEW_REQUIRED`.*`null` never stand/is);
  });
});
