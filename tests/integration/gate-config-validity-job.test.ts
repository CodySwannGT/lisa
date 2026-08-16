/**
 * Tests the job that validates a project's own gates block.
 *
 * `lisa-gates.mjs validate` catches unknown gate ids, illegal moments and
 * malformed levels — and until this job existed, nothing ran it. Its only
 * callers were prose lines inside lisa-doctor SKILL.md files, so a typo'd gate
 * id resolved to nothing and read as a working declaration. That is
 * `declared-but-uncallable` applied to config validation itself.
 *
 * The load-bearing property is that this job is NOT gate-configurable and NOT
 * skippable: a project able to switch off validation of its own declarations
 * could manufacture exactly the vacuous green the registry exists to prevent.
 * @module tests/integration/gate-config-validity-job
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { source, workflow } from "./quality-gate-facade-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GATES = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-gates.mjs"
);

/** The job id under test. */
const JOB = "gate_config_validity";

/** Its branch-protection context name. */
const JOB_NAME = "🧭 Gate Config Validity";

describe("the gate-config validity job exists and is unconditional", () => {
  it("declares the job", () => {
    expect(workflow.jobs[JOB]).toBeDefined();
  });

  it("carries the exact context name a ruleset matches", () => {
    expect((workflow.jobs[JOB] as { name?: string }).name).toBe(JOB_NAME);
  });

  it("cannot be turned off with skip_jobs", () => {
    // Every other job honours skip_jobs. This one must not: a project able to
    // skip validation of its own gates block could declare anything at all.
    expect(workflow.jobs[JOB].if ?? "").not.toContain("skip_jobs");
  });

  it("has no condition at all, so it runs on every pull request", () => {
    expect(workflow.jobs[JOB].if).toBeUndefined();
  });

  it("is not itself a configurable gate", () => {
    // A `gates` entry for this job would let .lisa.config.json declare it off,
    // which is the same circularity by another route.
    const steps = workflow.jobs[JOB].steps ?? [];
    expect(steps.find(step => step.id === "gate")).toBeUndefined();
  });

  it("reports failure rather than continuing", () => {
    const steps = workflow.jobs[JOB].steps ?? [];
    expect(
      (workflow.jobs[JOB] as Record<string, unknown>)["continue-on-error"]
    ).toBeUndefined();
    for (const step of steps) {
      expect(
        (step as Record<string, unknown>)["continue-on-error"]
      ).toBeUndefined();
    }
  });
});

describe("it resolves the shipped resolver, preferring the package copy", () => {
  const body =
    (workflow.jobs[JOB].steps ?? []).find(step =>
      step.name?.includes("Validate the gates block")
    )?.run ?? "";

  it("prefers node_modules over the in-repo copy", () => {
    // The same file ships inside @codyswann/lisa, so reading it from the
    // package is one versioned copy rather than a per-repo fork that silently
    // stops receiving fixes.
    const pkg = body.indexOf("node_modules/@codyswann/lisa");
    const repo = body.indexOf('"scripts/lisa-gates.mjs"');
    expect(pkg).toBeGreaterThan(-1);
    expect(repo).toBeGreaterThan(-1);
    expect(pkg).toBeLessThan(repo);
  });

  it("still resolves Lisa validating itself", () => {
    expect(body).toContain("all/copy-overwrite/scripts/lisa-gates.mjs");
  });

  it("actually runs validate", () => {
    expect(body).toContain("validate");
  });

  it("fails when a gates block exists but no resolver does", () => {
    // The dangerous asymmetry: no block and no resolver is a project not yet
    // on the template, but a block with no resolver means declarations govern
    // the required contexts and nothing can check them.
    expect(body).toContain("declares a gates block but no lisa-gates.mjs");
    expect(body).toContain("exit 1");
  });

  it("does not discard the resolver's stderr", () => {
    expect(body).not.toContain("2>/dev/null");
    expect(body).toContain("set -euo pipefail");
  });
});

describe("validate bites — the behaviour the job depends on", () => {
  /**
   * Run `validate` against a throwaway config.
   * @param config The `.lisa.config.json` contents.
   * @returns Exit status and merged output.
   */
  const seed = (config: unknown): string => {
    const dir = mkdtempSync(path.join(tmpdir(), "lisa-cfg-"));
    const file = path.join(dir, ".lisa.config.json");
    writeFileSync(file, JSON.stringify(config), "utf8");
    return dir;
  };

  const validate = (config: unknown) => {
    const dir = seed(config);
    const result = spawnSync(process.execPath, [GATES, "validate"], {
      cwd: dir,
      encoding: "utf8",
    });
    rmSync(dir, { recursive: true, force: true });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  };

  it("fails an unknown gate id and suggests the real one", () => {
    const { status, out } = validate({
      gates: { "test-node-suits": { "pull-request": "optional" } },
    });
    expect(status).not.toBe(0);
    expect(out).toContain("test-node-suites");
  });

  it("fails a gate declared at a moment it cannot run at", () => {
    const { status } = validate({
      gates: { "code-style": { "session-start": "required" } },
    });
    expect(status).not.toBe(0);
  });

  it("fails a level that is not a level", () => {
    const { status } = validate({
      gates: { "code-style": { "pull-request": "mandatory" } },
    });
    expect(status).not.toBe(0);
  });

  it("passes a correct declaration", () => {
    const { status } = validate({
      gates: { "code-style": { run: "lint", "pull-request": "required" } },
    });
    expect(status).toBe(0);
  });

  it("passes a project with no gates block at all", () => {
    const { status } = validate({});
    expect(status).toBe(0);
  });
});

describe("the workflow documents why this job is unskippable", () => {
  it("says so in the source, where the next person to add skip_jobs will look", () => {
    expect(source).toContain("DELIBERATELY NOT A GATE");
  });
});
