/**
 * Review history is an event log. Merge/repair decisions consume the latest
 * non-dismissed event per reviewer, not any approval that ever existed.
 * @module tests/unit/strategies/latest-review-per-reviewer-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

describe.each(ROOTS)("%s effective PR reviews", root => {
  const drive = readFileSync(
    path.resolve(root, "skills/lisa-drive-pr-to-merge/SKILL.md"),
    "utf8"
  );
  const repair = readFileSync(
    path.resolve(root, "skills/lisa-repair-intake/SKILL.md"),
    "utf8"
  );

  it("uses each reviewer's latest non-dismissed review", () => {
    expect(drive).toMatch(/latest non-dismissed review per reviewer/i);
    expect(drive).toContain('select(.state != "DISMISSED")');
    expect(drive).toContain("sort_by(.submitted_at, .id)");
    expect(drive).toContain(".[$review.user.login] = $review");
    expect(repair).toMatch(/latest non-dismissed review\s+per reviewer/i);
  });

  it("does not let an old approval override a later change request", () => {
    expect(drive).toMatch(/older approval.*later `CHANGES_REQUESTED`/is);
    expect(repair).toMatch(/older approval.*later `CHANGES_REQUESTED`/is);
  });
});
