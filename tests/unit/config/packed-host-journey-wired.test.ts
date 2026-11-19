/**
 * Keeps the packed-host journey runnable by hand once it leaves the PR path
 * (CodySwannGT/lisa#4606).
 *
 * Owner decision 4 of CodySwannGT/lisa#4587 took
 * `tests/integration/shared-runtime-packed-hosts.test.ts` off every pull
 * request. That trade is only safe while a maintainer can still run it on
 * demand, so the dispatch-only workflow and the package script it runs are
 * checked against each other here. The silent failure this guards against is
 * a workflow that still exists but runs the wrong command, under a Node the
 * journey defers on, or on every PR again. The runbook prose
 * (`docs/packed-host-journey.md`) is not pinned (#4867).
 * @module tests/unit/config/packed-host-journey-wired
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** The journey this workflow exists to run. */
const JOURNEY = "tests/integration/shared-runtime-packed-hosts.test.ts";

/** The dispatch-only workflow that runs it. */
const WORKFLOW = ".github/workflows/packed-host-journey.yml";

/** The package script both the workflow and the local command use. */
const SCRIPT = "test:integration:packed-hosts";

/** One workflow step, as far as this file reads it. */
interface Step {
  readonly if?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly with?: Readonly<Record<string, string | boolean>>;
}

/** The workflow, as far as this file reads it. */
interface Workflow {
  readonly on: Readonly<Record<string, unknown>>;
  readonly permissions: Readonly<Record<string, string>>;
  readonly jobs: Readonly<
    Record<
      string,
      {
        readonly if?: string;
        readonly "runs-on": string;
        readonly "timeout-minutes": number;
        readonly strategy?: {
          readonly matrix: Readonly<Record<string, readonly string[]>>;
        };
        readonly steps: readonly Step[];
      }
    >
  >;
}

/**
 * Read a repository file.
 * @param relative - Repository-relative path
 * @returns Its contents
 */
const read = (relative: string): string =>
  readFileSync(path.join(REPO_ROOT, relative), "utf8");

const workflow = parse(read(WORKFLOW)) as Workflow;
const job = workflow.jobs["packed_host_journey"]!;
const steps = job.steps;

describe("the packed-host journey workflow", () => {
  it("is dispatched by hand and by nothing else", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  });

  it("takes a ref to run against, defaulting to main", () => {
    const dispatch = workflow.on["workflow_dispatch"] as {
      inputs: { ref: { default: string; required: boolean } };
    };
    expect(dispatch.inputs.ref.default).toBe("main");
    expect(dispatch.inputs.ref.required).toBe(false);
    const checkout = steps.find(step =>
      step.uses?.startsWith("actions/checkout@")
    );
    expect(checkout?.with?.["ref"]).toBe("${{ inputs.ref }}");
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    // The ref is user input. It reaches git only through the checkout action's
    // `with:`, never interpolated into a shell line.
    expect(steps.some(step => step.run?.includes("inputs.ref"))).toBe(false);
  });

  it("runs only in this repository, read-only, on the pinned image", () => {
    expect(job.if).toBe(
      "github.repository == 'CodySwannGT/lisa' && inputs.journey"
    );
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job["runs-on"]).toBe("ubuntu-24.04");
    expect(job["timeout-minutes"]).toBeGreaterThan(0);
  });

  it("captures the qualified updater Node before selecting the reviewed CI Node", () => {
    const updater = steps.findIndex(
      step => step.with?.["node-version"] === "22.23.3"
    );
    const capture = steps.findIndex(step =>
      step.run?.includes("LISA_TEST_UPDATER_NODE=")
    );
    // The journey refuses (in CI) any outer Node but its CI_NODE, so the
    // shared Node the workflow selects must be that exact version. It comes
    // from .nvmrc, and .nvmrc must agree with the journey: a Node bump that
    // moved one and not the other would make every dispatch fail.
    const shared = steps.findIndex(
      step => step.with?.["node-version-file"] === ".nvmrc"
    );
    expect(updater).toBeGreaterThanOrEqual(0);
    expect(capture).toBeGreaterThan(updater);
    expect(shared).toBeGreaterThan(capture);
    expect(steps[capture]!.run).toContain(
      'process.versions.node !== "22.23.3"'
    );
    const ciNode = /const CI_NODE = "([^"]+)";/u.exec(read(JOURNEY))?.[1];
    expect(ciNode).toBe("24.21.0");
    expect(read(".nvmrc").trim()).toBe(ciNode);
  });

  it("provisions the pinned Bun, Ruby, and a frozen install", () => {
    const manifest = JSON.parse(read("package.json")) as {
      engines: { bun: string };
    };
    expect(
      steps
        .map(step => step.with?.["bun-version"])
        .filter(version => version !== undefined)
    ).toEqual([manifest.engines.bun]);
    expect(steps.some(step => step.uses?.startsWith("ruby/setup-ruby@"))).toBe(
      true
    );
    expect(
      steps.some(step => step.run === "bun install --frozen-lockfile")
    ).toBe(true);
  });

  it("runs the journey through its named package script", () => {
    const run = steps.find(step => step.run?.includes(SCRIPT));
    expect(run?.run).toBe(`bun run ${SCRIPT}`);
    expect(run?.env?.["NODE_OPTIONS"]).toBe("--max-old-space-size=6144");
    const manifest = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts[SCRIPT]).toContain(`vitest run ${JOURNEY}`);
    expect(manifest.scripts[SCRIPT]).not.toContain("--exclude");
  });
});

/** The gated fs-probe diagnostic the workflow can run (#4636, #5066). */
const DIAGNOSTIC = "tests/integration/fs-probe-diagnostic.test.ts";

describe("the fs-probe diagnostic route (CodySwannGT/lisa#4636, #5066)", () => {
  const dispatch = workflow.on["workflow_dispatch"] as {
    inputs: Record<string, { default: unknown; type: string }>;
  };
  const diagnosticJob = workflow.jobs["fs_probe_diagnostic"]!;
  const diagnosticSteps = diagnosticJob.steps;

  it("is a boolean dispatch input that is off unless asked for", () => {
    expect(dispatch.inputs["probe_diagnostic"]).toMatchObject({
      type: "boolean",
      default: false,
    });
  });

  it("can skip the journey, which runs unless told not to", () => {
    expect(dispatch.inputs["journey"]).toMatchObject({
      type: "boolean",
      default: true,
    });
  });

  it("runs only when asked, in its own job, on the journey's image and the unit shards' image", () => {
    expect(diagnosticJob.if).toBe(
      "github.repository == 'CodySwannGT/lisa' && inputs.probe_diagnostic"
    );
    expect(diagnosticJob["runs-on"]).toBe("${{ matrix.image }}");
    expect(diagnosticJob.strategy?.matrix["image"]).toEqual([
      job["runs-on"],
      "ubuntu-latest",
    ]);
    expect(steps.some(step => step.run?.includes(DIAGNOSTIC))).toBe(false);
  });

  it("runs the diagnostic with its flag set", () => {
    const step = diagnosticSteps.find(step => step.run?.includes(DIAGNOSTIC));
    expect(step?.env?.["LISA_FS_PROBE_DIAGNOSTIC"]).toBe("1");
    expect(step?.run).toContain(`bun run test ${DIAGNOSTIC}`);
  });

  it("proves the gated cases executed rather than skipped", () => {
    const proof = diagnosticSteps.find(step =>
      step.run?.includes("scripts/check-test-case-executed.mjs")
    );
    expect(proof?.run).toContain(
      '--name "fs probe diagnostic paired sample 8 of 8"'
    );
    expect(proof?.run).toContain(
      '--name "fs probe diagnostic decomposes a removal into fixed and per-entry cost, settled 1000ms"'
    );
    const source = read(DIAGNOSTIC);
    expect(source).toContain('"paired sample %i of 8"');
    expect(source).toContain(
      '"decomposes a removal into fixed and per-entry cost, settled %ims"'
    );
    expect(source).toContain('process.env["LISA_FS_PROBE_DIAGNOSTIC"] === "1"');
  });

  it("repeats the unit agreement case idle and under load, failing on any miss", () => {
    const loop = diagnosticSteps.find(step =>
      step.run?.includes("tests/unit/helpers/fs-latency-budget.test.ts")
    );
    expect(loop?.env?.["CASE"]).toBe(
      "agrees with a real corpus deletion measured in the same window"
    );
    expect(loop?.run).toContain("repeat idle");
    expect(loop?.run).toContain("repeat loaded");
    expect(loop?.run).toContain('test ! -s "$OUT/agreement-failures.txt"');
  });

  it("records the runner and the mounts the probe writes to", () => {
    const record = diagnosticSteps.find(step => step.run?.includes("findmnt"));
    expect(record?.run).toContain("findmnt -no OPTIONS /");
    expect(record?.run).toContain("findmnt -no SOURCE,FSTYPE,OPTIONS -T /tmp");
  });

  it("still records the journey's runner and root mount options on every dispatch", () => {
    const journey = steps.findIndex(step => step.run?.includes(SCRIPT));
    const record = steps.find(step => step.run?.includes("findmnt"));
    expect(record?.if).toBeUndefined();
    expect(record?.run).toContain("findmnt -no OPTIONS /");
    expect(steps.indexOf(record!)).toBeLessThan(journey);
  });
});
