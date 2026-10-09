/** Required CI consumers retain real qualified runtimes before shared tooling. */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");

/** Minimal workflow execution shape consumed by these source contracts. */
interface Step {
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Readonly<Record<string, string>>;
}

/**
 * Read actual required workflow job steps through a YAML parser.
 * @param file - Repository-relative workflow path
 * @param job - Actual native job identifier
 * @returns Parsed ordered steps
 */
function steps(file: string, job: string): readonly Step[] {
  const workflow = parse(readFileSync(path.join(ROOT, file), "utf8")) as {
    jobs: Record<string, { steps: Step[] }>;
  };
  return workflow.jobs[job]!.steps;
}

/**
 * Require the genuine host Bun capture before selecting ordinary Lisa tooling.
 * @param items - Ordered native job steps
 */
function assertHostBun(items: readonly Step[]): void {
  const provision = items.findIndex(
    step => step.with?.["bun-version"] === "1.3.11"
  );
  const capture = items.findIndex(step =>
    step.run?.includes("LISA_TEST_HOST_BUN=")
  );
  const tooling = items.findIndex(
    step => step.with?.["bun-version"] === "1.3.8"
  );
  expect(provision).toBeGreaterThanOrEqual(0);
  expect(capture).toBeGreaterThan(provision);
  expect(tooling).toBeGreaterThan(capture);
  expect(items[capture]!.run).toContain('Bun.version !== "1.3.11"');
  expect(items[capture]!.run).toContain("realpathSync(process.execPath)");
}

/**
 * Require the qualified native Node probe/capture before restoring shared Node.
 * @param items - Ordered native job steps
 */
function assertUpdaterNode(items: readonly Step[]): void {
  const provision = items.findIndex(
    step => step.with?.["node-version"] === "22.23.3"
  );
  const capture = items.findIndex(step =>
    step.run?.includes("LISA_TEST_UPDATER_NODE=")
  );
  const shared = items.findIndex(
    (step, index) => index > capture && step.uses === "actions/setup-node@v6"
  );
  expect(provision).toBeGreaterThanOrEqual(0);
  expect(capture).toBeGreaterThan(provision);
  expect(shared).toBeGreaterThan(capture);
  expect(items[capture]!.run).toContain('process.versions.node !== "22.23.3"');
  expect(items[capture]!.run).toContain("realpathSync(process.execPath)");
}

describe("qualified runtimes in required CI execution paths", () => {
  it("unit coverage retains real updater Node and native host Bun before shared tooling", () => {
    const items = steps(".github/workflows/quality.yml", "test_unit");
    assertUpdaterNode(items);
    assertHostBun(items);
  });

  it("integration retains actual native host Bun and the unchanged native test command", () => {
    const items = steps(".github/workflows/quality.yml", "test_integration");
    assertHostBun(items);
    expect(
      items.some(step => step.run?.includes("bun run test:integration"))
    ).toBe(true);
  });

  it("required shell tracing retains both runtimes and still executes the full tracer", () => {
    const items = steps(".github/workflows/plugins-sync.yml", "plugins-sync");
    assertUpdaterNode(items);
    assertHostBun(items);
    expect(
      items.some(step => step.run === "bun run check:shell-guard-refusals")
    ).toBe(true);
  });
});
