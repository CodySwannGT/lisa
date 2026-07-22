/**
 * Regression tests for the bounded harness-improvement loop.
 *
 * The loop exists so a failed or expensive factory trajectory produces a
 * *proven* fix rather than a plausible one: the gap must be classified before
 * anything is changed, the change is capped at the smallest owning change, and
 * a fresh rerun only credits the intervention when the transcript shows it was
 * actually retrieved or invoked. Each assertion below pins one of those
 * load-bearing contracts — the taxonomy, the verdict/decision vocabularies, the
 * fingerprint format, and the relevance gate — so a rewrite cannot quietly drop
 * them.
 *
 * Both source and generated plugin roots are asserted so a missed
 * `bun run build:plugins` fails this suite.
 * @module tests/unit/strategies/improve-harness-skill
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = "plugins/src/base";
const ROOTS = [SOURCE_ROOT, "plugins/lisa"] as const;
const GENERATED_SKILL_ROOTS = [
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;
const COMMAND_REL = "commands/improve-harness.md";
const SKILL_REL = "skills/lisa-improve-harness/SKILL.md";

const GAPS = [
  "context",
  "capability",
  "domain-ownership",
  "authority",
  "proof",
  "feedback-delivery",
  "worker-limitation",
] as const;

const VERDICTS = [
  "intervention-supported",
  "intervention-refuted",
  "no-evidence-for-intervention",
  "insufficient-evidence",
  "unclassified",
  "bounded-authority-stop",
  "headless-proposal-only",
] as const;

const DECISIONS = ["retain", "revise", "remove", "test-without"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("improve-harness bounded improvement loop", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = read(root, SKILL_REL);
    const command = read(root, COMMAND_REL);

    it("ships the pass-through command and skill", () => {
      expect(existsSync(path.resolve(root, COMMAND_REL))).toBe(true);
      expect(existsSync(path.resolve(root, SKILL_REL))).toBe(true);
      expect(command).toContain("Use the /lisa-improve-harness skill");
      expect(command).toContain("$ARGUMENTS");
      expect(command).toMatch(/argument-hint:/);
    });

    it("declares improve-harness frontmatter", () => {
      expect(skill).toMatch(/^---/);
      expect(skill).toMatch(/name:\s*lisa-improve-harness/);
      expect(skill).toMatch(/description:.*trajectory/);
    });

    it("defines every gap in the taxonomy", () => {
      for (const gap of GAPS) {
        expect(skill).toContain(`\`${gap}\``);
      }
    });

    it("requires two comparable failures before worker-limitation", () => {
      const unwrapped = skill.replace(/\s+/gu, " ");
      expect(unwrapped).toContain("≥2 comparable failed trajectories");
      expect(skill).toMatch(
        /single trajectory can \*\*never\*\* establish `worker-limitation`/
      );
    });

    it("classifies the gap before any intervention is made", () => {
      const classifyIndex = skill.indexOf("## Phase 4 — Classify the gap");
      const interveneIndex = skill.indexOf(
        "## Phase 5 — The smallest owning intervention"
      );
      expect(classifyIndex).toBeGreaterThan(-1);
      expect(interveneIndex).toBeGreaterThan(classifyIndex);
    });

    it("enumerates every verdict and every decision", () => {
      for (const verdict of VERDICTS) {
        expect(skill).toContain(verdict);
      }
      for (const decision of DECISIONS) {
        expect(skill).toContain(decision);
      }
    });

    it("gates a credited rerun on positive retrieval evidence", () => {
      expect(skill).toContain("absence of evidence is not evidence");
      expect(skill).toMatch(/\*\*Never `retain`\.\*\*/);
      expect(skill).toContain("no-evidence-for-intervention");
    });

    it("caps the intervention at the smallest owning change", () => {
      expect(skill).toMatch(
        /file a proposed-intervention ticket via `lisa-tracker-write` and STOP/
      );
      expect(skill).toContain("bounded-authority-stop");
    });

    it("is idempotent per trajectory via an ih1- fingerprint marker", () => {
      expect(skill).toContain("[lisa-improve-harness] key=<fingerprint>");
      expect(skill).toMatch(/"ih1-" \+ first 12 hex chars of sha1/);
      expect(skill).toContain("already-improved");
    });

    it("leaves a result record on every terminal state", () => {
      expect(skill).toMatch(
        /Every terminal state posts a result record to the originating item before stopping/
      );
      expect(skill).toContain("What this means:");
      expect(skill).toContain("What happens next:");
      expect(skill).toContain("Known limits:");
    });

    it("triggers headless mode mechanically, never from terminal detection", () => {
      expect(skill).toMatch(
        /`mode=headless` was passed explicitly, or the invocation context carries/
      );
      expect(skill).toMatch(/Terminal detection is not a trigger/);
    });

    it("submits learnings for judgment instead of writing the ledger", () => {
      expect(skill).toContain("lisa-persist-learning");
      expect(skill).toMatch(/never (?:writes|edits) the learnings/);
    });
  });

  describe.each(GENERATED_SKILL_ROOTS)("generated root %s", root => {
    it("carries the improve-harness skill", () => {
      expect(
        existsSync(path.resolve(root, "lisa-improve-harness/SKILL.md"))
      ).toBe(true);
    });
  });
});
