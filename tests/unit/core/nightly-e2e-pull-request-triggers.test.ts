/**
 * A nightly-E2E bypass caller must re-evaluate when the pull-request body
 * changes, because the body is half the waiver's evidence (#3476, #3485).
 *
 * The guard already reads the label AND the body live from the API at gate
 * time, so it would reject a body that no longer carries the
 * `Nightly-E2E-Bypass:` line. It never gets the chance: the caller subscribes
 * to `labeled`/`unlabeled` but not `edited`, a body rewrite raises `edited` and
 * nothing else, and the previous SUCCESS check-run stands unexamined. The
 * reading is current; the reading never happens.
 *
 * These tests pin the two halves that make a repair safe to ship into consumer
 * repositories: the assessment must fail toward "not armed" so an unreadable
 * caller is reported rather than assumed fine, and the rewrite must decline any
 * shape it cannot verify rather than guess. A workflow this corrupts would take
 * a consumer's gate from half-armed to not running at all — strictly worse than
 * the defect being fixed.
 * @module tests/unit/core/nightly-e2e-pull-request-triggers
 */
import { describe, expect, it } from "vitest";

import {
  assessBodyChangeTrigger,
  BODY_CHANGE_ACTIVITY_TYPE,
  ensureBodyChangeTrigger,
} from "../../../src/core/nightly-e2e-pull-request-triggers.js";

/** A caller declaring a `pull_request` trigger but no `types:` at all. */
const NO_TYPES_DECLARED =
  "on:\n  pull_request:\n    branches: [dev]\njobs: {}\n";

/** The trigger block as `expo/create-only` seeded it before the fix. */
const SEEDED = `name: Nightly E2E Health

on:
  pull_request:
    branches: [dev]
    # \`labeled\` / \`unlabeled\` ride on top of the defaults so applying (or
    # removing) the bypass label re-evaluates the gate immediately.
    types: [opened, synchronize, reopened, labeled, unlabeled]
  workflow_dispatch:

jobs:
  gate:
    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@v4.4.21
`;

describe("nightly-E2E body-change trigger", () => {
  describe("assessment", () => {
    it("reports the seeded caller as not armed, naming the gap", () => {
      const assessment = assessBodyChangeTrigger(SEEDED);

      expect(assessment.armed).toBe(false);
      expect(assessment.gap).toBe("types-omit-edited");
    });

    it("reports a caller carrying edited as armed", () => {
      expect(
        assessBodyChangeTrigger(
          SEEDED.replace("unlabeled]", "unlabeled, edited]")
        ).armed
      ).toBe(true);
    });

    it("treats an omitted types list as vulnerable, not as neutral", () => {
      // The implicit default is [opened, synchronize, reopened] — it does not
      // include `edited`, so a caller declaring no types is exposed in exactly
      // the same way as one that lists types and leaves `edited` out.
      const assessment = assessBodyChangeTrigger(NO_TYPES_DECLARED);

      expect(assessment.armed).toBe(false);
      expect(assessment.gap).toBe("types-absent");
      expect(assessment.effectiveTypes).toEqual([
        "opened",
        "synchronize",
        "reopened",
      ]);
    });

    it("reads the boolean-true spelling of the on: key", () => {
      // YAML 1.1 resolves a bare `on` key to the boolean true, so a parser can
      // hand back { true: ... } for a workflow every runner accepts. Reading
      // only the string key would report "no pull_request trigger" for
      // ordinary workflows and make every finding meaningless.
      expect(assessBodyChangeTrigger(SEEDED).gap).toBe("types-omit-edited");
    });

    it("fails toward not-armed on a document it cannot read", () => {
      for (const source of ["", "just a string", "[1, 2, 3]", ": : :"]) {
        expect(assessBodyChangeTrigger(source).armed).toBe(false);
      }
    });

    it("fails toward not-armed when types is an unreadable shape", () => {
      expect(
        assessBodyChangeTrigger(
          "on:\n  pull_request:\n    types: {a: 1}\njobs: {}\n"
        ).armed
      ).toBe(false);
    });
  });

  describe("repair", () => {
    it("arms the seeded caller", () => {
      const after = ensureBodyChangeTrigger(SEEDED);

      expect(assessBodyChangeTrigger(after).armed).toBe(true);
      expect(after).toContain(
        "types: [opened, synchronize, reopened, labeled, unlabeled, edited]"
      );
    });

    it("preserves the explanatory comments around the trigger list", () => {
      // These files are consumer-owned and their comments say WHY each trigger
      // is present. A parse-and-re-emit repair would delete all of them.
      const after = ensureBodyChangeTrigger(SEEDED);

      expect(after).toContain("ride on top of the defaults");
      expect(after).toContain("workflow_dispatch:");
      expect(after).toContain("branches: [dev]");
    });

    it("is idempotent", () => {
      const once = ensureBodyChangeTrigger(SEEDED);

      expect(ensureBodyChangeTrigger(once)).toBe(once);
    });

    it("preserves types a consumer added themselves", () => {
      const after = ensureBodyChangeTrigger(
        SEEDED.replace("unlabeled]", "unlabeled, ready_for_review]")
      );

      expect(after).toContain("ready_for_review");
      expect(assessBodyChangeTrigger(after).armed).toBe(true);
    });

    it("arms a block-sequence types list in its own style", () => {
      const block = [
        "on:",
        "  pull_request:",
        "    types:",
        "      - opened",
        "      - synchronize",
        "jobs: {}",
        "",
      ].join("\n");

      const after = ensureBodyChangeTrigger(block);

      expect(after).toContain("      - edited");
      expect(after).not.toContain("[");
      expect(assessBodyChangeTrigger(after).armed).toBe(true);
    });

    it("writes the defaults plus edited when types is absent", () => {
      const after = ensureBodyChangeTrigger(NO_TYPES_DECLARED);

      // Behaviour-preserving: it states what GitHub was already doing and adds
      // the one that was missing.
      expect(after).toContain("types: [opened, synchronize, reopened, edited]");
      expect(assessBodyChangeTrigger(after).armed).toBe(true);
    });

    it("leaves a workflow with no pull_request trigger untouched", () => {
      const unrelated = "on:\n  push:\n    branches: [main]\njobs: {}\n";

      expect(ensureBodyChangeTrigger(unrelated)).toBe(unrelated);
    });

    it("declines a bare pull_request with no body rather than inventing one", () => {
      const bare = "on:\n  pull_request:\njobs: {}\n";

      expect(ensureBodyChangeTrigger(bare)).toBe(bare);
    });

    it("returns the original source when it cannot verify its own edit", () => {
      for (const source of ["", "just a string", ": : :"]) {
        expect(ensureBodyChangeTrigger(source)).toBe(source);
      }
    });

    it("never emits a workflow it would itself call unarmed", () => {
      // The invariant that makes this safe to run unattended in consumer
      // repos: every output is either the untouched input, or armed.
      const sources = [
        SEEDED,
        NO_TYPES_DECLARED,
        "on:\n  push:\n    branches: [main]\njobs: {}\n",
        "on:\n  pull_request:\njobs: {}\n",
        "on:\n  pull_request:\n    types: {a: 1}\njobs: {}\n",
      ];

      for (const source of sources) {
        const after = ensureBodyChangeTrigger(source);
        expect(after === source || assessBodyChangeTrigger(after).armed).toBe(
          true
        );
      }
    });
  });

  it("names the activity type a body rewrite actually raises", () => {
    expect(BODY_CHANGE_ACTIVITY_TYPE).toBe("edited");
  });
});
