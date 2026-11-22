/**
 * The Rails release path must not share one `vX.Y.Z` tag namespace across
 * environments.
 *
 * `release.yml` was given environment-scoped release tags in July 2026, but
 * `release-rails.yml` is a separate implementation that never received the
 * change: it ran bare `standard-version` and `git push --follow-tags` on
 * whatever branch triggered it, so `dev`, `staging` and `main` all cut clean
 * `vX.Y.Z` tags into one repo-global namespace. A version cut on one branch
 * then collided with the same version cut on another, the push was rejected,
 * the release job failed, and the Deploy job that depends on it was SKIPPED —
 * a branch that looks released with nothing deployed (CodySwannGT/lisa#3467).
 *
 * These cases execute the real job extracted from the workflow rather than
 * asserting on its text, because the defect was behavioural: the previous
 * implementation contained no wrong string, it simply named every tag the same
 * way on every branch. The assertion that discriminates against it is that
 * `dev` and `staging` no longer produce the same tag.
 *
 * The job runs against a local bare remote with `standard-version` stood in
 * for by a deterministic `npx` stub — see `tests/helpers/release-rails-job.ts`.
 * The racing-merge behaviour of the same job is covered by
 * `release-rails-push-race.test.ts` (CodySwannGT/lisa#4748).
 * @module tests/integration/release-rails-tag-namespace
 */
import * as fs from "fs-extra";
import yaml from "js-yaml";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  cloneRemote,
  git,
  isAncestor,
  releaseFixture,
  RELEASE_RAILS_YML,
  runReleaseJob,
  type ReleaseFixture,
} from "../helpers/release-rails-job.js";

/** The version these cases bump to, fixed so tags are predictable. */
const VERSION = "1.4.2";

/** The VERSION the remote starts at; the stubbed bump lands on `VERSION`. */
const BASE_VERSION = "1.4.1";

/** `VERSION` with its dots escaped, for building tag-shape expectations. */
const VERSION_RE = VERSION.replace(/\./g, "\\.");

/** Minimal shape of the parsed workflow these cases read. */
interface RailsReleaseWorkflow {
  readonly jobs: Record<
    string,
    {
      readonly steps?: ReadonlyArray<{
        readonly id?: string;
        readonly name?: string;
        readonly run?: string;
      }>;
    }
  >;
}

/** What one execution of the release job produced. */
interface StepRun {
  readonly status: number | null;
  /** stdout and stderr combined: `::error::` is a stdout annotation. */
  readonly output: string;
  /** The version step's outputs. */
  readonly outputs: Record<string, string>;
  /** The checkout the job ran in. */
  readonly clone: string;
}

let releaseStepScript = "";
const scratchRoots: string[] = [];

/**
 * Reads one step's `run` body out of the release job.
 * @param workflow - The parsed workflow.
 * @param id - The step's `id`, or its `name` when it carries no id.
 * @returns The step's shell body.
 */
function stepScript(workflow: RailsReleaseWorkflow, id: string): string {
  const steps = workflow.jobs.release?.steps ?? [];
  const step = steps.find(s => s.id === id || s.name === id);

  if (!step?.run) {
    throw new Error(`No step with id or name "${id}" in release-rails.yml`);
  }
  return step.run;
}

/**
 * A fresh remote at `BASE_VERSION` on `branch`, removed after the case.
 * @param branch - Branch the release runs on.
 * @returns The fixture.
 */
function freshFixture(branch: string): ReleaseFixture {
  const fixture = releaseFixture(BASE_VERSION, branch);

  scratchRoots.push(fixture.base);
  return fixture;
}

/**
 * Builds a remote where `vX.Y.Z` already points at a commit off the branch.
 * @param branch - Branch the release runs on.
 * @returns The fixture.
 */
function remoteWithPriorTag(branch: string): ReleaseFixture {
  const fixture = freshFixture(branch);
  const other = cloneRemote(fixture, "prior");

  git(other, "commit", "--quiet", "--allow-empty", "-m", "prior release");
  git(other, "tag", "-a", `v${VERSION}`, "-m", "prior release");
  git(other, "push", "--quiet", "origin", `refs/tags/v${VERSION}`);
  return fixture;
}

/**
 * Runs the release job for one branch.
 * @param branch - The branch the job runs on.
 * @param fixture - Remote to release against; a fresh one when omitted.
 * @returns Exit status, combined output, and the version step's outputs.
 */
function runVersionStep(
  branch: string,
  fixture: ReleaseFixture = freshFixture(branch)
): StepRun {
  const clone = cloneRemote(fixture, `run-${branch.replace(/\//g, "-")}`);
  const run = runReleaseJob(fixture, clone);

  return {
    status: run.status,
    output: run.output,
    outputs: run.outputs["version"] ?? {},
    clone,
  };
}

describe("release-rails.yml environment-scoped tags (#3467)", () => {
  beforeAll(() => {
    const workflow = yaml.load(
      fs.readFileSync(RELEASE_RAILS_YML, "utf8")
    ) as RailsReleaseWorkflow;

    releaseStepScript = stepScript(workflow, "Create GitHub Release");
  });

  afterEach(() => {
    for (const root of scratchRoots.splice(0)) {
      fs.removeSync(root);
    }
  });

  it("cuts a clean vX.Y.Z on every production branch name", () => {
    for (const branch of ["main", "master", "prod", "production"]) {
      const run = runVersionStep(branch);

      expect(run.status, run.output).toBe(0);
      expect(run.outputs["tag"]).toBe(`v${VERSION}`);
    }
  });

  it("gives each non-production branch its own tag namespace", () => {
    const dev = runVersionStep("dev");
    const staging = runVersionStep("staging");

    expect(dev.status).toBe(0);
    expect(staging.status).toBe(0);
    expect(dev.outputs["tag"]).toMatch(
      new RegExp(`^v${VERSION_RE}-dev\\.\\d+$`)
    );
    expect(staging.outputs["tag"]).toMatch(
      new RegExp(`^v${VERSION_RE}-staging\\.\\d+$`)
    );

    // The collision the ticket is about: same version, two branches. Before
    // this change both produced exactly "v1.4.2".
    expect(dev.outputs["tag"]).not.toBe(staging.outputs["tag"]);
  });

  it("keeps VERSION clean so the next bump is never fed a prerelease string", () => {
    const run = runVersionStep("staging");

    expect(run.outputs["version"]).toBe(VERSION);
    expect(git(run.clone, "show", "HEAD:VERSION")).toBe(VERSION);
    // The suffix belongs to the tag alone.
    expect(run.outputs["tag"]).toContain("-staging.");
  });

  it("flattens a branch name that is legal in a ref but not in a semver label", () => {
    const run = runVersionStep("release/2026-09");

    expect(run.status).toBe(0);
    expect(run.outputs["tag"]).toMatch(
      new RegExp(`^v${VERSION_RE}-release-2026-09\\.\\d+$`)
    );
    expect(run.outputs["tag"]).not.toContain("/");
  });

  it("advances past a production tag that already points at a different commit", () => {
    // Refusing here (the behaviour before #4748) wedged every later run,
    // because VERSION on the branch never moved past the taken tag.
    const fixture = remoteWithPriorTag("main");
    const run = runVersionStep("main", fixture);

    expect(run.status, run.output).toBe(0);
    expect(run.output).toContain("::warning::");
    expect(run.output).toContain(`Tag v${VERSION} is already taken`);
    expect(run.outputs["tag"]).toBe("v1.4.3");
    expect(isAncestor(fixture.remote, "v1.4.3", "main")).toBe(true);
  });

  it("reuses an existing release on rerun instead of failing the deploy behind it", () => {
    // A release job that dies here takes the Deploy job with it, because
    // Deploy `needs:` the release — the silent half of #3467.
    expect(releaseStepScript).toContain('gh release view "$TAG"');
    expect(releaseStepScript).toContain("exit 0");
    expect(releaseStepScript).toContain('gh release create "$TAG"');
  });
});
