/**
 * Tests the seeded `playwright-e2e.yml` caller for the expo lane.
 *
 * The template exists because Playwright inside ci.yml couples the heaviest
 * suite in a project to the lint/typecheck gate. Splitting it out used to mean
 * a single-suite caller INVERTING `skip_jobs` — naming the two dozen jobs it
 * did not want — because quality.yml was the only workflow that ran the suite.
 *
 * That inversion went stale silently: a job added to quality.yml was absent
 * from a hand-written list and therefore RAN on a nightly whose whole point is
 * that it runs one suite. The first project to adopt the shape was already
 * missing five keys by the time this template was written.
 *
 * The suite now has its own reusable workflow and the list is gone. What is
 * checked here instead is that the caller targets it, passes only inputs it
 * declares, and still carries the ci.yml collision note — which is load-bearing
 * for as long as quality.yml keeps its own copy of the jobs.
 * @module tests/integration/playwright-caller-template
 */

import * as fs from "fs-extra";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { isMoment } from "../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { loadWorkflow } from "../helpers/workflow-test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The seeded caller under test. */
const TEMPLATE = path.join(
  REPO_ROOT,
  "expo",
  "create-only",
  ".github",
  "workflows",
  "playwright-e2e.yml"
);

/** The reusable workflow it calls. */
/** The dedicated reusable this caller now targets. */
const PLAYWRIGHT_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "playwright-e2e.yml"
);

const template = loadWorkflow(TEMPLATE);
const call = template.jobs.playwright as {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
};

describe("the caller targets Lisa's reusable quality workflow", () => {
  it("calls the dedicated Playwright workflow, not quality.yml", () => {
    // The suite used to ride inside quality.yml, selected by INVERTING
    // skip_jobs. Pointing here is what retires that list.
    expect(call.uses).toBe(
      "CodySwannGT/lisa/.github/workflows/playwright-e2e.yml@main"
    );
  });

  it("resolves gates at a moment Lisa knows", () => {
    // A moment Lisa does not know is REFUSED by the resolver rather than
    // treated as "nothing declared", but the refusal happens in CI. A
    // template shipping one would break every project it is seeded into.
    const moment = call.with?.moment;
    expect(typeof moment).toBe("string");
    expect(isMoment(moment as string)).toBe(true);
  });

  it("resolves at a continuous moment, matching its own cadence", () => {
    // The registry allows `e2e-browser` at PR_ONWARD and continuous. This
    // workflow has no `pull_request` trigger, so declaring it at
    // `pull-request` here would resolve a gate at a moment this file never
    // reaches — the declaration would read as a decision and govern nothing.
    expect(call.with?.moment).toMatch(/^continuous:/);
    expect(template.on?.pull_request).toBeUndefined();
    expect(template.on?.schedule).toBeDefined();
  });
});

describe("the caller no longer inverts skip_jobs", () => {
  it("passes no skip_jobs at all", () => {
    // The inversion this move exists to end. It went stale silently: a job
    // added to quality.yml was absent from every hand-written list and
    // therefore RAN on a nightly whose whole point is that it runs one suite.
    expect(call.with).not.toHaveProperty("skip_jobs");
  });

  it("passes only inputs the callee declares", () => {
    // Replaces the derived-list assertion with the property that actually
    // matters now: an input the callee does not declare is a hard error at
    // dispatch, and a RENAMED input is silently dropped rather than refused —
    // so the caller would run with a default nobody chose.
    const callee = loadWorkflow(PLAYWRIGHT_YML);
    const declared = new Set(
      Object.keys(callee.on?.workflow_call?.inputs ?? {})
    );

    expect(declared.size).toBeGreaterThan(0);
    expect(
      Object.keys(call.with ?? {}).filter(key => !declared.has(key))
    ).toEqual([]);
  });

  it("asks for an environment to be prepared before the suite", () => {
    // Cleanup-after was the measured starting point on a live consumer: an
    // `if: always()` reset AFTER the browser suite, which does not run when a
    // runner dies, is cancelled, or is evicted.
    expect(call.with?.prepare_environment).toBeTruthy();
    expect(call.with?.prepare_verbs).toBe("reset,reseed");
  });
});

describe("the caller cannot collide with ci.yml", () => {
  it("reports under a job name distinct from the callee's", () => {
    // A reusable call reports as `<caller job name> / <callee job name>`.
    // Two workflows must not produce the same reported check, and the
    // identity is the JOB name — not the workflow-level `name:`.
    expect(call.name).toBe("🎭 Playwright Web E2E");
    const callee = loadWorkflow(PLAYWRIGHT_YML);
    const calleeName = (
      callee.jobs.playwright_e2e_aggregate as { name?: string }
    ).name;
    expect(call.name).not.toBe(calleeName);
  });

  it("tells the reader to suppress the other copy with the GATE, not skip_jobs", () => {
    // The collision is not preventable from inside this file; the only defence
    // is that whoever seeds it knows. Losing the note loses the defence.
    //
    // And the note must name the surviving mechanism. `skip_jobs` is being
    // retired in favour of gate levels, and the gate already controls this
    // suite completely inside quality.yml — `off` reaches the "declared off"
    // path and neither the built-in run nor the declared task executes. A note
    // pointing at the retiring mechanism would age into wrong advice.
    const source = fs.readFileSync(TEMPLATE, "utf8");

    expect(source).toContain("SUPPRESS IT WITH THE GATE, NOT WITH `skip_jobs`");
    expect(source).toContain('"pull-request": "off"');
  });
});

describe("the seeded file says it is the project's own", () => {
  it("carries the create-only ownership banner", () => {
    // Stated in this file as well as in the shared header test because the
    // lane choice is load-bearing HERE: a caller carries irreducibly
    // project-specific values (target environment, setup command, cadence),
    // and a copy-overwrite asset would either clobber them or freeze on first
    // edit while still presenting as managed.
    const source = fs.readFileSync(TEMPLATE, "utf8");
    expect(source.startsWith("# Seeded by Lisa on first setup")).toBe(true);
  });

  it("warns that a declared gate over an absent suite is refused", () => {
    const source = fs.readFileSync(TEMPLATE, "utf8");
    expect(source).toContain("DELETE THIS FILE");
  });
});
