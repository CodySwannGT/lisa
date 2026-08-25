/**
 * Regression tests for CodySwannGT/lisa#3050 — the reading half.
 *
 * The whole measurement rests on telling three things apart in a workflow's
 * text: a CALLER-tree path (`scripts/x.mjs`, delivered by `lisa apply`), a
 * PACKAGE path (`node_modules/@codyswann/lisa/.../scripts/x.mjs`, delivered by
 * a dependency bump, and #2960's subject rather than this one's), and prose in
 * a comment. Confusing the first two either drowns fifteen real couplings in a
 * hundred false ones or reports a covered step as a gap.
 */
import { describe, expect, it } from "vitest";
import {
  extractSteps,
  isReusable,
  scanWorkflow,
} from "../../../src/core/two-channel-delivery-scan.js";

/**
 * No lane ships anything, so every scan result is host-only.
 * @returns No lanes
 */
const NO_LANES = (): readonly string[] => [];

/** The lane every fixture's prover is delivered by. */
const LANE = "all/copy-overwrite";

/**
 * Everything is shipped by copy-overwrite.
 * @returns One refreshing lane
 */
const APPLY_LANE = (): readonly string[] => [LANE];

/** The workflow every fixture belongs to. */
const WORKFLOW = "quality.yml";

/** The caller-tree path most fixtures read. */
const PROVER = "scripts/prover.mjs";

/** The step header most fixtures use. */
const STEP = "      - name: 🧪 Prove it\n";

/** Running the prover from the caller's own tree. */
const RUN_PROVER = `        run: node ${PROVER}\n`;

/** A package-relative candidate for the same artifact. */
const PACKAGE_PROVER = `node_modules/@codyswann/lisa/${LANE}/${PROVER}`;

describe("isReusable", () => {
  it("recognises a workflow another repository can call", () => {
    expect(isReusable("on:\n  workflow_call:\n    inputs: {}\n")).toBe(true);
  });

  it("rejects a workflow that reaches no consumer", () => {
    expect(isReusable("on:\n  push:\n    branches: [main]\n")).toBe(false);
  });
});

describe("extractSteps", () => {
  it("keeps the preamble, where a workflow_call input default can live", () => {
    // `nightly-e2e-health.yml` declares a default of
    // `scripts/check-nightly-e2e-health.mjs` in its inputs, which is a
    // caller-tree read that appears in no step at all.
    const steps = extractSteps(
      [
        "on:",
        "  workflow_call:",
        "    inputs:",
        "      health_script:",
        "        default: 'scripts/check-nightly-e2e-health.mjs'",
        "jobs:",
        "  a:",
        "    steps:",
        "      - name: 🧪 Run it",
        "        run: node scripts/other.mjs",
      ].join("\n")
    );
    expect(steps[0]?.body).toContain("scripts/check-nightly-e2e-health.mjs");
    expect(steps.at(-1)?.name).toBe("🧪 Run it");
  });

  it("starts a new step at an unnamed `- run:` item", () => {
    const steps = extractSteps(
      [
        "      - run: node scripts/a.mjs",
        "      - run: node scripts/b.mjs",
      ].join("\n")
    );
    expect(steps).toHaveLength(3);
    expect(steps[1]?.body).toContain("scripts/a.mjs");
    expect(steps[2]?.body).toContain("scripts/b.mjs");
  });

  it("drops full-line comments so prose is never read as a claim", () => {
    const steps = extractSteps(
      [
        "      # `scripts/mentioned-in-prose.mjs` is discussed here, not run",
        "      - name: 🧪 Run it",
        "        run: node scripts/actually-run.mjs",
      ].join("\n")
    );
    expect(steps.map(step => step.body).join("\n")).not.toContain(
      "scripts/mentioned-in-prose.mjs"
    );
  });
});

describe("scanWorkflow", () => {
  it("reads a caller-tree path out of a run step", () => {
    const couplings = scanWorkflow({
      workflow: WORKFLOW,
      text: STEP + RUN_PROVER,
      lanesFor: APPLY_LANE,
    });
    expect(couplings).toHaveLength(1);
    expect(couplings[0]?.path).toBe(PROVER);
    expect(couplings[0]?.lanes).toEqual([LANE]);
  });

  it("never reads a package path as a caller-tree path", () => {
    // The tail of a package path spells a caller directory. Without the
    // lookbehind every resolver loop in `quality.yml` would report a coupling
    // that #2960 already owns.
    const couplings = scanWorkflow({
      workflow: WORKFLOW,
      text: `${STEP}        run: node ${PACKAGE_PROVER}\n`,
      lanesFor: APPLY_LANE,
    });
    expect(couplings).toHaveLength(0);
  });

  it("marks a step package-backed when it names a package candidate too", () => {
    const couplings = scanWorkflow({
      workflow: WORKFLOW,
      text: `${STEP}        run: |\n          for c in "${PACKAGE_PROVER}" "${PROVER}"; do :; done\n`,
      lanesFor: APPLY_LANE,
    });
    expect(couplings[0]?.packageBacked).toBe(true);
  });

  it("does not let an unrelated package file vouch for a caller path", () => {
    // Matching on the bare file name would accept this. The comparison is on
    // the whole tail, so a package file that merely shares a basename with a
    // caller script cannot cover it.
    const couplings = scanWorkflow({
      workflow: WORKFLOW,
      text: `${STEP}        run: |\n          echo "node_modules/@codyswann/lisa/dist/core/prover.mjs"\n          node scripts/tools/prover.mjs\n`,
      lanesFor: APPLY_LANE,
    });
    expect(couplings[0]?.packageBacked).toBe(false);
  });

  it("detects a shell existence guard, which makes the absence silent", () => {
    const couplings = scanWorkflow({
      workflow: WORKFLOW,
      text: `${STEP}        run: |\n          if [ -f ${PROVER} ]; then node ${PROVER}; fi\n`,
      lanesFor: APPLY_LANE,
    });
    expect(couplings[0]?.guarded).toBe(true);
  });

  it("detects a hashFiles guard", () => {
    const couplings = scanWorkflow({
      workflow: WORKFLOW,
      text: `${STEP}        if: hashFiles('${PROVER}') != ''\n${RUN_PROVER}`,
      lanesFor: APPLY_LANE,
    });
    expect(couplings[0]?.guarded).toBe(true);
  });

  it("reports an unguarded read as unguarded", () => {
    const couplings = scanWorkflow({
      workflow: WORKFLOW,
      text: STEP + RUN_PROVER,
      lanesFor: APPLY_LANE,
    });
    expect(couplings[0]?.guarded).toBe(false);
  });

  it("collapses one path read from several steps into one coupling", () => {
    const couplings = scanWorkflow({
      workflow: WORKFLOW,
      text: `      - name: 🔍 Look\n        run: test -f ${PROVER}\n${STEP}${RUN_PROVER}`,
      lanesFor: APPLY_LANE,
    });
    expect(couplings).toHaveLength(1);
  });

  it("keeps a coupling host-only when any one of its steps is host-only", () => {
    // The conservative direction. That host-only step is the one that will
    // fail, so a package candidate somewhere else in the file must not vouch
    // for it.
    const couplings = scanWorkflow({
      workflow: WORKFLOW,
      text: `      - name: 🔍 Resolve\n        run: node "${PACKAGE_PROVER}"\n${STEP}${RUN_PROVER}`,
      lanesFor: APPLY_LANE,
    });
    expect(couplings).toHaveLength(1);
    expect(couplings[0]?.packageBacked).toBe(false);
  });

  it("marks a coupling guarded when any one of its steps guards it", () => {
    const couplings = scanWorkflow({
      workflow: WORKFLOW,
      text: `      - name: 🔍 Look\n        run: |\n          if [ -f ${PROVER} ]; then echo yes; fi\n${STEP}${RUN_PROVER}`,
      lanesFor: APPLY_LANE,
    });
    expect(couplings[0]?.guarded).toBe(true);
  });

  it("reports no lanes for a path Lisa ships nowhere", () => {
    const couplings = scanWorkflow({
      workflow: WORKFLOW,
      text: `${STEP}        run: bun scripts/unshipped.ts\n`,
      lanesFor: NO_LANES,
    });
    expect(couplings[0]?.lanes).toEqual([]);
  });

  it("orders couplings by path so two scans emit the same bytes", () => {
    const couplings = scanWorkflow({
      workflow: WORKFLOW,
      text:
        "      - name: b\n        run: node scripts/zebra.mjs\n" +
        "      - name: a\n        run: node scripts/alpha.mjs\n",
      lanesFor: APPLY_LANE,
    });
    expect(couplings.map(entry => entry.path)).toEqual([
      "scripts/alpha.mjs",
      "scripts/zebra.mjs",
    ]);
  });
});
