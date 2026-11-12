/**
 * The reading that says whether a manual run of the evidence workflow can name
 * the reviewer whose check run it brings up to date (CodySwannGT/lisa#4738).
 *
 * The verdict is published as `🕵️ Third-party review evidence (<context>)`,
 * named after the reviewer that woke the run. Once one is red, a manual run
 * that takes only a `sha` publishes under the bare name and cannot overwrite
 * it. A copy is current only when `workflow_dispatch` takes a `context` input
 * AND the job's reviewer value reads it; these shapes pin both halves, in both
 * directions.
 * @module tests/unit/core/third-party-evidence-seed-dispatch-context
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  isCurrentEvidenceSeed,
  readEvidenceSeed,
} from "../../../src/core/third-party-evidence-seed.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");

/** The seed Lisa ships now. */
const CURRENT_SEED = fs.readFileSync(
  path.join(
    ROOT,
    "typescript/create-only/.github/workflows/third-party-review-evidence.yml"
  ),
  "utf8"
);

/** The seed exactly as Lisa shipped it before #4553. */
const PRE_FIX_SEED = fs.readFileSync(
  path.join(
    ROOT,
    "tests/fixtures/third-party-review-evidence-seed/pre-4553.yml"
  ),
  "utf8"
);

/** A manual trigger that takes a commit and, optionally, a reviewer. */
const DISPATCH_WITH_CONTEXT = `on:
  workflow_dispatch:
    inputs:
      sha:
        required: true
        type: string
      context:
        required: false
        type: string`;

/** A manual trigger that takes only a commit. */
const DISPATCH_SHA_ONLY = `on:
  workflow_dispatch:
    inputs:
      sha:
        required: true
        type: string`;

/**
 * A workflow whose prover job reads its reviewer from an expression.
 * @param on - The `on:` block
 * @param context - The job's `EVIDENCE_CONTEXT` expression
 * @returns Workflow source
 */
function workflow(on: string, context: string): string {
  return `name: evidence
${on}
jobs:
  evidence:
    env:
      EVIDENCE_CONTEXT: \${{ ${context} }}
    steps:
      - run: node scripts/check-third-party-review-evidence.mjs --context="$EVIDENCE_CONTEXT"
`;
}

/** The reviewer value every current copy carries. */
const READS_INPUT =
  "github.event.check_run.name || github.event.context || inputs.context";

/** The reviewer value every copy seeded before #4738 carries. */
const IGNORES_INPUT = "github.event.check_run.name || github.event.context";

describe("readEvidenceSeed — a manual run's reviewer", () => {
  it.each([
    [
      "a context input the reviewer value reads",
      DISPATCH_WITH_CONTEXT,
      READS_INPUT,
      true,
    ],
    [
      "a context input nothing reads",
      DISPATCH_WITH_CONTEXT,
      IGNORES_INPUT,
      false,
    ],
    ["no context input at all", DISPATCH_SHA_ONLY, IGNORES_INPUT, false],
    [
      "a reviewer value reading an input never declared",
      DISPATCH_SHA_ONLY,
      READS_INPUT,
      false,
    ],
    ["no manual trigger at all", "on:\n  status:", READS_INPUT, false],
  ])("judges a copy with %s", (_name, on, context, expected) => {
    expect(readEvidenceSeed(workflow(on, context)).acceptsDispatchContext).toBe(
      expected
    );
  });

  it("reads the seed Lisa ships as taking a manual run's reviewer", () => {
    const reading = readEvidenceSeed(CURRENT_SEED);

    expect(reading.acceptsDispatchContext).toBe(true);
    expect(isCurrentEvidenceSeed(reading)).toBe(true);
  });

  it("finds the gap in the seed Lisa shipped before the fix", () => {
    expect(readEvidenceSeed(PRE_FIX_SEED).acceptsDispatchContext).toBe(false);
  });

  it("holds a copy current in every other way, but without the input, to be stale", () => {
    const reading = readEvidenceSeed(
      CURRENT_SEED.replaceAll(" || inputs.context", "")
    );

    expect(reading.acceptsDispatchContext).toBe(false);
    expect(reading.publishesVerdict).toBe(true);
    expect(reading.readsRunIdentity).toBe(true);
    expect(isCurrentEvidenceSeed(reading)).toBe(false);
  });
});
