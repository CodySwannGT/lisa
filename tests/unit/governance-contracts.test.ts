/**
 * Regression tests for repository governance text contracts that intake issues
 * rely on during scheduled runs.
 *
 * @module tests/unit/governance-contracts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const TRACKER_SHIMS = [
  "lisa-tracker-add-journey",
  "lisa-tracker-build-intake",
  "lisa-tracker-create",
  "lisa-tracker-evidence",
  "lisa-tracker-journey",
  "lisa-tracker-read",
  "lisa-tracker-sync",
  "lisa-tracker-validate",
  "lisa-tracker-verify",
  "lisa-tracker-write",
] as const;

const CONFIG_OVERRIDE_SKILLS = [
  "lisa-analyze-claude-remote",
  "lisa-validate-tracker-mapping",
] as const;

describe("governance text contracts", () => {
  it("keeps root CLAUDE.md as a thin pointer to AGENTS.md", () => {
    expect(readFileSync(path.resolve("CLAUDE.md"), "utf8")).toBe(
      "@AGENTS.md\n"
    );
  });

  it.each(TRACKER_SHIMS)(
    "%s requires tracker config instead of defaulting to jira",
    skill => {
      const content = readFileSync(
        path.resolve("plugins/src/base/skills", skill, "SKILL.md"),
        "utf8"
      );

      expect(content).toContain("No tracker configured in .lisa.config.json");
      expect(content).not.toContain("default: jira");
      expect(content).not.toContain(
        'tracker="${local_tracker:-${global_tracker:-jira}}"'
      );
    }
  );

  it.each(CONFIG_OVERRIDE_SKILLS)(
    "%s resolves tracker/source through local config overrides",
    skill => {
      const content = readFileSync(
        path.resolve("plugins/src/base/skills", skill, "SKILL.md"),
        "utf8"
      );

      expect(content).toContain(".lisa.config.local.json");
      expect(content).toContain('local_v=$(jq -r "$path // empty"');
      expect(content).toContain('global_v=$(jq -r "$path // empty"');
    }
  );

  it("checks tracker config before writing evidence usage", () => {
    const content = readFileSync(
      path.resolve("plugins/src/base/skills/lisa-tracker-evidence/SKILL.md"),
      "utf8"
    );

    expect(content.indexOf("Missing / empty")).toBeLessThan(
      content.indexOf("Before dispatching, update")
    );
  });
});
