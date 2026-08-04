/**
 * "Could not ask the tracker" and "the tracker said no" are different facts.
 *
 * A cloud session finished its work and could not commit it: `gh` has no usable
 * credential there, so the work-item guardrail refused, and the enforcement
 * fallback correctly refused the bypass. Two correct behaviours composed into
 * finished, green work that could not be saved.
 *
 * The way out is not to weaken the gate. Everything checkable offline — the
 * trailer is present, well formed, and bound to this branch — still runs, and
 * the semantic checks that need the tracker are re-run in CI by the REQUIRED
 * "Work-Item Traceability" status check before anything can merge. The
 * guarantee moves to a gate that cannot be bypassed rather than disappearing.
 *
 * That reasoning holds only for unreachability. An answer of "this issue is
 * closed" or "does not exist" is evidence, and evidence is never degraded.
 * @module tests/unit/scripts/work-item-tracker-unreachable
 */
import { describe, expect, it } from "vitest";

import {
  TrackerUnreachableError,
  githubFailure,
} from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";

const REF = "CodySwannGT/lisa#2231";

/** Verbatim from the cloud container that could not commit. */
const PROXY_REFUSAL =
  "GitHub access is not enabled for this session. An org admin must connect the Claude GitHub App for this organization.";

describe("could not ask the tracker", () => {
  it("treats a missing gh as unreachable", () => {
    const error = githubFailure(
      {
        status: null,
        error: Object.assign(new Error("spawn"), { code: "ENOENT" }),
      },
      REF
    );

    expect(error).toBeInstanceOf(TrackerUnreachableError);
  });

  it("treats a refused credential as unreachable", () => {
    const error = githubFailure({ status: 1, stderr: PROXY_REFUSAL }, REF);

    expect(error).toBeInstanceOf(TrackerUnreachableError);
  });
});

describe("the tracker answered", () => {
  it("does NOT treat a missing issue as unreachable", () => {
    // The difference that keeps this from being a hole. Degrading here would
    // wave through a commit against an issue that does not exist.
    const error = githubFailure(
      { status: 1, stderr: "GraphQL: Could not resolve to an Issue" },
      REF
    );

    expect(error).not.toBeInstanceOf(TrackerUnreachableError);
    expect(error.message).toMatch(/does not exist or is inaccessible/);
  });

  it("does NOT treat an unexplained failure as unreachable", () => {
    // No evidence either way. Guessing "unreachable" would convert every
    // unrecognised gh failure into a skipped check.
    const error = githubFailure({ status: 1 }, REF);

    expect(error).not.toBeInstanceOf(TrackerUnreachableError);
  });
});
