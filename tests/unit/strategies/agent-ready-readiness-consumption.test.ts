/**
 * Regression coverage for agent-ready's repository-readiness assessment phase.
 *
 * Issue #1856 (RRR-4) teaches `lisa-agent-ready` to run the eight-dimension
 * repository-readiness assessment (consuming the RRR-1 rubric and the RRR-3
 * `lisa doctor --readiness` / `.lisa/readiness.json` output — one assessment
 * implementation, not two) and to file each standing ship blocker as a tracker
 * work item through the vendor-neutral `lisa-tracker-write`, never as an
 * in-session question. These pins guard the shipped never-ask posture, the
 * idempotent filing, the audit obligation proving zero ingested-source
 * mutation, and the knowledge-readiness / repository-readiness distinction.
 * @module tests/unit/strategies/agent-ready-readiness-consumption
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
const SKILL_SLUG = "lisa-agent-ready";

const readSkill = (root: string): string =>
  readFileSync(path.resolve(root, SKILL_SLUG, "SKILL.md"), "utf8");

describe("agent-ready repository-readiness consumption (#1856)", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    const skill = readSkill(root);

    it("adds a repository-readiness assessment phase after Phase 5", () => {
      expect(skill).toMatch(/Phase 6 — Repository readiness assessment/i);
      expect(skill).toMatch(/after Phase 5/i);
    });

    it("consumes the shared readiness assessment, not a second implementation", () => {
      expect(skill).toContain("readiness-rubric");
      expect(skill).toMatch(/eight ownership dimensions/i);
      expect(skill).toContain(".lisa/readiness.json");
      expect(skill).toMatch(/lisa doctor --readiness/);
      expect(skill).toMatch(/one assessment implementation, not two/i);
    });

    it("sources dimension evidence from Phase 2 wiki pages, no new discovery", () => {
      expect(skill).toMatch(/danger-zone wiki pages Phase 2 already produced/i);
      expect(skill).toMatch(/no new discovery machinery/i);
    });

    it("files each standing blocker as a tracker work item, never a question", () => {
      expect(skill).toContain("lisa-tracker-write");
      expect(skill).toMatch(/never pauses to ask a human anything/i);
      expect(skill).toMatch(/build-ready/i);
      expect(skill).toMatch(/human-needed/i);
    });

    it("carries the five readiness finding fields in each filed item", () => {
      expect(skill).toContain("invariant_violated");
      expect(skill).toContain("evidence");
      expect(skill).toContain("why_proof_missed");
      expect(skill).toContain("root_correction");
      expect(skill).toContain("machinery_to_remove");
    });

    it("states the filing is the skill's only tracker write and never mutates a source", () => {
      expect(skill).toMatch(/only tracker write/i);
      expect(skill).toMatch(
        /never edits, comments on, transitions, or otherwise mutates any ingested source/i
      );
    });

    it("files blockers idempotently, reconciling an existing open item", () => {
      expect(skill).toMatch(/idempotent/i);
      expect(skill).toMatch(/existing open work item/i);
      expect(skill).toMatch(/reconcile/i);
      expect(skill).toMatch(/never creates a duplicate/i);
    });

    it("requires auditing a real headless run for zero ingested-source mutation", () => {
      expect(skill).toMatch(/real headless run must be audited/i);
      expect(skill).toMatch(/zero\s+ingested-source mutation/i);
    });

    it("keeps knowledge readiness and repository readiness distinct claims", () => {
      expect(skill).toMatch(/agent-ready for knowledge/i);
      expect(skill).toMatch(/knowledge-ready and `NOT_READY`/i);
      expect(skill).toMatch(/different claims/i);
    });
  });
});
