/**
 * Every job that installs a Ruby Lisa chose runs on a fixed image
 * (CodySwannGT/lisa#4513).
 *
 * `ruby/setup-ruby` publishes prebuilt Rubies per runner image. In October
 * 2026 GitHub moved `ubuntu-latest` to the 26.04 image, which has no 4.0.1
 * build, and every pull request's Integration Tests failed at setup:
 * "Unavailable version 4.0.1 for ruby on ubuntu-26.04". A job that pins a
 * literal `ruby-version` has to pin the image that version is published for.
 *
 * Jobs that leave `ruby-version` unset (the reusable Rails workflow, which
 * reads the caller's own `.ruby-version`) are the caller's choice, not Lisa's,
 * and are out of scope. Jobs are found by their steps rather than listed by
 * name, so a new job that pins a Ruby inherits the rule.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  loadWorkflow,
  type ParsedWorkflow,
  type WorkflowStep,
} from "../helpers/workflow-test-utils.js";

const WORKFLOWS = path.resolve(__dirname, "..", "..", ".github", "workflows");

/** A job as the guard reads it. */
interface RubyJob {
  readonly workflow: string;
  readonly job: string;
  readonly runsOn: unknown;
  readonly rubyVersion: string;
}

/**
 * Every job whose setup-ruby step names a literal ruby-version.
 * @returns The jobs, with their runs-on and the Ruby they install
 */
function jobsPinningRuby(): RubyJob[] {
  return fs
    .readdirSync(WORKFLOWS)
    .filter(file => /\.ya?ml$/.test(file))
    .flatMap(workflow => {
      const doc = loadWorkflow(path.join(WORKFLOWS, workflow)) as
        | ParsedWorkflow
        | undefined;
      return Object.entries(doc?.jobs ?? {}).flatMap(([job, body]) => {
        const steps = ((body as { steps?: WorkflowStep[] }).steps ??
          []) as WorkflowStep[];
        const pinned = steps.find(
          step =>
            String(step.uses ?? "").startsWith("ruby/setup-ruby") &&
            step.with?.["ruby-version"] !== undefined
        );
        return pinned === undefined
          ? []
          : [
              {
                workflow,
                job,
                runsOn: (body as { "runs-on"?: unknown })["runs-on"],
                rubyVersion: String(pinned.with?.["ruby-version"]),
              },
            ];
      });
    });
}

describe("jobs that pin a Ruby pin their runner image", () => {
  const jobs = jobsPinningRuby();

  it("finds the Lisa-owned Ruby jobs, including the integration job", () => {
    expect(jobs.map(({ workflow, job }) => `${workflow}:${job}`)).toEqual(
      expect.arrayContaining([
        "quality.yml:test_integration",
        "plugins-sync.yml:guard-trace",
      ])
    );
  });

  it.each(
    jobsPinningRuby().map(entry => [`${entry.workflow}:${entry.job}`, entry])
  )("%s runs on a fixed image, not ubuntu-latest", (_name, entry) => {
    expect(typeof entry.runsOn).toBe("string");
    expect(entry.runsOn).not.toBe("ubuntu-latest");
    expect(String(entry.runsOn)).toMatch(/^ubuntu-\d{2}\.\d{2}$/);
  });
});
