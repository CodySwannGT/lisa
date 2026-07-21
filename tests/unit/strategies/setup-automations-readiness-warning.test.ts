/**
 * Contract coverage for setup-automations' repository-readiness advisory
 * (RRR-7, #1859).
 *
 * The setup skill consumes the persisted RRR-3 report; it never reimplements
 * readiness or turns the warn-only claim gate into a setup precondition. These
 * assertions pin the valid-report boundary, silent degradation, operator
 * wording, and six-agent delivery parity.
 * @module tests/unit/strategies/setup-automations-readiness-warning
 */
import { existsSync, readFileSync } from "node:fs";
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

/**
 * Read one delivered setup-automations skill.
 * @param root - Delivered skill root
 * @returns The skill markdown
 */
const readSkill = (root: string): string =>
  readFileSync(
    path.resolve(root, "lisa-setup-automations", "SKILL.md"),
    "utf8"
  );

/**
 * Collapse markdown whitespace so prose assertions survive wrapping.
 * @param value - Markdown to normalize
 * @returns Markdown with whitespace runs collapsed
 */
const squash = (value: string): string => value.replace(/\s+/g, " ");

describe("setup-automations repository-readiness advisory (#1859)", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    const skill = readSkill(root);
    const flat = squash(skill);

    it("consumes the canonical persisted report exactly once without rerunning doctor", () => {
      expect(skill).toContain("resolveReadinessReportPath");
      expect(skill).toContain(".lisa/readiness.json");
      expect(flat).toMatch(/read (the )?report exactly once/i);
      expect(flat).toMatch(/do not (re-)?run `?lisa doctor --readiness`?/i);
    });

    it("warns only for one internally consistent schema-version 1 blocker report", () => {
      expect(skill).toContain("schema_version");
      expect(skill).toContain("blocker_count");
      expect(skill).toContain("narrowed_claim");
      expect(flat).toMatch(/schema_version[^]{0,30}(equal|===|is) `?1`?/i);
      expect(flat).toMatch(/verdict[^]{0,30}NOT_READY/i);
      expect(flat).toMatch(/positive integer/i);
      expect(flat).toMatch(/blockers[^]{0,80}length[^]{0,40}blocker_count/i);
      expect(flat).toMatch(/B1[^]{0,20}B7/i);
      expect(flat).toMatch(/unique `?id`?/i);
      expect(flat).toMatch(
        /duplicate blocker ids[^]{0,80}internally inconsistent/i
      );
      expect(flat).toMatch(/caps the count at seven/i);
      expect(flat).toMatch(/non-empty[^]{0,40}narrowed_claim/i);
    });

    it("names the count, blocker ids and labels, and narrowed claim", () => {
      expect(flat).toMatch(/warning[^]{0,120}blocker count/i);
      expect(flat).toMatch(/each blocker[^]{0,80}`?id`?[^]{0,80}`?label`?/i);
      expect(flat).toMatch(/warning[^]{0,220}narrowed claim/i);
    });

    it("is warning-only and continues every registration and runbook step", () => {
      expect(flat).toMatch(/warning only|advisory only/i);
      expect(flat).toMatch(/setup continues/i);
      expect(flat).toMatch(/no (registration or runbook )?step is skipped/i);
      expect(flat).toMatch(/never a precondition/i);
    });

    it("silently ignores every unusable report shape", () => {
      for (const condition of [
        "missing",
        "unreadable",
        "invalid JSON",
        "unsupported schema",
        "internally inconsistent",
      ]) {
        expect(skill).toContain(condition);
      }
      expect(flat).toMatch(/no readiness warning and no error/i);
      expect(flat).toMatch(/do not invent[^]{0,80}(freshness|age|TTL)/i);
    });
  });

  it("documents the readiness vocabulary and concrete doctor artifact", () => {
    const vocabulary = readFileSync(
      path.resolve("wiki/concepts/lisa-vocabulary.md"),
      "utf8"
    );
    const overview = readFileSync(
      path.resolve("wiki/documentation/overview.md"),
      "utf8"
    );
    const index = readFileSync(path.resolve("wiki/index.md"), "utf8");

    expect(vocabulary).toMatch(/## Installation Readiness/);
    expect(vocabulary).toMatch(/## Repository Readiness/);
    expect(vocabulary).toMatch(/## Ship Blocker/);
    for (const distinctTerm of [
      "blocking finding",
      "break-out",
      "safe-block",
      "NOT_READY",
    ]) {
      expect(vocabulary).toContain(distinctTerm);
    }
    expect(overview).toContain("lisa doctor [path] --readiness");
    expect(overview).toContain(".lisa/readiness.json");
    expect(overview).toContain("schema_version");
    expect(overview).toContain("resolveReadinessReportPath");
    expect(index).toMatch(
      /installation readiness.*repository readiness.*ship blocker/i
    );
  });
});

/**
 * RRR-7's second obligation: the readiness rubric RRR-1..RRR-6 built must reach
 * every coding agent identically, not just Claude. RRR-4 (the agent-ready skill)
 * and RRR-3 (the doctor readiness surface) already carry their own six-root
 * parity pins; the rubric rule pairs the vocabulary distinguishes were the one
 * fanned surface with no cross-root backstop. This block is that backstop,
 * reusing the BCE-7 parity-pin pattern: every rule ships body-identical in the
 * roots that can represent a rules tree, and the roots that structurally cannot
 * are asserted as documented gaps, never silent drops.
 */
const SRC = "plugins/src/base";
const CLAUDE_ROOT = "plugins/lisa";
const CURSOR_ROOT = "plugins/lisa-cursor";
const AGY_ROOT = "plugins/lisa-agy";
const COPILOT_ROOT = "plugins/lisa-copilot";
const CODEX_ROOT = "plugins/lisa/.codex-plugin";

const read = (rel: string): string => readFileSync(path.resolve(rel), "utf8");

/**
 * Strip a leading YAML frontmatter block so per-agent frontmatter transforms do
 * not read as body drift.
 * @param text - Raw file contents
 * @returns Body with any frontmatter removed
 */
const body = (text: string): string => {
  if (!text.startsWith("---\n")) return text.trim();
  const end = text.indexOf("\n---", 3);
  return end === -1 ? text.trim() : text.slice(end + 4).trim();
};

/**
 * Empty every markdown link target so Cursor's flattened `.mdc` link rewrites do
 * not read as prose drift — the words must still match.
 * @param text - Raw file contents
 * @returns Body with every markdown link target emptied
 */
const proseOnly = (text: string): string =>
  body(text).replace(/\]\([^)]*\)/g, "]()");

/** The rule pairs the readiness vocabulary distinguishes, both fanned surfaces. */
const RRR_RULE_SLUGS = ["readiness-rubric", "convergent-review"] as const;
const RULE_TIERS = ["eager", "reference"] as const;

describe("RRR rubric six-agent parity backstop (#1859)", () => {
  describe.each(RRR_RULE_SLUGS)("rule pair %s", slug => {
    describe.each(RULE_TIERS)("%s tier", tier => {
      const rel = `rules/${tier}/${slug}.md`;
      const source = read(`${SRC}/${rel}`);

      it("ships byte-identical in the Claude and Copilot roots", () => {
        expect(existsSync(path.resolve(CLAUDE_ROOT, rel))).toBe(true);
        expect(read(`${CLAUDE_ROOT}/${rel}`)).toBe(source);
        expect(read(`${COPILOT_ROOT}/${rel}`)).toBe(source);
      });

      it("ships in the Cursor root as an .mdc rule with the same body", () => {
        const cursorName =
          tier === "reference" ? `${slug}-reference.mdc` : `${slug}.mdc`;
        const cursor = read(`${CURSOR_ROOT}/rules/${cursorName}`);
        expect(proseOnly(cursor)).toBe(proseOnly(source));
      });
    });
  });

  it("keeps the readiness verdict ladder identical across every rule mirror", () => {
    const source = read(`${SRC}/rules/reference/readiness-rubric.md`);
    expect(source).toContain("seven ship blockers");
    expect(source).toMatch(/B1[\s\S]{0,2000}B7/);
    expect(source).toContain("narrowed claim");
  });

  describe("representation gaps are documented, never silent", () => {
    it("agy carries no rules tree, so the rubric cannot be a silent drop", () => {
      expect(existsSync(path.resolve(AGY_ROOT, "rules"))).toBe(false);
      const generator = read("scripts/generate-agy-plugin-artifacts.mjs");
      expect(generator).toMatch(/no full rules tree in agy artifacts/i);
    });

    it("the Codex plugin carries no rules tree of its own", () => {
      expect(existsSync(path.resolve(CODEX_ROOT, "rules"))).toBe(false);
    });
  });
});
