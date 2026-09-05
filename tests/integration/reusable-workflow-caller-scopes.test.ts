/**
 * A reusable workflow may not GAIN a declared permission scope.
 *
 * A called workflow may only DOWNGRADE its caller's grant. Declaring a scope the
 * caller never held is a `startup_failure` for the caller's ENTIRE run — decided
 * before any job executes, so no `if:`, no unset input and no dormant job can
 * contain it. The operator sees a run that never started, naming the permission
 * but neither the repo nor the workflow that caused it.
 *
 * Lisa has shipped this twice: #2046 (quality.yml) and #2566
 * (maestro-native-e2e.yml's leg_order job, which reached 3.13.2).
 *
 * ## Why the obvious guards do not work, both of which were built and discarded
 *
 * "A reusable workflow must never declare a scope" is FALSE. 24 of these 32
 * declare scopes and are entirely correct to — their callers grant them.
 * Declaring is safe; declaring more than the caller grants is the defect.
 *
 * "Every shipped caller template must grant what its callee declares" is
 * VACUOUS. It was written first and it passed against the #2563 tree that caused
 * the outage, because an author adding a scope updates the template in the same
 * commit — as #2563 did. The template is never the victim. The victim is the
 * caller ALREADY INSTALLED in a consumer repo, which is create-only, frozen at
 * whatever Lisa seeded, and can never self-heal. That file is not in this repo,
 * so no static pair check can see it.
 *
 * ## What is checkable
 *
 * The scopes each reusable workflow declares, frozen. An installed caller is a
 * snapshot of the past, so the property that keeps it working is that the callee
 * does not move. This baseline is that "does not move", and editing it is the
 * moment a human is forced to decide what happens to already-installed callers.
 *
 * Consumers track `@main` by owner decision — they receive a change on their
 * next run, not on a bump they chose — so there is no version boundary to hide
 * behind and no "they'll pick it up when they upgrade".
 *
 * ## When this test fails
 *
 * It has told you that a change breaks every installed caller that does not
 * already grant the new scope. Pick one:
 *
 *   1. DON'T DECLARE IT. Take the credential as a `secrets:` input instead —
 *      a forwarded secret carries the CALLER's token and its scopes, so nothing
 *      is escalated and no caller can startup-fail. Have the step detect the
 *      missing scope and degrade with a loud warning. This is what #2567 did,
 *      and it is the default answer.
 *   2. Make the job work without the scope at all.
 *   3. If it genuinely must be declared: ship the caller migration FIRST, let it
 *      reach every consumer, and only then update this baseline — and say so in
 *      the PR. Under `@main` "first" means a separate, earlier release.
 *
 * Updating the baseline to make the test pass, without doing one of those, ships
 * the outage.
 */

import * as fs from "fs-extra";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  declaredScopes,
  liveDeclaredScopes,
  missingScopes,
  type ScopeMap,
} from "./support/reusable-workflow-scopes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS = path.join(REPO_ROOT, ".github", "workflows");

/**
 * Every scope each reusable workflow declares, at workflow OR job level.
 *
 * Frozen deliberately. See this file's header before changing any line: an
 * entry gaining a scope is a breaking change for every already-installed
 * caller, and the fix is almost never to edit this map.
 */
const BASELINE: Readonly<Record<string, ScopeMap>> = {
  "build.yml": { contents: "read" },
  "create-github-issue-on-failure.yml": { contents: "read", issues: "write" },
  "create-issue-on-failure.yml": { contents: "read", issues: "write" },
  "create-jira-issue-on-failure.yml": {},
  "create-linear-issue-on-failure.yml": {},
  "create-sentry-issue-on-failure.yml": {},
  // A NEW workflow, added rather than widened. The hazard this baseline guards
  // is an ALREADY-INSTALLED caller that does not grant a newly declared scope;
  // this file has no callers yet, so there is no installed snapshot to break.
  // `contents: read` matches build.yml and quality.yml — the same floor every
  // workflow that checks the repository out already declares. From here it is
  // frozen on the same terms as every other line.
  "environment-prepare.yml": { contents: "read" },
  // A NEW entry, which is a different act from a new scope on an existing one
  // and the reason this map distinguishes them. The hazard this baseline exists
  // to stop is an ALREADY-INSTALLED caller — frozen, create-only, unable to
  // self-heal — meeting a callee that now demands more than it grants. A
  // workflow that did not exist until this commit has no installed callers at
  // all: every caller of it is being written here, in the same change. And
  // `contents: read` is the floor any caller already holds, since a caller
  // that cannot read contents cannot check itself out.
  "gates.yml": { contents: "read" },
  "lighthouse.yml": {},
  "load-test.yml": {},
  // `contents: read` only. The leg-ordering job reads the jobs API through the
  // forwarded LEG_ORDER_TOKEN secret precisely so this line does not have to
  // gain `actions: read` — see #2566.
  // Gained `actions: read` deliberately, under rule 3 of this file's header:
  // the caller migration shipped FIRST and was confirmed on every consumer's
  // default branch before this line changed. The job that needs it polls this
  // run's own job list to order the platform legs; forwarding a token instead
  // (rule 1, the default answer) was implemented as LEG_ORDER_TOKEN and
  // MEASURED to fail with HTTP 403, so rule 1 is exhausted rather than untried.
  "maestro-native-e2e.yml": { contents: "read", actions: "read" },
  "nightly-e2e-health.yml": {
    actions: "read",
    contents: "read",
    "pull-requests": "read",
  },
  "nightly-e2e-report.yml": {
    actions: "read",
    contents: "read",
    issues: "write",
    "pull-requests": "read",
  },
  // A NEW workflow and caller added together in #3315. The caller grants these
  // exact scopes from its first release, so no installed snapshot predates the
  // callee contract. Freeze the row now to prevent any later scope widening.
  "nightly-e2e-tracking.yml": {
    actions: "read",
    contents: "read",
    issues: "write",
  },
  // Also a NEW workflow rather than a widened one — see the note on
  // environment-prepare.yml. The Playwright jobs it carries declared exactly
  // this inside quality.yml, so no consumer's grant changes by moving them.
  "playwright-e2e.yml": { contents: "read" },
  "publish-to-npm.yml": { contents: "read", "id-token": "write" },
  "quality-rails.yml": {
    checks: "write",
    contents: "read",
    "pull-requests": "write",
  },
  "quality.yml": { contents: "read" },
  "release-rails.yml": { contents: "write" },
  "release.yml": { contents: "write", "pull-requests": "read" },
  "sentry-deploy.yml": { contents: "read" },
  // `reusable-auto-update-pr-branches.yml` and its `-dispatch` counterpart were
  // removed with the whole subsystem (CodySwannGT/lisa#3590). Their entries go
  // with them: the "keeps the baseline in step" case below fails on an entry
  // whose workflow no longer exists, precisely so a stale line cannot sit here
  // making the equality assertion compare against a fiction.
  "zap-baseline-expo.yml": {},
  "zap-baseline-nestjs.yml": {},
};

describe("reusable workflows never gain a declared permission scope", () => {
  const live = liveDeclaredScopes(WORKFLOWS);

  it("finds the reusable workflows at all", () => {
    // The absent-case rule. Every assertion below is derived from `live`, so a
    // discovery bug — a renamed directory, a changed `workflow_call` shape —
    // would make them all pass by comparing nothing to nothing. A green run
    // that measured zero workflows is the failure mode this suite exists to
    // prevent, so the floor is asserted before anything is derived.
    expect(Object.keys(live).length).toBeGreaterThanOrEqual(18);
  });

  it("declares exactly the scopes in the frozen baseline", () => {
    // Equality, not a subset check, in BOTH directions. A gained scope breaks
    // installed callers; a silently DROPPED one means a job lost an access it
    // needs and will fail at runtime instead of here. Read the header before
    // editing the baseline to make this pass.
    expect(live).toEqual(BASELINE);
  });

  it("names the offending workflow and scope when one gains a scope", () => {
    // The bite control. Without it, a `liveDeclaredScopes` that returned the
    // baseline verbatim — or an equality that could not fail — would look
    // exactly like a clean fleet. This reproduces #2566 exactly: a JOB-level
    // `actions: read` under a workflow-level `contents: read`, which a check
    // reading only the workflow-level block would have waved through.
    // The scope is deliberately NOT `actions: read` any more — that is now in
    // the baseline, so reusing it would compare a value to itself and the
    // control would pass while proving nothing. `packages: write` stands in for
    // "the next scope somebody adds".
    const regressed = declaredScopes({
      permissions: { contents: "read", actions: "read" },
      jobs: { leg_order: { permissions: { packages: "write" } } },
    });
    expect(regressed).toEqual({
      contents: "read",
      actions: "read",
      packages: "write",
    });
    expect(regressed).not.toEqual(BASELINE["maestro-native-e2e.yml"]);
    expect(
      missingScopes(BASELINE["maestro-native-e2e.yml"], regressed)
    ).toEqual(["packages:write"]);
  });

  it("counts a raised level as a gain, not only a brand-new scope", () => {
    // `contents: write` where the caller granted `contents: read` is the same
    // class of failure as an entirely absent scope.
    expect(missingScopes({ contents: "read" }, { contents: "write" })).toEqual([
      "contents:write",
    ]);
    expect(missingScopes({ contents: "write" }, { contents: "read" })).toEqual(
      []
    );
  });

  it("keeps the baseline in step with the workflows directory", () => {
    // A workflow ADDED without a baseline entry, or an entry left behind after
    // a workflow is deleted, both mean the map above has stopped describing
    // reality — at which point the equality assertion is measuring a fiction.
    const onDisk = fs
      .readdirSync(WORKFLOWS)
      .filter(name => name.endsWith(".yml"));
    expect(Object.keys(BASELINE).every(name => onDisk.includes(name))).toBe(
      true
    );
  });
});
