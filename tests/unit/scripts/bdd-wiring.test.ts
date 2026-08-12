/**
 * Tests that the BDD gate is actually shipped and wired: copy-overwrite
 * scripts, the create-only seed, the three-state CI job, the ruleset template
 * whose context cannot drift from the job name, and the versioned docs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  MATRIX_REL,
  QUALITY_REL,
  REPO_ROOT,
  SCRIPT_REL,
  SEED_MAP_REL,
  read,
} from "./bdd/support";

const RULESET_REL = "expo/github-rulesets/bdd-coverage.json";
const DOC_REL = "docs/bdd-coverage-schema.md";

describe("shipped wiring", () => {
  it("ships both entry points and their shared modules as copy-overwrite", () => {
    for (const relative of [
      SCRIPT_REL,
      MATRIX_REL,
      "expo/copy-overwrite/scripts/bdd/contract.mjs",
      "expo/copy-overwrite/scripts/bdd/parse.mjs",
      "expo/copy-overwrite/scripts/bdd/validate.mjs",
      "expo/copy-overwrite/scripts/bdd/waivers.mjs",
      "expo/copy-overwrite/scripts/bdd/report.mjs",
      "expo/copy-overwrite/scripts/bdd/render.mjs",
      "expo/copy-overwrite/scripts/bdd/baseline.mjs",
      "expo/copy-overwrite/scripts/bdd/envelope.mjs",
    ]) {
      expect(fs.existsSync(path.join(REPO_ROOT, relative)), relative).toBe(
        true
      );
    }
  });

  it("seeds bdd/ create-only in the not-adopted state at a zero floor", () => {
    const seed = JSON.parse(read(SEED_MAP_REL)) as {
      adoption: { state: string };
      coverageFloor: Record<string, unknown>;
      schemaVersion: number;
    };
    expect(seed.adoption.state).toBe("not-adopted");
    expect(seed.schemaVersion).toBe(2);
    for (const platform of ["web", "ios", "android"]) {
      expect(seed.coverageFloor[platform], platform).toBe(0);
    }
    expect(
      fs.existsSync(path.join(REPO_ROOT, "expo/create-only/bdd/features/.keep"))
    ).toBe(true);
  });

  it("exposes the gate and matrix on the standard package script surface", () => {
    const scripts = (
      JSON.parse(read("expo/package-lisa/package.lisa.json")) as {
        force: { scripts: Record<string, string> };
      }
    ).force.scripts;
    expect(scripts["bdd:coverage"]).toContain("check-bdd-coverage.mjs");
    expect(scripts["bdd:matrix"]).toContain("bdd-matrix.mjs");
  });

  it("wires bdd_coverage behind the three-state bdd_mode input, not script presence", () => {
    const workflow = read(QUALITY_REL);
    expect(workflow).toContain("bdd_coverage:");
    expect(workflow).toContain("bdd_mode:");
    expect(workflow).toContain("inputs.bdd_mode != 'not-adopted'");
    expect(workflow).toContain("check-bdd-coverage.mjs");
  });

  it("makes enforced mode FAIL on a missing gate instead of skipping it", () => {
    const workflow = read(QUALITY_REL);
    expect(workflow).toContain('if [ "$BDD_MODE" = "enforced" ]');
    expect(workflow).toContain("absence is a FAILURE, never a skip");
  });

  it("gives the ratchet the history and PR context it needs", () => {
    const workflow = read(QUALITY_REL);
    expect(workflow).toContain("BDD_BASE_SHA");
    expect(workflow).toContain("BDD_PR_LABELS");
    const job = workflow.slice(workflow.indexOf("bdd_coverage:"));
    expect(job.slice(0, job.indexOf("learnings_budget:"))).toContain(
      "fetch-depth: 0"
    );
  });

  it("defaults bdd_mode to not-adopted so no repo is enrolled by upgrading", () => {
    const workflow = read(QUALITY_REL);
    const block = workflow.slice(workflow.indexOf("bdd_mode:"));
    expect(block.slice(0, block.indexOf("coverage_services:"))).toContain(
      "default: 'not-adopted'"
    );
  });

  it("ships a ruleset template whose context cannot drift from the job name", () => {
    const workflow = read(QUALITY_REL);
    const ruleset = JSON.parse(read(RULESET_REL)) as {
      rules: {
        parameters?: { required_status_checks?: { context: string }[] };
      }[];
    };
    const checks = ruleset.rules[0].parameters?.required_status_checks ?? [];
    expect(checks).toHaveLength(1);
    expect(checks[0].context).toBe(
      "🔍 Quality Checks / 🧾 BDD Behavior Contract"
    );
    expect(workflow).toContain(`name: ${checks[0].context.split(" / ")[1]}`);
  });

  it("documents the output schema, compatibility policy, and tracker grammar", () => {
    const doc = read(DOC_REL);
    for (const needle of [
      "Compatibility policy",
      "report.schemaVersion",
      "Three-state adoption",
      "coverage-floor ratchet",
      "Tracker-tag grammar",
      "@gh-wiki-124",
      "Execution-result documents",
      "Allowlist, never denylist",
      "lisa-command-envelope-v1",
    ]) {
      expect(doc, needle).toContain(needle);
    }
  });
});
