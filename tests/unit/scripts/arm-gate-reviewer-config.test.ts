/**
 * The arm gate engages on every stack that declares a reviewer gate
 * (CodySwannGT/lisa#4653).
 *
 * The defect: `lisa-drive-pr-to-merge` keyed its arm gate to
 * `.github/required-checks.json`, which Lisa seeds only on TypeScript-family
 * hosts. A Rails host that declares `evidence.reviewer: true` in
 * `.lisa.config.json` therefore passed the gate immediately, and an armed
 * latch merged on a rate-limited reviewer's `neutral` check run.
 *
 * These cases drive the arm decision for a Rails-shaped host — a reviewer gate
 * in config, and NO vacuity report because no `required-checks.json` and no
 * `check-skipped-required-checks.mjs` exist there — through the all-stack
 * prover with stubbed GitHub reads.
 * @module tests/unit/scripts/arm-gate-reviewer-config
 */
import { describe, expect, it } from "vitest";

import {
  ARM_ACTIONS,
  armDecision,
  COMPLETED_REVIEW_RESULT,
  EVIDENCE_OUTCOMES,
  main,
  substituteMarker,
} from "../../../all/copy-overwrite/scripts/check-third-party-review-evidence.mjs";

const REPO_ARG = "--repo=acme/rails-host";
const CONTEXT = "CodeRabbit";
const APP = 347564;
const HEAD = "e".repeat(40);

/** The reviewer gate exactly as the issue's Rails host declares it. */
const RAILS_GATES = {
  "code-review": {
    "pull-request": {
      level: "required",
      await: CONTEXT,
      posted_by: APP,
      evidence: { reviewer: true, proof: ["Review completed"] },
    },
  },
};

/**
 * A reviewer check run at the head.
 * @param overrides - Fields to replace
 * @returns The run
 */
const run = (overrides: Record<string, unknown> = {}) => ({
  id: 11,
  name: CONTEXT,
  head_sha: HEAD,
  status: "completed",
  conclusion: "success",
  app: { id: APP, slug: "coderabbitai" },
  output: {
    title: "Finished",
    summary: `${COMPLETED_REVIEW_RESULT}\nRun ID: x`,
  },
  ...overrides,
});

/** A rate-limited review: GitHub counts `neutral` as passing a required check. */
const RATE_LIMITED_RUN = run({
  conclusion: "neutral",
  output: { title: "Review rate limited", summary: "Review rate limited" },
});

/** The parsed `--arm --json` report and exit code. */
interface ArmRun {
  readonly code: number;
  readonly report: {
    readonly arm: boolean;
    readonly action: string;
    readonly reason: string;
    readonly evidence: { readonly outcome: string };
  };
}

/**
 * Run the arm decision on a Rails-shaped host with stubbed reads.
 * @param runs - Check runs the reviewer posted at the head
 * @param comments - Pull request comments
 * @returns The exit code and parsed report
 */
const decideOnRailsHost = (
  runs: readonly object[],
  comments: readonly { body: string }[] = []
): ArmRun => {
  const chunks: string[] = [];
  const code = main([`--sha=${HEAD}`, REPO_ARG, "--arm", "--json"], {
    gates: RAILS_GATES,
    pulls: () => [7],
    statuses: () => [],
    checkRuns: () => runs,
    comments: () => comments,
    out: {
      write: (text: string) => {
        chunks.push(text);
      },
    },
  });
  return { code, report: JSON.parse(chunks.join("")) };
};

describe("the arm gate on a Rails host with a reviewer gate (#4653)", () => {
  it("does not arm on a rate-limited review, and asks for the substitute first", () => {
    const { code, report } = decideOnRailsHost([RATE_LIMITED_RUN]);

    expect(report.evidence.outcome).toBe(EVIDENCE_OUTCOMES.unsatisfied);
    expect(report.arm).toBe(false);
    expect(report.action).toBe(ARM_ACTIONS.substitute);
    expect(code).toBe(1);
  });

  it("does not arm when the reviewer has posted nothing at all", () => {
    const { report } = decideOnRailsHost([]);

    expect(report.arm).toBe(false);
    expect(report.action).toBe(ARM_ACTIONS.substitute);
  });

  it("arms a head the pinned app reviewed", () => {
    const { code, report } = decideOnRailsHost([run()]);

    expect(report.evidence.outcome).toBe(EVIDENCE_OUTCOMES.satisfied);
    expect(report.arm).toBe(true);
    expect(report.action).toBe(ARM_ACTIONS.arm);
    expect(code).toBe(0);
  });

  it("arms a rate-limited head once the substitute for that head is posted", () => {
    const { code, report } = decideOnRailsHost(
      [RATE_LIMITED_RUN],
      [{ body: `${substituteMarker({ context: CONTEXT, sha: HEAD })}\nread` }]
    );

    expect(report.evidence.outcome).toBe(EVIDENCE_OUTCOMES.substituted);
    expect(report.arm).toBe(true);
    expect(code).toBe(0);
  });

  it("does not let a substitute for another head arm this one", () => {
    const { report } = decideOnRailsHost(
      [RATE_LIMITED_RUN],
      [
        {
          body: substituteMarker({ context: CONTEXT, sha: "f".repeat(40) }),
        },
      ]
    );

    expect(report.arm).toBe(false);
  });

  it("does not arm while the reviewer is still running", () => {
    const { report } = decideOnRailsHost([
      run({ status: "in_progress", conclusion: null }),
    ]);

    expect(report.evidence.outcome).toBe(EVIDENCE_OUTCOMES.pending);
    expect(report.arm).toBe(false);
    expect(report.action).toBe(ARM_ACTIONS.watch);
  });

  it("stops rather than arms when the pull requests cannot be read", () => {
    const chunks: string[] = [];
    main([`--sha=${HEAD}`, REPO_ARG, "--arm", "--json"], {
      gates: RAILS_GATES,
      pulls: () => null,
      out: {
        write: (text: string) => {
          chunks.push(text);
        },
      },
    });
    const report = JSON.parse(chunks.join(""));

    expect(report.arm).toBe(false);
    expect(report.action).toBe(ARM_ACTIONS.stop);
  });

  it("arms a host that declares no reviewer anywhere — out of scope", () => {
    const chunks: string[] = [];
    const code = main([`--sha=${HEAD}`, "--arm", "--json"], {
      gates: {},
      out: {
        write: (text: string) => {
          chunks.push(text);
        },
      },
    });
    const report = JSON.parse(chunks.join(""));

    expect(report.evidence.outcome).toBe(
      EVIDENCE_OUTCOMES.noReviewerConfigured
    );
    expect(report.arm).toBe(true);
    expect(code).toBe(0);
  });
});

describe("--vacuity-report on a host that ships the classifier", () => {
  /**
   * Run the arm decision with a saved classifier report.
   * @param read - The injected file reader
   * @returns The parsed report
   */
  const decideWithReport = (read: (path: string) => string) => {
    const chunks: string[] = [];
    main(
      [
        `--sha=${HEAD}`,
        REPO_ARG,
        "--arm",
        "--json",
        "--vacuity-report=vacuity.json",
      ],
      {
        gates: RAILS_GATES,
        pulls: () => [7],
        statuses: () => [],
        checkRuns: () => [run()],
        comments: () => [],
        readFile: read,
        out: {
          write: (text: string) => {
            chunks.push(text);
          },
        },
      }
    );
    return JSON.parse(chunks.join(""));
  };

  it("holds a reviewed head the classifier still finds vacuous", () => {
    const report = decideWithReport(() =>
      JSON.stringify({
        inspected: true,
        violations: [{ kind: "unproven_required_check" }],
      })
    );

    expect(report.arm).toBe(false);
    expect(report.engaged).toEqual({ reviewer: true, vacuity: true });
  });

  it("does not arm when the named report cannot be read", () => {
    const report = decideWithReport(() => {
      throw new Error("ENOENT");
    });

    expect(report.arm).toBe(false);
    expect(report.reason).toContain("vacuity_report_unreadable");
  });
});

describe("armDecision keeps the vacuity classifier where it exists", () => {
  const satisfied = { outcome: EVIDENCE_OUTCOMES.satisfied };
  const substituted = { outcome: EVIDENCE_OUTCOMES.substituted };
  const unconfigured = { outcome: EVIDENCE_OUTCOMES.noReviewerConfigured };
  const inspectedClean = { inspected: true, violations: [] };
  const vacuous = {
    inspected: true,
    violations: [{ kind: "vacuous_required_check" }],
  };

  it("arms when both signals prove work", () => {
    expect(
      armDecision({ evidence: satisfied, vacuity: inspectedClean }).arm
    ).toBe(true);
  });

  it("does not arm when the classifier finds the context vacuous, even with a substitute", () => {
    const decision = armDecision({ evidence: substituted, vacuity: vacuous });

    expect(decision.arm).toBe(false);
    expect(decision.action).toBe(ARM_ACTIONS.watch);
  });

  it("asks for a substitute when only the classifier engages and finds it vacuous", () => {
    const decision = armDecision({ evidence: unconfigured, vacuity: vacuous });

    expect(decision.arm).toBe(false);
    expect(decision.action).toBe(ARM_ACTIONS.substitute);
  });

  it("treats a review that ran and objected as a blocker", () => {
    const decision = armDecision({
      evidence: satisfied,
      vacuity: {
        inspected: true,
        violations: [{ kind: "review_evidence_unsatisfied" }],
      },
    });

    expect(decision.arm).toBe(false);
    expect(decision.action).toBe(ARM_ACTIONS.blocker);
  });

  it("arms when the classifier says nothing is declared and the prover agrees", () => {
    const decision = armDecision({
      evidence: unconfigured,
      vacuity: {
        inspected: false,
        vacuity: { refusal: { kind: "vacuity_none_declared" } },
      },
    });

    expect(decision.arm).toBe(true);
  });

  it("still engages on the config reviewer when the classifier declares none", () => {
    const decision = armDecision({
      evidence: { outcome: EVIDENCE_OUTCOMES.unsatisfied },
      vacuity: {
        inspected: false,
        vacuity: { refusal: { kind: "vacuity_none_declared" } },
      },
    });

    expect(decision.arm).toBe(false);
    expect(decision.action).toBe(ARM_ACTIONS.substitute);
  });

  it("does not arm on an inspection that read nothing", () => {
    const decision = armDecision({
      evidence: satisfied,
      vacuity: {
        inspected: false,
        vacuity: { refusal: { kind: "vacuity_checks_unreadable" } },
      },
    });

    expect(decision.arm).toBe(false);
  });
});
