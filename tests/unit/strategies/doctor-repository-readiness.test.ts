/**
 * Regression tests for the repository-readiness doctor render group and skill
 * section (RRR-3, #1855).
 *
 * PRD #1739 adds a ninth, separately-titled doctor group — "Repository
 * readiness" — that scores the eight ownership dimensions from the
 * `readiness-rubric` rule and renders one check per dimension, never fewer.
 * This suite proves the shared `doctor-report.mjs` renderer exposes the group,
 * that the group holds exactly eight dimension checks in fixed order with a
 * stated SKIP reason for every inapplicable dimension, and that the lisa-doctor
 * skill documents the section identically across the fanned-out plugin copies.
 * @module tests/unit/strategies/doctor-repository-readiness
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createRepositoryReadinessDoctorGroup,
  renderDoctorReport,
} from "../../../plugins/src/base/scripts/doctor-report.mjs";

/** The eight ownership dimensions, in fixed render order (readiness-rubric). */
const EXPECTED_DIMENSION_IDS = [
  "context-routing",
  "capabilities-tools",
  "domain-ownership",
  "execution-proof",
  "feedback-guardrails",
  "dependencies-supply-chain",
  "delivery-authority",
  "proportionality",
] as const;

/** Every plugin copy that must carry an identical lisa-doctor skill section. */
const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-copilot/skills",
] as const;

const readDoctorSkill = (root: string): string =>
  readFileSync(path.resolve(root, "lisa-doctor", "SKILL.md"), "utf8");

/**
 * A scratch root with no `.lisa/readiness.json`. Since #1902 the group projects
 * the CLI-authored report when one is present, so the unassessed-dimension
 * contract has to be asserted against a root that provably has no report —
 * `process.cwd()` would flip these assertions on any machine where the Lisa CLI
 * readiness pass has already run.
 */
let root = "";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-readiness-group-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("repository-readiness doctor render group (#1855)", () => {
  it("returns a separately-titled group with a stable id", () => {
    const group = createRepositoryReadinessDoctorGroup(root);

    expect(group.id).toBe("repository-readiness");
    expect(group.title).toBe("Repository readiness");
  });

  it("scores exactly eight dimensions in fixed order, never fewer", () => {
    const group = createRepositoryReadinessDoctorGroup(root);

    expect(group.checks).toHaveLength(8);
    expect(group.checks.map(check => check.id)).toEqual([
      ...EXPECTED_DIMENSION_IDS,
    ]);
  });

  it("emits SKIP with a stated reason for every inapplicable dimension", () => {
    const group = createRepositoryReadinessDoctorGroup(root);

    for (const check of group.checks) {
      expect(check.status).toBe("SKIP");
      expect(typeof check.observed).toBe("string");
      expect((check.observed ?? "").length).toBeGreaterThan(0);
    }
  });

  it("renders under the shared verdict/counts header as one titled group", () => {
    const group = createRepositoryReadinessDoctorGroup(root);
    const report = renderDoctorReport({ groups: [group] });

    expect(report.text).toContain("Overall verdict: ");
    expect(report.text).toContain("Counts: ");
    expect(report.text).toContain("repository-readiness. Repository readiness");
    for (const id of EXPECTED_DIMENSION_IDS) {
      expect(report.text).toContain(`- SKIP ${id}:`);
    }
  });
});

describe.each(SKILL_ROOTS)(
  "doctor repository-readiness skill section (%s)",
  root => {
    const content = readDoctorSkill(root);

    it("defines one shared doctor repository-readiness section citing the rubric", () => {
      expect(content).toContain("### Minimum repository-readiness checks");
      expect(content).toMatch(/Repository readiness/);
      expect(content).toMatch(/readiness-rubric/);
      expect(content).toMatch(/--readiness/);
    });

    it("documents the eight dimensions and the SKIP-with-reason contract", () => {
      for (const id of EXPECTED_DIMENSION_IDS) {
        expect(content).toContain(id);
      }
      expect(content).toMatch(/eight/i);
      expect(content).toMatch(/never (fewer|omit)/i);
    });

    it("documents the persisted .lisa/readiness.json artifact", () => {
      expect(content).toMatch(/\.lisa\/readiness\.json/);
      expect(content).toMatch(/schema_version/);
    });
  }
);
