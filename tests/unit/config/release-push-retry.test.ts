import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadWorkflow } from "../../helpers/workflow-test-utils.js";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const RELEASE_WORKFLOW = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "release.yml"
);

describe("release workflow changelog push", () => {
  it("rebases and retries the standard-version push before failing", () => {
    const workflow = loadWorkflow(RELEASE_WORKFLOW);
    const versionSteps = workflow.jobs.version.steps ?? [];
    const pushStep = versionSteps.find(
      step => step.name === "Push Changelog Changes"
    );

    expect(pushStep?.run).toContain("for attempt in 1 2 3");
    expect(pushStep?.run).toContain('git fetch origin "$target_ref"');
    expect(pushStep?.run).toContain('git rebase "origin/$target_ref"');
    expect(pushStep?.run).toContain('git push origin "HEAD:$target_ref"');
    expect(pushStep?.run).toContain(
      "Changelog push failed after bounded retries"
    );
  });
});
