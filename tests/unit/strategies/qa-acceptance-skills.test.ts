/**
 * Regression tests for the human-QA acceptance skill family.
 *
 * These skills are the front door between a non-technical human tester and
 * the agent lifecycle: qa-queue serves acceptance briefs and records
 * verdicts, qa-fail converts a plain-language failure into the structured
 * artifact the fixing agent needs (including the expectation-gap diagnosis
 * and the qa-fail label that rework-triage keys on), qa-clear batch-certifies
 * work a human cannot observe, and qa-checklist computes the manual
 * regression sweep as curated-journeys-minus-automated-coverage. The
 * contract under test is genericity (config-driven statuses and repos, no
 * project-specific names, no single-agent assumptions) plus the safety
 * rules that keep humans out of raw tracker mutation.
 *
 * Both source and generated plugin roots are asserted so a missed
 * `bun run build:plugins` fails this suite.
 * @module tests/unit/strategies/qa-acceptance-skills
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const GENERATED_SKILL_ROOTS = [
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;
const QA_QUEUE = "lisa-qa-queue";
const QA_FAIL = "lisa-qa-fail";
const QA_CLEAR = "lisa-qa-clear";
const QA_CHECKLIST = "lisa-qa-checklist";
const SKILLS = [QA_QUEUE, QA_FAIL, QA_CLEAR, QA_CHECKLIST] as const;
const COMMANDS = ["qa-queue", "qa-fail", "qa-clear", "qa-checklist"] as const;
const QA_QUEUE_KEY = "jira.workflow.qa.queue";
const CERTIFIED_KEY = "jira.workflow.qa.certified";
const FORBIDDEN_SPECIFICS = [
  "gemini",
  "Gemini",
  "ON STG",
  "Certified For Release",
  "backend-v2",
  "frontend-v2",
  "infrastructure-v2",
  "ask-gemini",
  "Claude Tag",
  "Slack",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

const skillRel = (name: string): string => `skills/${name}/SKILL.md`;

describe("qa acceptance skill family", () => {
  describe.each(ROOTS)("%s", root => {
    it("ships every skill with its pass-through command", () => {
      for (const name of SKILLS) {
        expect(existsSync(path.resolve(root, skillRel(name)))).toBe(true);
      }
      for (const cmd of COMMANDS) {
        const command = read(root, `commands/${cmd}.md`);
        expect(command).toContain(`Use the /lisa-${cmd} skill`);
        expect(command).toContain("$ARGUMENTS");
      }
    });

    it("stays generic: no project names, no single-agent or chat-surface assumptions", () => {
      for (const name of SKILLS) {
        const skill = read(root, skillRel(name));
        for (const forbidden of FORBIDDEN_SPECIFICS) {
          expect(skill).not.toContain(forbidden);
        }
      }
    });

    it("resolves statuses from config and never guesses terminal statuses", () => {
      const queue = read(root, skillRel(QA_QUEUE));
      const clear = read(root, skillRel(QA_CLEAR));
      for (const doc of [queue, clear]) {
        expect(doc).toContain(QA_QUEUE_KEY);
        expect(doc).toContain(CERTIFIED_KEY);
        expect(doc).toMatch(/never guess a terminal status/);
      }
      expect(queue).toContain("jira.workflow.done.staging");
    });

    it("qa-queue never certifies without an explicit pass and serves one ticket at a time", () => {
      const queue = read(root, skillRel(QA_QUEUE));
      expect(queue).toMatch(
        /Never transition to certified without an explicit "pass"/
      );
      expect(queue).toMatch(/One ticket at a time/);
      expect(queue).toContain("lisa-qa-fail");
      expect(queue).toContain("lisa-tracker-read");
    });

    it("qa-fail requires duplicate discovery, preserves tester words, and diagnoses the gap", () => {
      const fail = read(root, skillRel(QA_FAIL));
      expect(fail).toMatch(/duplicate/i);
      expect(fail).toMatch(/Never paraphrase away the tester's observation/);
      expect(fail).toContain("Expectation gap");
      expect(fail).toContain("no-evidence-found");
      expect(fail).toContain("qa-fail");
      expect(fail).toContain("lisa-rework-triage");
      for (const gap of [
        "ac-mismatch",
        "verification-weakness",
        "environment-difference",
        "data-difference",
        "regression-since-merge",
        "not-covered-by-ac",
      ]) {
        expect(fail).toContain(gap);
      }
    });

    it("qa-clear never moves mixed scope and never bulk-moves unconfirmed inferences", () => {
      const clear = read(root, skillRel(QA_CLEAR));
      expect(clear).toContain("qa.nonUserFacingRepos");
      expect(clear).toMatch(/Never clear a mixed-scope ticket/);
      expect(clear).toMatch(/without explicit operator confirmation/);
      expect(clear).toMatch(/audit comment/);
    });

    it("qa-checklist derives coverage from live specs and keeps one source of truth", () => {
      const checklist = read(root, skillRel(QA_CHECKLIST));
      expect(checklist).toContain("qa.checklistFile");
      expect(checklist).toMatch(/existing, non-skipped spec/);
      expect(checklist).toMatch(/single source of truth/);
    });
  });

  describe.each(GENERATED_SKILL_ROOTS)("generated root %s", root => {
    it("carries all four qa skills", () => {
      for (const name of SKILLS) {
        expect(existsSync(path.resolve(root, `${name}/SKILL.md`))).toBe(true);
      }
    });
  });
});
