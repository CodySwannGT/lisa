/**
 * Regression tests for CodySwannGT/lisa#3050.
 *
 * Lisa ships one change down two channels at two speeds — a reusable workflow
 * body reaches a consumer at `@main` on their next run, and the caller-tree
 * script it invokes reaches them only when somebody applies — and before this
 * module nothing measured the gap. These tests pin the comparator that can:
 * which channel an artifact arrives on, what an absent restoring half costs,
 * and — the part that matters most — that a run which measured nothing says so
 * instead of reporting all-clear.
 */
import { describe, expect, it } from "vitest";
import {
  classifyTwoChannelDelivery,
  HANDLING_SIGNALS,
  resolveDeliveryChannel,
  type CouplingInput,
} from "../../../src/core/two-channel-delivery.js";

/** The workflow every fixture belongs to. */
const WORKFLOW = "quality.yml";

/** The caller-tree path every fixture reads. */
const PROVER = "scripts/prover.mjs";

/** That fixture's stable ledger key. */
const PROVER_KEY = `${WORKFLOW}::${PROVER}`;

/** A refreshing lane, so the fixture resolves to the apply channel. */
const APPLY_LANE = "all/copy-overwrite";

/** A scaffold-time-only lane, so the fixture resolves to create-only. */
const CREATE_ONLY_LANE = "expo/create-only";

/**
 * A coupling with everything the tests do not care about filled in.
 * @param overrides - Fields this test cares about
 * @returns The coupling
 */
function coupling(overrides: Partial<CouplingInput> = {}): CouplingInput {
  return {
    workflow: WORKFLOW,
    step: "🧪 Run a gate",
    path: PROVER,
    lanes: [APPLY_LANE],
    packageBacked: false,
    guarded: false,
    handling: [],
    ...overrides,
  };
}

/** Inspection counts that describe a run which genuinely looked at something. */
const MEASURED = {
  workflows: 23,
  steps: 633,
  couplings: 25,
  inventory: 55,
} as const;

describe("resolveDeliveryChannel", () => {
  it("resolves a copy-overwrite lane to the apply channel", () => {
    expect(resolveDeliveryChannel([APPLY_LANE])).toBe("apply");
  });

  it("resolves a create-only lane to the create-only channel", () => {
    expect(resolveDeliveryChannel([CREATE_ONLY_LANE])).toBe("create-only");
  });

  it("resolves no lanes at all to the undelivered channel", () => {
    expect(resolveDeliveryChannel([])).toBe("undelivered");
  });

  it("lets a refreshing lane win over create-only when both ship the path", () => {
    expect(resolveDeliveryChannel([CREATE_ONLY_LANE, APPLY_LANE])).toBe(
      "apply"
    );
  });

  it("resolves every non-create-only strategy Lisa delivers with to apply", () => {
    expect(resolveDeliveryChannel(["rails/copy-contents"])).toBe("apply");
    expect(resolveDeliveryChannel(["all/merge"])).toBe("apply");
    expect(resolveDeliveryChannel(["typescript/tagged-merge"])).toBe("apply");
    expect(resolveDeliveryChannel(["typescript/package-lisa"])).toBe("apply");
  });
});

describe("classifyTwoChannelDelivery verdicts", () => {
  it("classifies a host-only read of an applied path as apply-lagged", () => {
    const report = classifyTwoChannelDelivery({
      couplings: [coupling()],
      inspected: MEASURED,
      ratified: {},
    });
    expect(report.entries[0]?.verdict).toBe("apply-lagged");
    expect(report.entries[0]?.remedy).toBe("run-lisa-apply");
  });

  it("classifies a host-only read of a create-only path as never-delivered", () => {
    const report = classifyTwoChannelDelivery({
      couplings: [coupling({ lanes: [CREATE_ONLY_LANE] })],
      inspected: MEASURED,
      ratified: {},
    });
    expect(report.entries[0]?.verdict).toBe("never-delivered");
    expect(report.entries[0]?.remedy).toBe("adopt-the-artifact");
  });

  it("classifies a host-only read Lisa ships nowhere as undelivered", () => {
    const report = classifyTwoChannelDelivery({
      couplings: [coupling({ lanes: [] })],
      inspected: MEASURED,
      ratified: {},
    });
    expect(report.entries[0]?.verdict).toBe("undelivered");
    expect(report.entries[0]?.remedy).toBe("author-the-artifact");
  });

  it("treats a package-backed step as covered even when the host lane is create-only", () => {
    const report = classifyTwoChannelDelivery({
      couplings: [coupling({ packageBacked: true, lanes: [CREATE_ONLY_LANE] })],
      inspected: MEASURED,
      ratified: {},
    });
    expect(report.entries[0]?.verdict).toBe("package-backed");
    expect(report.entries[0]?.channel).toBe("package");
    expect(report.findings).toHaveLength(0);
  });

  it("never asserts what a guarded step does with an absent path", () => {
    // CodySwannGT/lisa#3860. The detail used to end "an absent path SKIPS
    // rather than fails ... Nothing reads as broken", inferred from the one
    // syntactic signal the scan reads. The first two steps it was quoted for
    // both fall back, annotate and verify instead, and the claim was nearly
    // cited on a public ticket as measured evidence of a third defect.
    const report = classifyTwoChannelDelivery({
      couplings: [coupling({ lanes: [], guarded: true })],
      inspected: MEASURED,
      ratified: {},
    });
    const detail = report.entries[0]?.detail ?? "";
    expect(detail).not.toContain("SKIPS rather than fails");
    expect(detail).not.toContain("Nothing reads as broken");
    expect(detail).not.toContain("the step posts no context");
  });

  it("labels a guarded absence's consequence as unmeasured, and names what to read", () => {
    const report = classifyTwoChannelDelivery({
      couplings: [coupling({ lanes: [], guarded: true })],
      inspected: MEASURED,
      ratified: {},
    });
    const detail = report.entries[0]?.detail ?? "";
    expect(detail).toContain("NOT MEASURED");
    expect(detail).toContain("the test's other branch");
    expect(detail).toContain("any verification of the step's output");
  });

  it("labels an unguarded absence's consequence as inferred, not observed", () => {
    // The other arm of the same discipline. "Fails loudly" was equally a
    // consequence read off one signal -- a `|| true` or `continue-on-error:`
    // absorbs it, and the scan never looked.
    const report = classifyTwoChannelDelivery({
      couplings: [coupling({ lanes: [], guarded: false })],
      inspected: MEASURED,
      ratified: {},
    });
    const detail = report.entries[0]?.detail ?? "";
    expect(detail).toContain("most likely fails the job loudly");
    expect(detail).toContain("inferred from the missing guard, NOT MEASURED");
  });

  it("names the handling tokens the step's text carries, without relating them", () => {
    const report = classifyTwoChannelDelivery({
      couplings: [
        coupling({
          lanes: [],
          guarded: true,
          handling: ["else-branch", "exit-nonzero", "error-annotation"],
        }),
      ],
      inspected: MEASURED,
      ratified: {},
    });
    const detail = report.entries[0]?.detail ?? "";
    expect(detail).toContain(
      "`else-branch`, `exit-nonzero`, `error-annotation`"
    );
    expect(detail).toContain("deliberately NOT related to this read");
  });

  it("says which token names it looked for when a step carries none", () => {
    // Otherwise "carries no handling tokens" and "the scan stopped looking"
    // render identically, which is the failure this whole module is about.
    const report = classifyTwoChannelDelivery({
      couplings: [coupling({ lanes: [], guarded: true, handling: [] })],
      inspected: MEASURED,
      ratified: {},
    });
    const detail = report.entries[0]?.detail ?? "";
    for (const name of HANDLING_SIGNALS) {
      expect(detail).toContain(`\`${name}\``);
    }
  });

  it("leaves the verdict and remedy untouched by any of the above", () => {
    const guarded = classifyTwoChannelDelivery({
      couplings: [
        coupling({ lanes: [], guarded: true, handling: ["else-branch"] }),
      ],
      inspected: MEASURED,
      ratified: {},
    });
    expect(guarded.entries[0]?.verdict).toBe("undelivered");
    expect(guarded.entries[0]?.remedy).toBe("author-the-artifact");
  });
});

describe("classifyTwoChannelDelivery findings", () => {
  it("reports an unratified never-delivered coupling as a finding", () => {
    const report = classifyTwoChannelDelivery({
      couplings: [coupling({ lanes: [CREATE_ONLY_LANE] })],
      inspected: MEASURED,
      ratified: {},
    });
    expect(report.findings.map(entry => entry.key)).toEqual([PROVER_KEY]);
  });

  it("does not report an apply-lagged coupling as a finding", () => {
    // Fourteen of Lisa's own couplings are this shape and every one is
    // deliberate. Failing on them would mean ratifying fourteen entries on day
    // one, and an allowlist that size is the bypass rather than a record.
    const report = classifyTwoChannelDelivery({
      couplings: [coupling()],
      inspected: MEASURED,
      ratified: {},
    });
    expect(report.findings).toHaveLength(0);
    expect(report.counts["apply-lagged"]).toBe(1);
  });

  it("suppresses a finding that carries a ratification", () => {
    const report = classifyTwoChannelDelivery({
      couplings: [coupling({ lanes: [] })],
      inspected: MEASURED,
      ratified: { [PROVER_KEY]: "the else arm runs the packaged copy" },
    });
    expect(report.findings).toHaveLength(0);
  });

  it("reports a ratification whose coupling no longer exists as stale", () => {
    const report = classifyTwoChannelDelivery({
      couplings: [coupling({ lanes: [] })],
      inspected: MEASURED,
      ratified: {
        [PROVER_KEY]: "still live",
        [`${WORKFLOW}::scripts/deleted.mjs`]: "nothing reads this any more",
      },
    });
    expect(report.staleRatifications).toEqual([
      `${WORKFLOW}::scripts/deleted.mjs`,
    ]);
  });

  it("counts every verdict, including the ones with no entries", () => {
    const report = classifyTwoChannelDelivery({
      couplings: [coupling()],
      inspected: MEASURED,
      ratified: {},
    });
    expect(report.counts).toEqual({
      "package-backed": 0,
      "apply-lagged": 1,
      "never-delivered": 0,
      undelivered: 0,
    });
  });

  it("orders entries by key so two runs over one tree emit the same bytes", () => {
    const report = classifyTwoChannelDelivery({
      couplings: [
        coupling({ path: "scripts/zebra.mjs" }),
        coupling({ path: "scripts/alpha.mjs" }),
      ],
      inspected: MEASURED,
      ratified: {},
    });
    expect(report.entries.map(entry => entry.path)).toEqual([
      "scripts/alpha.mjs",
      "scripts/zebra.mjs",
    ]);
  });
});

describe("classifyTwoChannelDelivery refuses to pass on nothing", () => {
  it("reports a run that discovered zero reusable workflows as unmeasured", () => {
    const report = classifyTwoChannelDelivery({
      couplings: [],
      inspected: { workflows: 0, steps: 0, couplings: 0, inventory: 55 },
      ratified: {},
    });
    expect(report.measured).toBe(false);
    expect(report.unmeasuredReason).toContain("no reusable workflows");
  });

  it("reports a run whose workflows yielded zero steps as unmeasured", () => {
    const report = classifyTwoChannelDelivery({
      couplings: [],
      inspected: { workflows: 23, steps: 0, couplings: 0, inventory: 55 },
      ratified: {},
    });
    expect(report.measured).toBe(false);
    expect(report.unmeasuredReason).toContain("no steps");
  });

  it("reports an empty delivery inventory as unmeasured", () => {
    // Without this branch every path resolves to `undelivered` and the run
    // reports a fleet of findings it never actually measured — the same defect
    // in the opposite direction.
    const report = classifyTwoChannelDelivery({
      couplings: [coupling()],
      inspected: { workflows: 23, steps: 633, couplings: 1, inventory: 0 },
      ratified: {},
    });
    expect(report.measured).toBe(false);
    expect(report.unmeasuredReason).toContain("delivery inventory is empty");
  });

  it("reports a run that found zero caller-tree reads as unmeasured", () => {
    const report = classifyTwoChannelDelivery({
      couplings: [],
      inspected: { workflows: 23, steps: 633, couplings: 0, inventory: 55 },
      ratified: {},
    });
    expect(report.measured).toBe(false);
    expect(report.unmeasuredReason).toContain(
      "no step named a caller-tree path"
    );
  });

  it("reports a run that measured something as measured", () => {
    // The negative control for every case above: a real sweep over a converged
    // tree must be measured and clean, or the failure branches are just noise
    // an operator learns to ignore.
    const report = classifyTwoChannelDelivery({
      couplings: [coupling()],
      inspected: MEASURED,
      ratified: {},
    });
    expect(report.measured).toBe(true);
    expect(report.unmeasuredReason).toBeNull();
    expect(report.findings).toHaveLength(0);
    expect(report.staleRatifications).toHaveLength(0);
  });

  it("carries the inspection counts through so a report can always print them", () => {
    const report = classifyTwoChannelDelivery({
      couplings: [coupling()],
      inspected: MEASURED,
      ratified: {},
    });
    expect(report.inspected).toEqual(MEASURED);
  });
});
