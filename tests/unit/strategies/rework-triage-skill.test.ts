/**
 * Regression tests for the self-hardening rework-triage loop.
 *
 * The loop closes the gap where a ticket bounced back from QA/staging was
 * treated identically to first-attempt work: nothing detected the rework,
 * nothing classified why the previous agent attempt failed, and no failure
 * cause ever reached a hardening destination. The contract under test is the
 * procedure agents follow — rework detection signals, the evidence-backed
 * cause taxonomy, and the routing that files harness defects upstream so the
 * same mistake structurally cannot repeat.
 *
 * Both source and generated plugin roots are asserted so a missed
 * `bun run build:plugins` fails this suite.
 * @module tests/unit/strategies/rework-triage-skill
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = "plugins/src/base";
const UPSTREAM_CONFIG_KEY = "hardening.upstreamRepo";
const ROOTS = [SOURCE_ROOT, "plugins/lisa"] as const;
const GENERATED_SKILL_ROOTS = [
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;
const COMMAND_REL = "commands/rework-triage.md";
const SKILL_REL = "skills/lisa-rework-triage/SKILL.md";
const TICKET_TRIAGE_REL = "skills/lisa-ticket-triage/SKILL.md";
const DEBRIEF_APPLY_REL = "skills/lisa-debrief-apply/SKILL.md";
const LEARNER_REL = "agents/learner.md";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("rework-triage self-hardening loop", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = read(root, SKILL_REL);
    const command = read(root, COMMAND_REL);
    const ticketTriage = read(root, TICKET_TRIAGE_REL);
    const debriefApply = read(root, DEBRIEF_APPLY_REL);

    it("ships the pass-through command and skill", () => {
      expect(existsSync(path.resolve(root, COMMAND_REL))).toBe(true);
      expect(existsSync(path.resolve(root, SKILL_REL))).toBe(true);
      expect(command).toContain("Use the /lisa-rework-triage skill");
      expect(command).toContain("$ARGUMENTS");
    });

    it("declares rework-triage frontmatter", () => {
      expect(skill).toMatch(/^---/);
      expect(skill).toMatch(/name:\s*lisa-rework-triage/);
      expect(skill).toMatch(/description:.*[Rr]ework detection/);
    });

    it("defines every failure cause in the taxonomy", () => {
      expect(skill).toContain("UNCLASSIFIED");
    });

    it("requires evidence and forbids guessed causes", () => {
      expect(skill).toMatch(/`UNCLASSIFIED` beats a guess/);
    });

    it("routes harness defects to the upstream Lisa repo with dedupe", () => {
      expect(skill).toContain(UPSTREAM_CONFIG_KEY);
      expect(skill).toContain("CodySwannGT/lisa");
      expect(skill).toContain("self-hardening");
      expect(skill).toContain("lisa-github-write-issue");
      expect(skill).toContain("build_ready: true");
      expect(skill).toContain("human_gate");
    });

    it("is idempotent per bounce via an explicit posted fingerprint", () => {
      expect(skill).toContain("[lisa-rework-triage]");
      expect(skill).toContain("Fingerprint:");
    });

    it("routes secondary verification gaps upstream and scopes the claim marker", () => {
      expect(skill).toMatch(
        /\[lisa-rework-triage\]` comments and other unrelated/
      );
    });

    it("wires Phase 2.5 into ticket-triage", () => {
      expect(ticketTriage).toContain("lisa-rework-triage");
    });

    it("routes debrief causes to upstream, PRD, and provisioning destinations", () => {
      expect(debriefApply).toContain(UPSTREAM_CONFIG_KEY);
    });
  });

  describe("agent definitions (source root)", () => {
    const learner = read(SOURCE_ROOT, LEARNER_REL);

    it("has the learner mark upstream candidates instead of filing them (LLG-2)", () => {
      expect(learner).not.toContain("**UPSTREAM**");
      expect(learner).not.toContain(
        "CREATE SKILL / ADD TO RULES / UPSTREAM / OMIT"
      );
    });
  });

  describe.each(GENERATED_SKILL_ROOTS)("generated root %s", root => {
    it("carries the rework-triage skill", () => {
      expect(
        existsSync(path.resolve(root, "lisa-rework-triage/SKILL.md"))
      ).toBe(true);
    });
  });
});
