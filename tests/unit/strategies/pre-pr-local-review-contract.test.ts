/** Submission owns local review; callers can reuse evidence for the current diff. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = [
  "plugins/src/base",
  "plugins/lisa",
  "plugins/lisa-agy",
  "plugins/lisa-copilot",
  "plugins/lisa-cursor",
  "plugins/lisa/.codex-plugin",
];

/**
 * Read the skill installed for this agent.
 * @param root - Agent plugin directory.
 * @param name - Skill name.
 * @returns Installed skill text.
 */
function skill(root: string, name: string): string {
  return readFileSync(path.resolve(root, "skills", name, "SKILL.md"), "utf8");
}

describe.each(ROOTS)("%s review before submission", root => {
  const submit = skill(root, "lisa-git-submit-pr");
  const implement = skill(root, "lisa-implement");

  it("reviews before pushing by default", () => {
    expect(submit).toContain("default `pending`");
    const review = submit.indexOf("run `lisa-review-local`");
    expect(review).toBeGreaterThan(-1);
    expect(review).toBeLessThan(submit.indexOf("**Push**"));
  });

  it("reuses only completed review evidence covering the current diff", () => {
    expect(submit).toContain(
      "completed review result covering the current branch diff"
    );
    expect(submit).toContain("Unless `local_review=done` has current evidence");
    expect(implement).toContain(
      "otherwise omit the hint so submit-pr runs the review"
    );
  });

  it("centralizes review and push in submission", () => {
    expect(implement).toContain(
      "Delegate local review and push to `lisa-git-submit-pr`"
    );
    expect(implement).toContain("Do not push separately before that review");
    expect(implement).not.toContain("Invoke `lisa-review-local`");
  });

  it("keeps review independent of vendor availability and reports its limits", () => {
    expect(submit).toContain("regardless of third-party reviewer availability");
    expect(submit).toContain("*self-reviewed*");
    expect(submit).toContain(
      "does not satisfy the ruleset-required third-party review check"
    );
  });

  it("does not turn unavailable review into reusable passing evidence", () => {
    expect(submit).toContain("local review unavailable");
    expect(submit).toContain("do not pass `local_review=done`");
    expect(submit).toContain("An unavailable review is not a passing review");
  });
});
