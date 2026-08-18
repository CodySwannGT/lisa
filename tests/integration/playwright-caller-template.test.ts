/**
 * Tests the seeded `playwright-e2e.yml` caller for the expo lane.
 *
 * The template exists because Playwright inside ci.yml couples the heaviest
 * suite in a project to the lint/typecheck gate. Splitting it out means a
 * single-suite caller, and a single-suite caller against today's quality.yml
 * has to INVERT `skip_jobs` — naming the two dozen jobs it does not want.
 *
 * That inversion goes stale silently: a job added to quality.yml is absent
 * from a hand-written list and therefore RUNS on a nightly whose whole point
 * is that it runs one suite. The first project to adopt this shape was already
 * missing five keys by the time this template was written. So the list is not
 * reviewed here, it is DERIVED from quality.yml and compared — the only form
 * of this assertion that cannot rot alongside the thing it checks.
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
const QUALITY_YML = path.join(REPO_ROOT, ".github", "workflows", "quality.yml");

/** The one job key this caller wants to KEEP. */
const KEPT = "playwright_e2e";

const template = loadWorkflow(TEMPLATE);
const call = template.jobs.playwright as {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
};

/**
 * Every job key `quality.yml` actually tests `skip_jobs` against.
 *
 * Read out of the workflow's own conditions rather than out of the `skip_jobs`
 * input DESCRIPTION: the description has been wrong before — four security
 * keys (`sonarcloud`, `snyk`, `secret_scanning`, `license_compliance`) are
 * real and undocumented in it — and a caller that trusted the prose would skip
 * fewer jobs than it believed.
 * @returns The skip keys, sorted.
 */
const skipKeysInQuality = (): string[] => {
  const source = fs.readFileSync(QUALITY_YML, "utf8");
  const keys = new Set<string>();
  const pattern = /format\(',\{0\},', inputs\.skip_jobs\), ',([^,']+),'\)/g;
  for (const match of source.matchAll(pattern)) {
    keys.add(match[1]);
  }
  return [...keys].toSorted((left, right) => left.localeCompare(right));
};

describe("the caller targets Lisa's reusable quality workflow", () => {
  it("calls quality.yml", () => {
    expect(call.uses).toBe(
      "CodySwannGT/lisa/.github/workflows/quality.yml@main"
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

describe("the inverted skip_jobs list is exhaustive", () => {
  const declared = String(call.with?.skip_jobs ?? "")
    .split(",")
    .filter(Boolean);

  it("skips every job quality.yml can skip, except the Playwright one", () => {
    const expected = skipKeysInQuality().filter(key => key !== KEPT);
    expect(declared.toSorted((a, b) => a.localeCompare(b))).toEqual(expected);
  });

  it("does not skip the suite it exists to run", () => {
    expect(declared).not.toContain(KEPT);
  });

  it("names no key quality.yml does not test", () => {
    // The mirror of the assertion above, and not redundant with it: a typo'd
    // key silently skips nothing, so a list can be both complete and wrong.
    const real = new Set(skipKeysInQuality());
    expect(declared.filter(key => !real.has(key))).toEqual([]);
  });

  it("carries no spaces, because tokens are matched exactly", () => {
    // `,{0},` is a literal comma-delimited match. `lint, lint_slow` skips
    // `lint` and then looks for a job called ` lint_slow`, which does not
    // exist — so the second one runs, silently.
    expect(String(call.with?.skip_jobs ?? "")).not.toContain(" ");
  });
});

describe("the caller cannot collide with ci.yml", () => {
  it("reports under a job name distinct from the callee's", () => {
    // A reusable call reports as `<caller job name> / <callee job name>`.
    // Two workflows must not produce the same reported check, and the
    // identity is the JOB name — not the workflow-level `name:`.
    expect(call.name).toBe("🎭 Playwright Web E2E");
    const quality = loadWorkflow(QUALITY_YML);
    const calleeName = (
      quality.jobs.playwright_e2e_aggregate as { name?: string }
    ).name;
    expect(call.name).not.toBe(calleeName);
  });

  it("tells the reader that ci.yml must keep skipping playwright_e2e", () => {
    // The collision is not preventable from inside this file; the only
    // defence is that whoever seeds it knows. Losing the note loses the
    // defence.
    const source = fs.readFileSync(TEMPLATE, "utf8");
    expect(source).toContain("Keep ci.yml's");
    expect(source).toContain("`skip_jobs` naming `playwright_e2e`");
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
