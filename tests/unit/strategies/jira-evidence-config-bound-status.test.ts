/**
 * Regression tests for config-bound JIRA status transitions at the
 * PR-evidence milestone.
 *
 * Incident: `post-evidence.sh` Step 5 hard-coded `jira issue move "$TICKET_ID"
 * "Code Review"`, ignoring `.lisa.config.json` `jira.workflow`. On a project
 * whose workflow does not name a review status, this pushed a real ticket into
 * an off-config "Awaiting Code Review" status that Lisa does not govern.
 *
 * The contract (`plugins/src/base/rules/reference/config-resolution.md`) makes
 * `jira.workflow.review` OPTIONAL: when it is absent the build lifecycle stays
 * in `claimed` until `done` and the intermediate transition is skipped. A
 * non-blocked transition may therefore target ONLY a status named in
 * `config.jira.workflow` — never a hard-coded literal.
 *
 * These assertions guard the Step-5 branch in both the source script
 * (`plugins/src/...`, the source of truth) and the generated artifact
 * (`plugins/lisa/...`), so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/jira-evidence-config-bound-status
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Source + generated copies of the evidence-posting script across every plugin
 * runtime that ships it. The base, expo, and rails stacks each carry their own
 * source-of-truth script (stack plugins are standalone — no base merge), and
 * the same hard-coded "Code Review" literal lived in all three. Generated
 * copies are asserted alongside source so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite.
 */
const SCRIPT_PATHS = [
  "plugins/src/base/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/lisa/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/lisa-agy/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/lisa-copilot/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/lisa-cursor/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/src/expo/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/lisa-expo/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/lisa-expo-agy/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/lisa-expo-copilot/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/lisa-expo-cursor/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/src/rails/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/lisa-rails/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/lisa-rails-agy/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/lisa-rails-copilot/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/lisa-rails-cursor/skills/jira-evidence/scripts/post-evidence.sh",
] as const;

/**
 * Source + generated copies of the base-shaped jira-evidence skill doc, which
 * carries the full "Workflow resolution" bash snippet. The expo/rails stack
 * docs use a different (screenshot-centric) structure and are asserted
 * separately below.
 */
const SKILL_PATHS = [
  "plugins/src/base/skills/jira-evidence/SKILL.md",
  "plugins/lisa/skills/jira-evidence/SKILL.md",
  "plugins/lisa-agy/skills/jira-evidence/SKILL.md",
  "plugins/lisa-copilot/skills/jira-evidence/SKILL.md",
  "plugins/lisa-cursor/skills/jira-evidence/SKILL.md",
] as const;

/** Stack jira-evidence docs (expo/rails) — source + generated copies. */
const STACK_SKILL_PATHS = [
  "plugins/src/expo/skills/jira-evidence/SKILL.md",
  "plugins/lisa-expo/skills/jira-evidence/SKILL.md",
  "plugins/lisa-expo-agy/skills/jira-evidence/SKILL.md",
  "plugins/lisa-expo-copilot/skills/jira-evidence/SKILL.md",
  "plugins/lisa-expo-cursor/skills/jira-evidence/SKILL.md",
  "plugins/src/rails/skills/jira-evidence/SKILL.md",
  "plugins/lisa-rails/skills/jira-evidence/SKILL.md",
  "plugins/lisa-rails-agy/skills/jira-evidence/SKILL.md",
  "plugins/lisa-rails-copilot/skills/jira-evidence/SKILL.md",
  "plugins/lisa-rails-cursor/skills/jira-evidence/SKILL.md",
] as const;

/**
 * Read a repo-relative file as UTF-8 text.
 * @param rel path relative to the repository root
 * @returns the file contents
 */
const read = (rel: string): string =>
  readFileSync(
    path.resolve(import.meta.dirname, "..", "..", "..", rel),
    "utf8"
  );

describe("post-evidence.sh Step 5 is config-bound (skip-when-unconfigured)", () => {
  describe.each(SCRIPT_PATHS)("%s", scriptPath => {
    const content = read(scriptPath);

    it("resolves the review status from jira.workflow (global + local)", () => {
      // Both the canonical `review` key and the `code_review` alias are read.
      expect(content).toContain(".jira.workflow.review");
      expect(content).toContain(".jira.workflow.code_review");
      // Read from the committed config and the local override file.
      expect(content).toContain(".lisa.config.json");
      expect(content).toContain(".lisa.config.local.json");
    });

    it("defaults the review status to empty, not a hard-coded literal", () => {
      // The default must be empty so an unconfigured project performs no move.
      expect(content).toContain('REVIEW=""');
    });

    it("never invents a hard-coded transition target in the move command", () => {
      // The move must use the resolved variable, never a string literal.
      expect(content).toContain('jira issue move "$TICKET_ID" "$REVIEW"');
      expect(content).not.toContain(
        'jira issue move "$TICKET_ID" "Code Review"'
      );
    });

    it("only moves the ticket when a review status is configured", () => {
      // The transition is gated behind a non-empty REVIEW check.
      expect(content).toMatch(/if\s+\[\s+-n\s+"\$REVIEW"\s+\]/);
    });

    it("leaves the ticket in claimed when review is unconfigured", () => {
      // The else branch must explicitly skip the transition.
      expect(content).toContain("No jira.workflow.review configured");
      expect(content).toMatch(/claimed/);
    });
  });
});

describe("jira-evidence SKILL.md documents the optional, skip-when-absent review hop", () => {
  describe.each(SKILL_PATHS)("%s", skillPath => {
    const content = read(skillPath);

    it("initializes REVIEW empty in the resolution snippet", () => {
      expect(content).toContain('REVIEW=""');
      expect(content).not.toContain('REVIEW="Code Review"');
    });

    it("states the transition is skipped when review is unset", () => {
      expect(content).toMatch(/optional/i);
      expect(content).toMatch(/skip/i);
      expect(content).toMatch(/claimed/);
    });

    it("forbids transitioning to a status not named in config.jira.workflow", () => {
      expect(content).toMatch(/not\s+named\s+in\s+`?config\.jira\.workflow/i);
    });
  });
});

describe("stack jira-evidence SKILL.md (expo/rails) drops the hard-coded review status", () => {
  describe.each(STACK_SKILL_PATHS)("%s", skillPath => {
    const content = read(skillPath);

    it("no longer names a hard-coded 'Move ticket to Code Review' step", () => {
      expect(content).not.toContain("Move ticket to Code Review");
    });

    it("describes resolving the review status from jira.workflow", () => {
      expect(content).toContain("jira.workflow.review");
    });

    it("states the step is optional and skipped when review is unset", () => {
      expect(content).toMatch(/optional/i);
      expect(content).toMatch(/skip/i);
      expect(content).toMatch(/claimed/);
    });
  });
});
