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

/** Native workflow dependency and execution contract. */
interface Job {
  readonly name?: string;
  readonly needs?: string;
  readonly if?: string;
  readonly "timeout-minutes"?: number;
  readonly strategy?: {
    readonly "fail-fast": boolean;
    readonly matrix: { readonly shard: readonly number[] };
  };
  readonly steps: readonly Step[];
}

/**
 * Read actual required workflow job steps through a YAML parser.
 * @param file - Repository-relative workflow path
 * @param job - Actual native job identifier
 * @returns Parsed ordered steps
 */
function steps(file: string, job: string): readonly Step[] {
  return jobs(file)[job]!.steps;
}

/**
 * Parse dependency and step contracts from the actual native workflow.
 * @param file - Repository-relative workflow path
 * @returns Native workflow jobs
 */
function jobs(file: string): Readonly<Record<string, Job>> {
  const workflow = parse(readFileSync(path.join(ROOT, file), "utf8")) as {
    jobs: Record<string, Job>;
  };
  return workflow.jobs;
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
    assertUpdaterNode(items);
    assertHostBun(items);
    expect(
      items.some(step => step.run?.includes("bun run test:integration"))
    ).toBe(true);
  });

  it("full native shell-trace shards retain both qualified runtimes and original budgets", () => {
    const producer = jobs(".github/workflows/plugins-sync.yml")["guard-trace"]!;
    const items = producer.steps;
    assertUpdaterNode(items);
    assertHostBun(items);
    expect(producer.strategy?.matrix.shard).toEqual([1, 2, 3]);
    expect(producer.strategy?.["fail-fast"]).toBe(false);
    expect(producer["timeout-minutes"]).toBe(30);
    const collect = items.find(step => step.run?.includes("--collect-only"))!;
    expect(collect.run).toContain(
      "bun run lisa-test-run -- --adapter direct -- node"
    );
    expect(collect.run).toContain(
      'scripts/check-shell-guard-refusal-coverage.mjs --collect-only --shard "${{ matrix.shard }}/3"'
    );
    expect(
      items.some(step => step.run === "bun install --frozen-lockfile")
    ).toBe(true);
    // Use the real named package script, including its single build and profile;
    // unnamed Bun launches make packed CLI apply inherit an install context.
    const manifest = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };
    expect(manifest.scripts["lisa-test-run"]).toBe(
      "node scripts/lib/worktree-dependencies.mjs && bun run build && node dist/cli/lisa-test-run.js --profile lisa"
    );
    expect(items.some(step => step.run === "bun run build")).toBe(false);
    expect(
      items.find(step => step.uses?.startsWith("actions/upload-artifact@"))
        ?.with?.["name"]
    ).toBe(
      "lisa-shell-guard-${{ github.run_id }}-${{ github.run_attempt }}-shard-${{ matrix.shard }}"
    );
  });

  it("required shell judgment retains both runtimes and refuses incomplete native shard dependencies", () => {
    const aggregate = jobs(".github/workflows/plugins-sync.yml")[
      "plugins-sync"
    ]!;
    const items = aggregate.steps;
    assertUpdaterNode(items);
    assertHostBun(items);
    expect(aggregate.name).toBe("🧩 Plugin artifacts match source");
    expect(aggregate.needs).toBe("guard-trace");
    expect(aggregate.if).toBe("always()");
    expect(aggregate["timeout-minutes"]).toBe(30);
    expect(
      items.some(step =>
        step.run?.includes('process.env.TRACE_SHARDS_RESULT !== "success"')
      )
    ).toBe(true);
    expect(
      items.find(step => step.uses?.startsWith("actions/download-artifact@"))
        ?.with?.["pattern"]
    ).toBe(
      "lisa-shell-guard-${{ github.run_id }}-${{ github.run_attempt }}-shard-*"
    );
    const merge = items.find(step => step.run?.includes("--merge-traces"))!;
    expect(merge.run).toContain(
      "node dist/cli/lisa-test-run.js --profile lisa --adapter direct"
    );
    expect(merge.run).toContain(
      "scripts/check-shell-guard-refusal-coverage.mjs --merge-traces"
    );
    expect(merge.run).toContain("--trace-out .lisa/shell-guard-trace.jsonl");
  });
});
