/**
 * @file reusable-workflow-pin-absent-callee.test.ts
 * @description A callee this release does not carry must be left unpinned
 * (#4021).
 *
 * The defect, measured on a consumer upgrading to 4.48.0: it called five Lisa
 * reusable workflows. Four resolved at the v4.48.0 tag commit. The fifth —
 * adopted from Lisa's `main` ahead of any release carrying it — did not, and
 * did not resolve at v4.49.0 either. The migration pinned all five.
 *
 * That is worse than a wrong pin. A reusable workflow that does not resolve is
 * a LOAD error: the job fails before a single step executes, the failure does
 * not name the missing workflow, and nothing in the consumer's own diff
 * explains it. It reads as a broken deploy. The consumer had to revert that one
 * ref by hand, and nothing in the apply's output distinguished it from the four
 * rewrites that were correct.
 *
 * Leaving a mutable ref is the lesser failure by a wide margin: it keeps
 * working, and `lisa doctor` reports it.
 * @module tests/unit/core/reusable-workflow-pin-absent-callee
 */
import { describe, expect, it } from "vitest";

import {
  pinReusableWorkflowRefs,
  type ReleasePin,
} from "../../../src/core/reusable-workflow-pin.js";

const PIN: ReleasePin = {
  sha: "a".repeat(40),
  version: "4.48.0",
};

/** Two callers: one this release carries, one that exists only on `main`. */
const SOURCE = [
  "jobs:",
  "  quality:",
  "    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main",
  "  sentry:",
  "    uses: CodySwannGT/lisa/.github/workflows/sentry-deploy.yml@main",
  "",
].join("\n");

describe("pinning skips a callee the release does not carry", () => {
  it("pins a vouched callee and leaves an unvouched one exactly as written", () => {
    const vouched = new Set(["quality.yml"]);

    const result = pinReusableWorkflowRefs(SOURCE, PIN, workflow =>
      vouched.has(workflow)
    );

    expect(result).toContain(
      `CodySwannGT/lisa/.github/workflows/quality.yml@${PIN.sha} # v${PIN.version}`
    );
    // Byte-identical, not merely "still mutable": a rewrite that preserved the
    // ref but reflowed the line would still be a change this must not make.
    expect(result).toContain(
      "    uses: CodySwannGT/lisa/.github/workflows/sentry-deploy.yml@main"
    );
    expect(result).not.toContain(`sentry-deploy.yml@${PIN.sha}`);
  });

  it("pins everything when the predicate vouches for everything", () => {
    // The control. Without it, a predicate that answered `false` for every
    // input would satisfy the case above while disabling pinning entirely —
    // the failure this guard would otherwise hide.
    const result = pinReusableWorkflowRefs(SOURCE, PIN, () => true);

    expect(result).toContain(`quality.yml@${PIN.sha} # v${PIN.version}`);
    expect(result).toContain(`sentry-deploy.yml@${PIN.sha} # v${PIN.version}`);
  });

  it("defaults to pinning everything when no predicate is supplied", () => {
    // The signature gained an optional third argument; every existing caller
    // passes two. This pins that the default is unchanged behaviour.
    const result = pinReusableWorkflowRefs(SOURCE, PIN);

    expect(result).toContain(`quality.yml@${PIN.sha}`);
    expect(result).toContain(`sentry-deploy.yml@${PIN.sha}`);
  });
});
