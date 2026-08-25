/**
 * Tests that the BDD gate is actually shipped and wired: copy-overwrite
 * scripts, the create-only seed, the CI job behind its ONE declaration, the
 * ruleset template whose context cannot drift from the job name, and the
 * versioned docs.
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

/** The gate's job key, and the job after it, bounding the slice asserted on. */
const JOB = "bdd_coverage:";
const NEXT_JOB = "learnings_budget:";

/**
 * The `bdd_coverage` job's own slice of the workflow.
 *
 * Bounded by the next job key so an assertion cannot pass on a string that
 * happens to appear in some other job — several of the phrases below are
 * deliberately shared vocabulary across the file.
 * @param workflow - The whole quality workflow source.
 * @returns Just this job.
 */
function jobBlock(workflow: string): string {
  const job = workflow.slice(workflow.indexOf(JOB));
  return job.slice(0, job.indexOf(NEXT_JOB));
}

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
      "expo/copy-overwrite/scripts/bdd/discover.mjs",
      "expo/copy-overwrite/scripts/bdd/envelope.mjs",
    ]) {
      expect(fs.existsSync(path.join(REPO_ROOT, relative)), relative).toBe(
        true
      );
    }
  });

  it("seeds bdd/ create-only with no adoption block and a zero floor", () => {
    const seed = JSON.parse(read(SEED_MAP_REL)) as {
      coverageFloor: Record<string, unknown>;
      schemaVersion: number;
    };
    // The seed must carry no `adoption` block: the block is retired and the
    // gate refuses it, so shipping one would fail every project that adopts.
    expect(seed).not.toHaveProperty("adoption");
    expect(seed.schemaVersion).toBe(2);
    for (const platform of ["web", "ios", "android"]) {
      expect(seed.coverageFloor[platform], platform).toBe(0);
    }
    expect(
      fs.existsSync(path.join(REPO_ROOT, "expo/create-only/bdd/features/.keep"))
    ).toBe(true);
  });

  it("seeds a discovery block for every runner it seeds a platform for", () => {
    // A seeded runner with no roots can never find an undeclared test, and the
    // seed is create-only — whatever ships here is what most repos will run.
    const seed = JSON.parse(read(SEED_MAP_REL)) as {
      runnerPlatforms: Record<string, unknown>;
      testDiscovery: Record<string, { roots: string[]; evidence: unknown }>;
    };
    const runners = Object.keys(seed.runnerPlatforms).filter(
      key => !key.startsWith("_")
    );
    expect(runners.length).toBeGreaterThan(0);
    for (const runner of runners) {
      expect(seed.testDiscovery[runner]?.roots.length, runner).toBeGreaterThan(
        0
      );
      expect(seed.testDiscovery[runner]?.evidence, runner).toBeTruthy();
    }
    // The subflow directory the fleet's hardcoded roots could not see.
    expect(seed.testDiscovery.maestro.roots).toContain(".maestro/subflows");
  });

  it("documents discovery and exclusions in the versioned schema doc", () => {
    const doc = read(DOC_REL);
    for (const needle of [
      "testDiscovery",
      "spec-undisclosed",
      "exclusion-stale",
      "discovery-invalid",
      "never wedges the artifacts",
    ]) {
      expect(doc, needle).toContain(needle);
    }
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

  it("prints portable package commands in both generated document preambles", () => {
    const matrixGenerator = read(MATRIX_REL);
    const burndownRenderer = read("expo/copy-overwrite/scripts/bdd/render.mjs");

    expect(matrixGenerator).toContain("bun run bdd:matrix");
    expect(matrixGenerator).not.toContain(
      "node scripts/bdd-matrix.mjs --write"
    );
    expect(burndownRenderer).toContain("bun run bdd:coverage:write");
    expect(burndownRenderer).not.toContain(
      "node scripts/check-bdd-coverage.mjs --write"
    );
    expect(read("docs/bdd-scenario-matrix.md")).toContain(
      "Generated by `bun run bdd:matrix`"
    );
    expect(read("docs/e2e-bdd-coverage.md")).toContain(
      "Regenerated by `bun run bdd:coverage:write`"
    );
  });

  it("wires bdd_coverage behind the behavior-contract declaration alone", () => {
    const workflow = read(QUALITY_REL);
    const block = jobBlock(workflow);
    // The declaration is the control: the job resolves the gate and runs the
    // task the registry names.
    expect(block).toContain("GATE_ID: behavior-contract");
    expect(block).toContain("steps.gate.outputs.configured == 'true'");
    // And no second control: the retired input must not appear in the job's
    // `if:`, or the two could disagree again.
    expect(workflow).toContain(JOB);
    expect(block).not.toContain("inputs.bdd_mode != 'not-adopted'");
  });

  it("refuses the retired bdd_mode input rather than ignoring it", () => {
    const block = jobBlock(read(QUALITY_REL));
    expect(block).toContain("Refuse the retired bdd_mode input");
    expect(block).toContain("if: inputs.bdd_mode != ''");
    // The refusal must name the remedy, not merely the refusal.
    expect(block).toContain("'required', 'optional', or 'off'");
  });

  it("stands down when nothing declares the gate, instead of falling back", () => {
    // The six presence-gated jobs fall back to a shipped script when the gate
    // is undeclared. This prover ships to every project on the stack, so the
    // same fallback would enforce a contract nobody adopted.
    const block = jobBlock(read(QUALITY_REL));
    expect(block).toContain("Stand down (behavior-contract is not declared)");
    expect(block).toContain("is UNDECLARED at");
    expect(block).not.toContain("check_script.outputs.exists");
  });

  it("carries a QUALITY_JOB_GATES row and no ungated exemption", async () => {
    const registry =
      (await import("../../../all/copy-overwrite/scripts/lisa-gates.mjs")) as {
        QUALITY_JOB_GATES: Record<string, string>;
        UNGATED_QUALITY_JOBS: Record<string, unknown>;
        REGISTRY: Record<string, { label: string }>;
      };
    expect(registry.QUALITY_JOB_GATES.bdd_coverage).toBe("behavior-contract");
    expect(registry.UNGATED_QUALITY_JOBS).not.toHaveProperty("bdd_coverage");
    // `contextsFor()` derives `🔍 Quality Checks / <label>`, so a label that
    // differs from the job name by one character derives a required context
    // nothing ever posts.
    expect(registry.REGISTRY["behavior-contract"].label).toBe(
      "🧾 BDD Behavior Contract"
    );
    expect(read(QUALITY_REL)).toContain(
      `name: ${registry.REGISTRY["behavior-contract"].label}`
    );
  });

  it("gives the non-regression checks the history they need", () => {
    const workflow = read(QUALITY_REL);
    expect(workflow).toContain("BDD_BASE_SHA");
    const job = workflow.slice(workflow.indexOf(JOB));
    expect(job.slice(0, job.indexOf(NEXT_JOB))).toContain("fetch-depth: 0");
  });

  it("resolves a base revision on every event, not only on a pull request", () => {
    // The gate fails without a base, so resolving one cannot be best-effort:
    // PR base, else the fork point from the default branch, else the first
    // parent.
    const block = jobBlock(read(QUALITY_REL));
    expect(block).toContain("Resolve the base revision");
    expect(block).toContain("github.event.pull_request.base.sha");
    expect(block).toContain("git merge-base");
    expect(block).toContain("BDD_BASE_SHA: ${{ steps.bdd_base.outputs.sha }}");
  });

  it("keeps bdd_mode declared, defaulting to empty, so callers still parse", () => {
    // Deleting the input would make every unmigrated caller's workflow file
    // invalid — GitHub rejects an undefined input on a reusable workflow — so
    // the retirement is enforced in the job, where the message can be read.
    const workflow = read(QUALITY_REL);
    const block = workflow.slice(workflow.indexOf("bdd_mode:"));
    const declaration = block.slice(0, block.indexOf("coverage_services:"));
    expect(declaration).toContain("default: ''");
    expect(declaration).toContain("RETIRED");
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
      "## Adoption",
      "What was retired, and why",
      "Non-regression invariants",
      "Why the ratchet was removed",
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
