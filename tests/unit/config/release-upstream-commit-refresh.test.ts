/**
 * The release hook refreshes the commit list `lisa file-upstream` accepts
 * (CodySwannGT/lisa#4960).
 *
 * The list was extended only by `--refresh-public-commits`, and nothing in the
 * build, the release configuration, or a workflow passed that flag — so the
 * list stopped growing the day it was introduced and every later commit was
 * refused. These cases pin the wiring that runs it. Whether the wiring WORKS is
 * proven by running it, in
 * `tests/integration/release-upstream-commit-refresh.test.ts`.
 * @module tests/unit/config/release-upstream-commit-refresh
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { jobOf, loadWorkflow } from "../../helpers/workflow-test-utils.js";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const REFRESH =
  "node scripts/generate-upstream-evidence-manifest.mjs --refresh-public-commits";
const RELEASE_COMMIT_CHECK = "node scripts/check-release-commit-listed.mjs";
const MANIFEST = "src/core/upstream-evidence-manifest.json";
const OTHER_OUTPUTS_STAGED = "git add plugins/lisa plugins/lisa-*";

/** The parts of `.versionrc` these cases read. */
interface VersionConfig {
  readonly "commit-all"?: boolean;
  readonly scripts?: Readonly<Record<string, string>>;
}

/**
 * Read the standard-version configuration.
 * @returns The parsed `.versionrc`
 */
const versionConfig = (): VersionConfig =>
  JSON.parse(
    readFileSync(path.join(REPO_ROOT, ".versionrc"), "utf8")
  ) as VersionConfig;

/**
 * The release hook's steps, in order.
 * @returns Each `&&`-separated step of `postbump`, trimmed
 */
const hookSteps = (): readonly string[] =>
  (versionConfig().scripts?.postbump ?? "")
    .split("&&")
    .map(step => step.trim())
    .filter(Boolean);

describe("release hook: upstream public-commit list", () => {
  it("refreshes the list from history on every release", () => {
    expect(hookSteps()).toContain(REFRESH);
  });

  it("checks the refreshed list before anything of it is staged", () => {
    const steps = hookSteps();
    const refresh = steps.indexOf(REFRESH);
    const check = steps.indexOf(RELEASE_COMMIT_CHECK);
    const staged = steps.findIndex(
      step => step.startsWith("git add ") && step.includes(MANIFEST)
    );

    expect(refresh).toBeGreaterThanOrEqual(0);
    expect(check).toBeGreaterThan(refresh);
    expect(staged).toBeGreaterThan(check);
  });

  it("regenerates after the other release outputs are staged", () => {
    // The generator reads TRACKED files, so it has to run after the plugin
    // bundles are staged — the other order records the file set from before
    // the release build (.agents/rules/regenerating-derived-artifacts.md).
    const steps = hookSteps();
    const othersStaged = steps.findIndex(step =>
      step.startsWith(OTHER_OUTPUTS_STAGED)
    );

    expect(othersStaged).toBeGreaterThanOrEqual(0);
    expect(steps.indexOf(REFRESH)).toBeGreaterThan(othersStaged);
  });

  it("commits what the hook staged", () => {
    // `commit-all` is what makes standard-version commit staged files it did
    // not bump itself. Without it the refreshed list is staged and left behind.
    expect(versionConfig()["commit-all"]).toBe(true);
  });

  it("releases from a checkout with full history", () => {
    // The refresh lists every commit reachable from origin's refs and refuses
    // a shallow clone, so the job that runs standard-version must fetch it all.
    const steps =
      jobOf(
        loadWorkflow(path.join(REPO_ROOT, ".github/workflows/release.yml")),
        "version"
      ).steps ?? [];
    const checkout = steps.find(step =>
      (step.uses ?? "").startsWith("actions/checkout@")
    );

    expect(checkout?.with?.["fetch-depth"]).toBe(0);
  });
});
