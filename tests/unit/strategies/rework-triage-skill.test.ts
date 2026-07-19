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
const SYNTHESIZER_REL = "agents/learnings-synthesizer.md";

const CAUSES = [
  "decomposition-infidelity",
  "prd-defect",
  "missing-tool-access",
  "implementation-defect",
  "environment-data",
  "verification-gap",
] as const;

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
      for (const cause of CAUSES) {
        expect(skill).toContain(cause);
      }
      expect(skill).toContain("UNCLASSIFIED");
    });

    it("requires evidence and forbids guessed causes", () => {
      expect(skill).toMatch(/Never classify without evidence/);
      expect(skill).toMatch(/`UNCLASSIFIED` beats a guess/);
    });

    it("detects rework before classifying and exits clean on first attempts", () => {
      expect(skill).toContain("NOT_REWORK");
      expect(skill).toMatch(/status history|Status history/i);
      expect(skill).toContain("[claude-build-intake]");
    });

    it("routes harness defects to the upstream Lisa repo with dedupe", () => {
      expect(skill).toContain(UPSTREAM_CONFIG_KEY);
      expect(skill).toContain("CodySwannGT/lisa");
      expect(skill).toMatch(/Dedupe first/);
      expect(skill).toContain("self-hardening");
      expect(skill).toMatch(/gh issue create -R/);
    });

    it("is idempotent per bounce via an explicit posted fingerprint", () => {
      expect(skill).toContain("[lisa-rework-triage]");
      expect(skill).toContain("Fingerprint:");
      expect(skill).toMatch(/`none` as the PR component/);
      expect(skill).toContain("ALREADY_TRIAGED");
    });

    it("routes secondary verification gaps upstream and scopes the claim marker", () => {
      expect(skill).toMatch(/Secondary causes route too/);
      expect(skill).not.toContain("`[lisa-*]` evidence comment");
      expect(skill).toMatch(
        /\[lisa-rework-triage\]` comments and other unrelated/
      );
    });

    it("never blocks the fix on hardening", () => {
      expect(skill).toMatch(
        /hardening runs alongside, not in front of, shipping the fix/
      );
    });

    it("wires Phase 2.5 into ticket-triage", () => {
      expect(ticketTriage).toContain(
        "Phase 2.5 -- Rework Detection & Failure Classification"
      );
      expect(ticketTriage).toContain("lisa-rework-triage");
      expect(ticketTriage).toContain("### Rework Classification");
    });

    it("routes debrief causes to upstream, PRD, and provisioning destinations", () => {
      expect(debriefApply).toContain("Decomposition infidelity");
      expect(debriefApply).toContain("PRD defect");
      expect(debriefApply).toContain("Missing tool access");
      expect(debriefApply).toContain(UPSTREAM_CONFIG_KEY);
      expect(debriefApply).toMatch(/Never silently edit the spec/);
    });
  });

  describe("agent definitions (source root)", () => {
    const learner = read(SOURCE_ROOT, LEARNER_REL);
    const synthesizer = read(SOURCE_ROOT, SYNTHESIZER_REL);

    it("has the learner mark upstream candidates instead of filing them (LLG-2)", () => {
      expect(learner).toContain("scope:upstream-candidate");
      expect(learner).not.toContain("**UPSTREAM**");
      expect(learner).not.toContain(
        "CREATE SKILL / ADD TO RULES / UPSTREAM / OMIT"
      );
    });

    it("extends the synthesizer taxonomy with the three hardening categories", () => {
      expect(synthesizer).toContain("**Decomposition infidelity**");
      expect(synthesizer).toContain("**PRD defect**");
      expect(synthesizer).toContain("**Missing tool access**");
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
