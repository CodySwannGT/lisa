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
  const pushStepRun = (): string => {
    const workflow = loadWorkflow(RELEASE_WORKFLOW);
    const versionSteps = workflow.jobs.version.steps ?? [];
    const pushStep = versionSteps.find(
      step => step.name === "Push Changelog Changes"
    );
    return pushStep?.run ?? "";
  };

  it("keeps the bounded retry cap and its loud terminal failure", () => {
    const run = pushStepRun();

    expect(run).toContain("for attempt in 1 2 3");
    expect(run).toContain('git fetch origin "$target_ref"');
    expect(run).toContain('git push origin "HEAD:$target_ref"');
    expect(run).toContain("Changelog push failed after bounded retries");
    // Cap exhaustion must still fail the step so the deploy-autofix
    // escalation path fires.
    expect(run).toContain("exit 1");
  });

  it("guards the rebase so `set -e` cannot bypass the retry loop", () => {
    const run = pushStepRun();

    // GitHub runs the block under `set -eo pipefail`. A bare
    // `git rebase "origin/$target_ref"` would exit the step on the first
    // content conflict, making the loop dead code. The rebase must run inside
    // a condition (`if ! git rebase ...`) so the non-zero exit is caught.
    expect(run).toMatch(/if\s+!\s+git rebase "origin\/\$target_ref"/);
  });

  it("re-stamps against the fresh tip on conflict instead of replaying", () => {
    const run = pushStepRun();

    // Replaying the pre-stamped commit re-conflicts identically on the same
    // plugin version lines every attempt. Recovery must reset to the fresh
    // origin tip and regenerate the stamp from the pinned version so each
    // retry converges.
    expect(run).toContain('git reset --hard "origin/$target_ref"');
    expect(run).toContain(
      'npx standard-version --release-as "$version" --skip.tag'
    );
    expect(run).toContain("git rebase --abort");
  });
});
