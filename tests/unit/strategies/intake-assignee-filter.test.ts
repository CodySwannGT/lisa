/**
 * Regression tests for the optional local assignee filter on build-intake.
 *
 * Intake may narrow the ready queue to items already assigned to one person for
 * a local automation lane, but the default shared queue behavior must remain
 * unchanged when no assignee is resolved. Both source and generated plugin
 * roots are asserted.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe("intake assignee filter", () => {
  describe.each(ROOTS)("%s/intake", root => {
    const content = readSkill(root, "intake");

    it("documents the assignee argument and local config resolution order", () => {
      expect(content).toContain("assignee=<vendor-user-id-or-login>");
      expect(content).toContain(".lisa.config.local.json` `intake.assignee`");
      expect(content).toMatch(/empty default/i);
    });

    it("states that the filter is selection-only", () => {
      expect(content).toMatch(/never assigns or reassigns tickets/i);
      expect(content).toMatch(
        /ready[\s\S]*already assigned to that assignee are considered/i
      );
    });
  });

  describe.each(ROOTS)("%s/github-build-intake", root => {
    const content = readSkill(root, "github-build-intake");

    it("documents assignee resolution for github build intake", () => {
      expect(content).toContain("assignee=<github-login>");
      expect(content).toContain(".lisa.config.local.json` `intake.assignee`");
      expect(content).toMatch(/empty default/i);
    });

    it("uses --assignee only when the resolved filter is non-empty", () => {
      expect(content).toMatch(/if \[ -n "\$ASSIGNEE" \]; then/);
      expect(content).toMatch(/--assignee "\$ASSIGNEE"/);
      expect(content).toMatch(
        /else\s+gh issue list --repo <org>\/<repo> --label "\$READY" --state open/s
      );
    });

    it("preserves shared-queue behavior when no assignee is resolved", () => {
      expect(content).toMatch(/scan the shared ready queue exactly as before/i);
      expect(content).toMatch(
        /filter the ready-item query to issues already assigned/i
      );
    });
  });
});

describe("config-resolution intake.assignee docs", () => {
  const content = readFileSync(
    path.resolve("plugins/src/base/rules/config-resolution.md"),
    "utf8"
  );

  it("documents intake.assignee as a local-only override", () => {
    expect(content).toContain("### Intake assignee filter (`intake.assignee`)");
    expect(content).toMatch(/local-only/i);
    expect(content).toMatch(/\.lisa\.config\.local\.json/);
  });

  it("documents argument override and empty default behavior", () => {
    expect(content).toContain(
      "$ARGUMENTS` `assignee=<vendor-user-id-or-login>`"
    );
    expect(content).toMatch(/empty default/i);
    expect(content).toMatch(
      /empty resolved value disables the[\s\S]*shared ready-queue behavior/i
    );
  });
});
