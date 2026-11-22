/**
 * Text pins for the shipped-prerequisite check (CodySwannGT/lisa#4761): every
 * generated copy of `lisa-task-decomposition` step 4, the three validators'
 * S13, and the definition-of-ready rule carry the check. The executed
 * behaviour of step 4's command block is proven in
 * `shipped-prerequisite-check.test.ts`.
 * @module tests/unit/strategies/shipped-prerequisite-check-text
 */
import { describe, expect, it } from "vitest";

import {
  CHECK_NAME,
  gateS13,
  read,
  READY_RULES,
  SKILL_ROOTS,
  stepFour,
  TRI_STATE,
  VALIDATORS,
} from "./shipped-prerequisite-check-helpers.js";

describe.each(SKILL_ROOTS)("shipped-prerequisite check text (%s)", root => {
  const skill = (name: string): string => read(`${root}/${name}/SKILL.md`);

  it("step 4 verifies shipped claims on the default branch and links blockers", () => {
    const step = stepFour(skill("lisa-task-decomposition"));
    const flat = step.replace(/\s+/g, " ");
    expect(step.toLowerCase()).toContain(CHECK_NAME);
    expect(step).toContain("is blocked by");
    expect(step).toContain("git grep -F -n -w");
    expect(step).toContain("git rev-parse --verify -q");
    expect(step).toContain("':(top,exclude,glob)**/tests/**'");
    expect(step).toContain(`"origin/$default" -- ':/'`);
    expect(step).toContain("file or directory");
    expect(step).not.toContain("keeping only the matching");
    expect(step).toContain("+refs/heads/$default:refs/remotes/origin/$default");
    expect(step).toContain("gh repo view --json defaultBranchRef");
    expect(flat).toContain(TRI_STATE);
    expect(flat).toContain("handler symbol or file");
    expect(flat).not.toContain("endpoint");
    expect(step).toContain("stale-state-claims");
    expect(step).toContain("empirical-inquiry");
  });

  it.each(VALIDATORS)(
    "%s S13 points at step 4 and states the tri-state",
    validator => {
      const s13 = gateS13(skill(validator));
      const flat = s13.replace(/\s+/g, " ");
      expect(s13.toLowerCase()).toContain(CHECK_NAME);
      expect(s13).toContain("origin/<default>");
      expect(s13).toContain("`lisa-task-decomposition` step 4");
      expect(flat).toContain(TRI_STATE);
      expect(s13).toContain("FAIL");
      // The commands live once, in step 4; the validators only point at them.
      expect(s13).not.toContain("git grep");
      expect(s13).not.toContain("git cat-file");
    }
  );
});

describe.each(READY_RULES)("definition of ready (%s)", rulePath => {
  it("names the shipped-prerequisite check under S13", () => {
    const rule = read(rulePath).replace(/\s+/g, " ");
    expect(rule.toLowerCase()).toContain(CHECK_NAME);
    expect(rule).toContain("S13");
  });
});
