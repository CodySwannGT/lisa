/**
 * Contract-text regressions for the GitHub validator contradictions reported
 * in #1549. The validator is an agent contract, so these assertions verify the
 * canonical SKILL.md instructions agents follow; they do not execute a
 * programmatic validator implementation or live GitHub fixture.
 * @module tests/unit/strategies/github-validator-f2-f4-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const VALIDATOR_PATHS = [
  "plugins/src/base/skills/lisa-github-validate-issue/SKILL.md",
  "plugins/lisa/skills/lisa-github-validate-issue/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-github-validate-issue/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-github-validate-issue/SKILL.md",
  "plugins/lisa-agy/skills/lisa-github-validate-issue/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-github-validate-issue/SKILL.md",
] as const;

/**
 * Return one gate section without leaking into the next gate.
 * @param validator full validator skill text
 * @param gate gate identifier to extract
 * @returns markdown for the requested gate
 */
const gateSection = (validator: string, gate: "F2" | "F4" | "S15"): string => {
  const heading = `#### ${gate} —`;
  const start = validator.indexOf(heading);
  const end = validator.indexOf("\n#### ", start + heading.length);

  expect(start).toBeGreaterThan(-1);
  return end === -1 ? validator.slice(start) : validator.slice(start, end);
};

describe.each(VALIDATOR_PATHS)(
  "GitHub validator F2/F4 contract (#1549): %s",
  validatorPath => {
    const validator = readFileSync(path.resolve(validatorPath), "utf8");
    const f2 = gateSection(validator, "F2");
    const f4 = gateSection(validator, "F4");
    const s15 = gateSection(validator, "S15");

    it("accepts an Epic under a configured PRD parent only in the same-repo GitHub self-host shape", () => {
      expect(f2).toMatch(
        /`Epic` \| source GitHub \+ tracker GitHub \+ configured child repo = parent repo \| configured PRD lifecycle label \| \*\*PASS\*\*/
      );
      expect(f2).toContain("github.labels.prd");
      expect(f2).toContain("prd-lifecycle-rollup");
    });

    it("rejects the PRD-parent exception across repositories or unsupported source shapes", () => {
      expect(f2).toMatch(
        /`Epic` \| cross-repository or source\/tracker is not same-repo GitHub \| PRD lifecycle label only \| \*\*FAIL\*\*/
      );
      expect(f2).toMatch(
        /do not infer the exception from label spelling alone/
      );
    });

    it("rejects Epic parents that only look like configured PRD lifecycle labels", () => {
      expect(f2).toMatch(
        /`Epic` \| permitted self-host shape \| unconfigured `prd-\*` lookalike or `prd-intake-feedback` sentinel only \| \*\*FAIL\*\*/
      );
    });

    it("keeps the Sub-task parent allowlist unchanged", () => {
      expect(f2).toMatch(
        /`Sub-task` \| any \| `type:Story`, `type:Task`, `type:Bug`, or `type:Improvement` \| \*\*PASS\*\*/
      );
      expect(f2).toMatch(
        /`Sub-task` \| any \| PRD lifecycle label or `type:Epic` only \| \*\*FAIL\*\*/
      );
    });

    it("still requires type:Epic for ordinary non-Sub-task children", () => {
      expect(f2).toMatch(
        /any other non-Sub-task \| any \| `type:Epic` \| \*\*PASS\*\*/
      );
      expect(f2).toMatch(
        /any other non-Sub-task \| any \| PRD lifecycle label only \| \*\*FAIL\*\*/
      );
    });

    it("requires type and priority labels unconditionally", () => {
      expect(f4).toMatch(/`type:<issue_type>` and `priority:<priority>`/);
      expect(f4).toMatch(/two labels are unconditional/i);
    });

    it("allows containers and build_ready:false leaves to omit status", () => {
      expect(f4).toMatch(/container \| any \| omitted \| \*\*PASS\*\*/);
      expect(f4).toMatch(/leaf \| `false` \| omitted \| \*\*PASS\*\*/);
    });

    it("preserves the omitted writer input as default-ready for proposed leaves", () => {
      expect(f4).toMatch(
        /proposed leaf spec[^.]*omitted `build_ready` to `true`/i
      );
      expect(f4).toMatch(/backward-compatible default-ready behavior/i);
    });

    it("requires status:ready for build_ready:true leaves", () => {
      expect(f4).toMatch(
        /leaf \| `true` \| configured build-ready role \(`status:ready` by default\) \| \*\*PASS\*\*/
      );
      expect(f4).toMatch(
        /leaf \| `true` \| omitted or a different `status:\*` label \| \*\*FAIL\*\*/
      );
    });

    it("resolves custom ready labels consistently in input, live parsing, F4, and S15", () => {
      expect(validator).toMatch(
        /build_ready: true[^\n]*github\.labels\.build\.ready/
      );
      expect(s15).toContain("resolve `READY_ROLE`");
      expect(s15).toContain("`github.labels.build.ready`");
      expect(f4).toContain("derive `build_ready`");
      expect(f4).toContain("S15-resolved");
      expect(f4).toContain("`READY_ROLE`");
      expect(validator).toMatch(
        /derive the spec fields[^\n]*label set contains the resolved `READY_ROLE`, not a hard-coded label/
      );
    });

    it("fails a container carrying the configured ready label and renders that label in remediation", () => {
      expect(s15).toContain('`github.labels.build.ready = "queue:approved"`');
      expect(s15).toMatch(
        /container carrying `queue:approved` FAILs S15[^.]*literal `status:ready`/
      );
      expect(s15).toContain("Move <READY_ROLE> off this container");
    });

    it("retains S15 as the container build-ready prohibition", () => {
      expect(f4).toMatch(
        /container carrying the build-ready role still FAILs S15/
      );
    });
  }
);
