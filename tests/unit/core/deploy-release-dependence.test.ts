/**
 * A deploy job that goes SILENT when its release fails must be detectable
 * (CodySwannGT/lisa#3740).
 *
 * GitHub renders a skipped job as neutral and counts a skipped required check
 * as satisfied, so a deploy that never happened leaves no signal at all — a
 * consuming repository ran eight days that way (#3467). #3738 fixed the
 * templates, but they are `create-only`, so every repository seeded before it
 * still carries the defect. This analysis is what finds it in a host's own
 * `deploy.yml`.
 *
 * Every case here drives the real analysis over the real conditions the
 * templates carried before and after #3738, so what is asserted is the verdict
 * the code reaches rather than a paraphrase of it. Two properties matter and
 * neither is visible from a happy-path test:
 *
 * 1. **It must flag both spellings, which look nothing alike.** One is an `if:`
 *    that never mentions the release; the other mentions it explicitly. A
 *    detector built on either one's text misses the other entirely.
 * 2. **It must NOT flag a job that skips for its own reasons.** A check that
 *    flags every skip is worse than none — it gets turned off inside a week,
 *    and then the real instances go unreported too.
 * @module tests/unit/core/deploy-release-dependence
 */
import { describe, expect, it } from "vitest";

import {
  type DependenceJob,
  deployJobsSkippedByFailedRelease,
  isDeployJob,
  isReleaseJob,
  releaseDependence,
} from "../../../src/core/deploy-release-dependence.js";

/** The rails deploy job's condition before #3738: no mention of the release. */
const RAILS_BEFORE =
  "${{ github.event_name != 'push' || " +
  "!startsWith(github.event.head_commit.message, 'chore(release):') }}";

/** The same condition after #3738, with the implicit `success()` suppressed. */
const RAILS_AFTER =
  "!cancelled() && (github.event_name != 'push' || " +
  "!startsWith(github.event.head_commit.message, 'chore(release):'))";

/** The expo deploy job's condition before #3738: the release named outright. */
const EXPO_BEFORE =
  "always() && needs.check_eas_setup.outputs.has_eas_setup == 'true' && " +
  "needs.release.result == 'success'";

/** The same condition after #3738. */
const EXPO_AFTER =
  "!cancelled() && needs.check_eas_setup.outputs.has_eas_setup == 'true'";

/**
 * Build a deploy job that needs the release.
 * @param ifCondition - The job's `if:` text
 * @param extraNeeds - Upstream jobs beyond the release
 * @returns A job shaped for the analysis
 */
function deployJob(
  ifCondition: string,
  extraNeeds: readonly string[] = []
): DependenceJob {
  return {
    id: "deploy",
    name: "Deploy",
    needs: ["release", ...extraNeeds],
    ifCondition,
  };
}

/** The verdict for a job the release result silences. */
const SKIPS = "skips-on-failed-release";

/** The release job every fixture depends on. */
const RELEASE: DependenceJob = {
  id: "release",
  name: "Release",
  needs: [],
  ifCondition: "",
};

describe("a deploy job that skips on a failed release (#3740)", () => {
  describe("both spellings the templates carried are flagged", () => {
    it("flags a job with no `if:` at all, where GitHub's implicit success() skips it", () => {
      expect(releaseDependence(deployJob(""), "release")).toEqual({
        kind: SKIPS,
        release: "release",
      });
    });

    it("flags the rails condition, which never mentions the release", () => {
      expect(releaseDependence(deployJob(RAILS_BEFORE), "release").kind).toBe(
        SKIPS
      );
    });

    it("flags the expo condition, which conjoins the release result by hand", () => {
      expect(
        releaseDependence(
          deployJob(EXPO_BEFORE, ["check_eas_setup"]),
          "release"
        ).kind
      ).toBe(SKIPS);
    });
  });

  describe("a job that survives a failed release is not flagged", () => {
    it("clears the rails condition as #3738 rewrote it", () => {
      expect(releaseDependence(deployJob(RAILS_AFTER), "release").kind).toBe(
        "independent"
      );
    });

    it("clears the expo condition as #3738 rewrote it", () => {
      expect(
        releaseDependence(deployJob(EXPO_AFTER, ["check_eas_setup"]), "release")
          .kind
      ).toBe("independent");
    });

    it("clears a job gated only on a stack that is not configured", () => {
      // The acceptance criteria's third scenario. The job skips when the stack
      // is absent and goes on skipping whatever the release does, so the
      // release is not what silences it and there is nothing here to report.
      const job = deployJob(
        "!cancelled() && needs.check_stack.outputs.configured == 'true'",
        ["check_stack"]
      );

      expect(releaseDependence(job, "release").kind).toBe("independent");
    });

    it("clears a job that is switched off, which skips whatever the release does", () => {
      // It skips when the release succeeds AND when it fails, so the release is
      // not what silences it. Reporting this would tell an operator to repair a
      // job somebody deliberately turned off.
      expect(releaseDependence(deployJob("${{ false }}"), "release").kind).toBe(
        "independent"
      );
    });

    it("clears a job whose condition ignores its upstreams entirely", () => {
      expect(releaseDependence(deployJob("always()"), "release").kind).toBe(
        "independent"
      );
    });
  });

  describe("an unreadable condition claims nothing either way", () => {
    it("reports why it could not be read rather than returning a verdict", () => {
      const outcome = releaseDependence(
        deployJob("needs.release.result == 'success' && hashFiles('**/x')"),
        "release"
      );

      expect(outcome.kind).toBe("unreadable");
      expect(outcome.kind === "unreadable" && outcome.reason).toContain(
        "hashFiles"
      );
    });

    it("does not report an unreadable job as skipping", () => {
      const jobs = [RELEASE, deployJob("contains(fromJSON('[]'), 'x')")];

      expect(deployJobsSkippedByFailedRelease(jobs)).toEqual([]);
    });
  });

  describe("which jobs are even asked about", () => {
    it("recognises a release job by id or name", () => {
      expect(isReleaseJob(RELEASE)).toBe(true);
      expect(
        isReleaseJob({ id: "publish_npm", needs: [], ifCondition: "" })
      ).toBe(true);
      expect(isReleaseJob({ id: "lint", needs: [], ifCondition: "" })).toBe(
        false
      );
    });

    it("recognises a deploy job by a declared environment, not only by name", () => {
      expect(
        isDeployJob({
          id: "ship_it",
          needs: [],
          ifCondition: "",
          environment: ["production"],
        })
      ).toBe(true);
      expect(isDeployJob({ id: "ship_it", needs: [], ifCondition: "" })).toBe(
        false
      );
    });

    it("never reports the release job as skipping on itself", () => {
      const selfNaming: DependenceJob = {
        id: "release_deploy",
        needs: [],
        ifCondition: "",
      };

      expect(deployJobsSkippedByFailedRelease([selfNaming])).toEqual([]);
    });

    it("ignores a job that both releases and deploys, even when it needs another release", () => {
      // `release_deploy` is release-like AND deploy-like. Lisa does not insert a
      // guard into a job that cuts the release: the guard's whole content is
      // "the release did not succeed", which a job that IS the release cannot
      // meaningfully assert about itself.
      const combined: DependenceJob = {
        id: "release_deploy",
        needs: ["release"],
        ifCondition: "",
      };

      expect(deployJobsSkippedByFailedRelease([RELEASE, combined])).toEqual([]);
    });

    it("ignores a non-deploy job that skips on the release", () => {
      const notify: DependenceJob = {
        id: "notify",
        needs: ["release"],
        ifCondition: "",
      };

      expect(deployJobsSkippedByFailedRelease([RELEASE, notify])).toEqual([]);
    });

    it("ignores a deploy job that does not need the release at all", () => {
      const standalone: DependenceJob = {
        id: "deploy",
        needs: [],
        ifCondition: "",
      };

      expect(deployJobsSkippedByFailedRelease([RELEASE, standalone])).toEqual(
        []
      );
    });

    it("names the deploy job and the release it waits on", () => {
      const found = deployJobsSkippedByFailedRelease([
        RELEASE,
        deployJob(RAILS_BEFORE),
      ]);

      expect(found).toHaveLength(1);
      expect(found[0]?.job.id).toBe("deploy");
      expect(found[0]?.release).toBe("release");
    });
  });
});
