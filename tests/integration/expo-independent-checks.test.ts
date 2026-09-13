/** Independent web checks still report when an unrelated quality check fails. */
import { describe, expect, it } from "vitest";

import { githubCondition } from "../helpers/github-expression.js";
import { jobOf, loadWorkflow } from "../helpers/workflow-test-utils.js";

const workflow = loadWorkflow("expo/create-only/.github/workflows/ci.yml");

describe.each(["lighthouse", "zap"])("Expo %s scheduling", name => {
  it.each([
    ["success", false, true],
    ["failure", false, true],
    ["skipped", false, true],
    ["cancelled", false, false],
    ["success", true, false],
  ])(
    "handles quality=%s and cancellation=%s",
    (result, cancelled, expected) => {
      // An omitted job condition uses GitHub's implicit success requirement.
      const condition =
        jobOf(workflow, name).if ??
        "!cancelled() && needs.quality.result == 'success'";
      expect(
        githubCondition(
          condition,
          { needs: { quality: { result } } },
          cancelled
        )
      ).toBe(expected);
    }
  );
});
