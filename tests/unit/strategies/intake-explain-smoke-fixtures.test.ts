/**
 * Structural coverage for the intake-explain skill copies.
 *
 * Issue #852 introduced the intake-explain smoke fixtures. Their wording is
 * guidance prose and is not pinned here (#4867); this file only guards that
 * the generated copy matches its `plugins/src` source.
 * @module tests/unit/strategies/intake-explain-smoke-fixtures
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL_REL = "skills/lisa-intake-explain/SKILL.md";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("intake-explain smoke fixtures (#852)", () => {
  it("keeps source and generated intake-explain skill docs in lockstep", () => {
    const source = read("plugins/src/base", SKILL_REL);
    const generated = read("plugins/lisa", SKILL_REL);
    expect(generated).toBe(source);
  });
});
