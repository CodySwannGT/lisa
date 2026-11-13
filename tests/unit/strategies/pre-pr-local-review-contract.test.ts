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
    const review = submit.indexOf("run `lisa-review-local`");
    expect(review).toBeGreaterThan(-1);
    expect(review).toBeLessThan(submit.indexOf("**Push**"));
  });

  it("centralizes review and push in submission", () => {
    expect(implement).toContain(
      "Delegate local review and push to `lisa-git-submit-pr`"
    );
    expect(implement).not.toContain("Invoke `lisa-review-local`");
  });
});
