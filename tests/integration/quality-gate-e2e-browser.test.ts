/**
 * Tests that declaring `e2e-browser` governs the Playwright suite.
 *
 * The three jobs asserted here left `quality.yml` for `playwright-e2e.yml`
 * after this file was written. Nothing about the contract moved with them —
 * the façade still attaches to the aggregator, the matrix still carries a
 * second copy of the resolution, and the two still must not drift. What the
 * move changed is only which file the assertions read, and every entry point
 * below now says so explicitly rather than defaulting.
 *
 * The gate was in the registry from the start and nothing read it. Declaring
 * it `required` changed nothing (the job already ran on every pull request),
 * and declaring it `off` changed nothing either — the exact "a declaration
 * that governs nothing is worse than no declaration" defect that
 * `quality-gate-off-state.test.ts` records for `test-node-suites`. Measured
 * before this change: zero of the four expo consumers declared it, and the one
 * with a standalone Playwright workflow inverted `skip_jobs` instead, naming
 * the two dozen jobs it did NOT want.
 *
 * This gate is the first whose built-in implementation spans TWO jobs — a
 * sharded matrix and the aggregator that judges it — and the façade contract
 * can only attach to the aggregator (the matrix rewrites its own context name
 * with a `(<shard>)` suffix, and a context name is matched by exact string in
 * a ruleset). So the resolution is repeated on the matrix job under a
 * different step id, and this file is what stops the two copies drifting.
 * @module tests/integration/quality-gate-e2e-browser
 */

import { describe, expect, it } from "vitest";

import {
  CONFIGURED,
  DECLARED_OFF,
  NOT_CONFIGURED,
  PLAYWRIGHT_YML,
  jobIn,
  resolveStep,
  stepNamed,
  stepsIn,
} from "./quality-gate-facade-fixture.js";

/** The workflow the suite lives in. */
const FILE = PLAYWRIGHT_YML;

/** The façade job — the one whose name is the branch-protection context. */
const AGGREGATE = "playwright_e2e_aggregate";

/** The sharded job that implements the fallback path. */
const MATRIX = "playwright_e2e";

/** The subordinate resolve step's id on the matrix job. */
const MATRIX_GATE_ID = "e2e_gate";

/**
 * The matrix job's copy of the resolution.
 * @returns The subordinate resolve step, or undefined.
 */
const matrixResolve = () =>
  stepsIn(MATRIX, FILE).find(step => step.id === MATRIX_GATE_ID);

describe("the two resolutions cannot drift apart", () => {
  it("resolves the same gate id on both jobs", () => {
    expect(resolveStep(AGGREGATE, FILE)?.env?.GATE_ID).toBe("e2e-browser");
    expect(matrixResolve()?.env?.GATE_ID).toBe("e2e-browser");
  });

  it("uses a byte-identical resolve body on both jobs", () => {
    // The canonical block is already pinned against the other fifteen by
    // `quality-gate-facade.test.ts`. Pinning the matrix copy to the canonical
    // one therefore pins it to all of them, transitively — which is the point
    // of comparing against the aggregate rather than against a literal.
    expect(matrixResolve()?.run).toBe(resolveStep(AGGREGATE, FILE)?.run);
  });

  it("passes the same env to both, so neither can resolve at a different moment", () => {
    expect(matrixResolve()?.env).toEqual(resolveStep(AGGREGATE, FILE)?.env);
  });

  it("keeps the matrix copy under a DIFFERENT step id", () => {
    // `id: gate` is what `quality-gate-moment-input.test.ts` enumerates, and
    // the façade fixture refuses a matrix job — correctly, because a matrix
    // suffixes its context name. If this ever becomes `gate`, that test fails
    // with a confusing message about an unlisted job; this one says why.
    expect(matrixResolve()?.id).not.toBe("gate");
    expect(
      (jobIn(MATRIX, FILE) as { strategy?: unknown }).strategy
    ).toBeDefined();
  });
});

describe("exactly one job runs the suite, on every path", () => {
  const shardWork = [
    "🔧 Playwright setup",
    "🎭 Install Playwright browsers",
    "🎭 Run Playwright tests",
    "📤 Upload Playwright blob",
  ];

  it.each(shardWork)(
    "the matrix step %s runs only when no gate is configured",
    name => {
      expect(stepNamed(MATRIX, name, FILE)?.if).toContain(
        `steps.${MATRIX_GATE_ID}.outputs.configured == 'false'`
      );
    }
  );

  it("says out loud when the matrix is idle rather than passing silently", () => {
    // A shard that ran nothing and a shard that ran and passed are the same
    // green square. The notice is the only thing that distinguishes them in
    // the log.
    const idle = stepNamed(
      MATRIX,
      "⏭️ Shard idle — the e2e-browser gate owns this suite",
      FILE
    );
    expect(idle?.if).toBe(
      `steps.${MATRIX_GATE_ID}.outputs.configured != 'false'`
    );
  });

  it("builds the web export on the configured path too", () => {
    // Without this the project's own task would run against no export and
    // fail for a reason that has nothing to do with its specs.
    expect(stepNamed(AGGREGATE, "🌐 Build web export", FILE)?.if).toContain(
      CONFIGURED
    );
    expect(
      stepNamed(AGGREGATE, "🎭 Install Playwright browsers", FILE)?.if
    ).toContain(CONFIGURED);
  });

  it("does not merge shard blobs the configured path never wrote", () => {
    expect(
      stepNamed(AGGREGATE, "🎭 Merge blob reports into HTML", FILE)?.if
    ).toContain(NOT_CONFIGURED);
  });

  it("judges the shard matrix only on the path that produced it", () => {
    // `needs.playwright_e2e.result` is 'skipped' whenever a gate is declared,
    // and 'skipped' already satisfies the verdict — but relying on that would
    // make the verdict correct by coincidence rather than by construction.
    expect(
      stepNamed(AGGREGATE, "🚨 Fail if any Playwright shard failed", FILE)?.if
    ).toContain(NOT_CONFIGURED);
  });
});

describe("a declared gate with no suite is refused, not greened", () => {
  it("fails when e2e-browser is declared and no Playwright config exists", () => {
    const guard = stepNamed(
      AGGREGATE,
      "🚨 e2e-browser is declared but there is no Playwright config",
      FILE
    );
    expect(guard?.if).toBe(
      `steps.check_playwright.outputs.has_config != 'true' && ${CONFIGURED}`
    );
    expect(guard?.run).toContain("exit 1");
  });

  it("keeps the no-config NOTICE on the fallback path only", () => {
    // Same shape as `sg_scan`'s ⏭️ notice. An absent suite is unremarkable
    // when nobody claimed there was one, and a hard error when someone did.
    expect(
      stepNamed(AGGREGATE, "🎭 Playwright aggregator skipped (no config)", FILE)
        ?.if
    ).toContain(NOT_CONFIGURED);
  });
});

describe("off empties the job instead of skipping it", () => {
  it("leaves the job's own condition free of the gates block", () => {
    // A required status context that runs zero steps reports SATISFIED. `off`
    // must therefore empty the job; dropping the context is `contextsFor`'s
    // job, from the same declaration.
    const condition = jobIn(AGGREGATE, FILE).if ?? "";
    expect(condition).not.toContain("gates");
    expect(condition).not.toContain("lisa.config");
  });

  it("says the job was emptied on purpose", () => {
    expect(stepNamed(AGGREGATE, "⏭️ e2e-browser declared off", FILE)?.if).toBe(
      DECLARED_OFF
    );
  });

  it("runs no work step on the off path", () => {
    // Every step except checkout, the config probe, the toolchain, the
    // resolver and the off notice must name a gate state that CANNOT hold
    // while the gate is off. A step that names none of them would run under
    // `off`.
    //
    // Three predicates, not two. `level == 'optional'` is the third and is
    // false under `off` for the same reason the other two are — the resolve
    // step emits `off` for both outputs — so a step keyed on it is excluded
    // from the off path by its own condition. It is listed here rather than
    // added to `exempt` deliberately: an exemption is a name nobody re-checks,
    // and a predicate is a claim this assertion keeps making.
    const excludesOff = [
      "steps.gate.outputs.configured == 'true'",
      "steps.gate.outputs.configured == 'false'",
      "steps.gate.outputs.level == 'optional'",
    ];
    const exempt = new Set([
      "📥 Checkout repository",
      "🔍 Check for Playwright config",
      "🔧 Setup Node.js",
      "🍞 Setup Bun",
      "📦 Install dependencies",
      "🎛️ Resolve the e2e-browser gate",
      "⏭️ e2e-browser declared off",
    ]);
    const unconditioned = stepsIn(AGGREGATE, FILE)
      .filter(step => !exempt.has(step.name ?? ""))
      .filter(
        step =>
          !excludesOff.some(predicate => (step.if ?? "").includes(predicate))
      )
      .map(step => step.name);
    expect(unconditioned).toEqual([]);
  });
});

describe("the suite the gate governs is given room to run", () => {
  it("gives the façade job the shard job's timeout, not the merge job's", () => {
    // 10 minutes was sized for "download blobs and merge them". On the
    // configured path this job runs the whole suite.
    const timeout = (job: string) =>
      (jobIn(job, FILE) as { "timeout-minutes"?: number })["timeout-minutes"];
    // The shared value is asserted outright as well as compared: two jobs that
    // both lost their `timeout-minutes` would otherwise agree, as undefined.
    expect(timeout(MATRIX)).toBe(60);
    expect(timeout(AGGREGATE)).toBe(timeout(MATRIX));
  });
});
