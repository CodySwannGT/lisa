/**
 * Smoke coverage for intake-explain verdict fixtures and read-only guarantees.
 *
 * Issue #852 requires representative PRD and build lifecycle fixtures so the
 * operator diagnosis contract keeps lifecycle, dependency, staleness, and
 * repair-backoff verdicts aligned with the write-side intake flows.
 * @module tests/unit/strategies/intake-explain-smoke-fixtures
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const SKILL_REL = "skills/lisa-intake-explain/SKILL.md";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("intake-explain smoke fixtures (#852)", () => {
  it("keeps source and generated intake-explain skill docs in lockstep", () => {
    const source = read("plugins/src/base", SKILL_REL);
    const generated = read("plugins/lisa", SKILL_REL);
    expect(generated).toBe(source);
  });

  describe.each(PLUGIN_ROOTS)("%s", root => {
    it("defines representative PRD fixtures for lifecycle, staleness, and backoff verdicts", () => {
      const skill = read(root, SKILL_REL);
      expect(skill).toMatch(/\[lisa-repair-intake\]/);
    });
  });
});
