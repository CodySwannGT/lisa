/**
 * A job that installs a pinned Ruby must also pin its runner image.
 *
 * `ruby/setup-ruby` only publishes prebuilt Rubies per runner image. When
 * `ubuntu-latest` moved to `ubuntu-26.04`, every job asking for Ruby 4.0.1 on
 * `ubuntu-latest` failed at setup with "Unavailable version 4.0.1 for ruby on
 * ubuntu-26.04", taking the integration job and the shell-guard shards down on
 * every pull request at once (#4513). A literal `ruby-version` is only as
 * stable as the image it was published for, so the two must move together.
 * Jobs that read the version from the host's `.ruby-version` are out of scope:
 * the host owns that pairing.
 * @module tests/unit/config/ruby-runner-pin
 */
import yaml from "js-yaml";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  ".github",
  "workflows"
);

/**
 *
 */
interface Step {
  readonly uses?: string;
  readonly with?: Record<string, unknown>;
}
/**
 *
 */
interface Job {
  readonly "runs-on"?: unknown;
  readonly steps?: readonly Step[];
}

/** Every job, by workflow file, that installs a literal Ruby version. */
const PINNED_RUBY_JOBS = readdirSync(WORKFLOWS)
  .filter(file => /\.ya?ml$/.test(file))
  .flatMap(file => {
    const workflow = yaml.load(
      readFileSync(path.join(WORKFLOWS, file), "utf8")
    ) as { readonly jobs?: Record<string, Job> } | null;
    return Object.entries(workflow?.jobs ?? {}).flatMap(([name, job]) => {
      const ruby = (job.steps ?? []).find(step =>
        String(step.uses ?? "").startsWith("ruby/setup-ruby@")
      );
      const version = ruby?.with?.["ruby-version"];
      return typeof version === "string"
        ? [{ file, name, version, runsOn: job["runs-on"] }]
        : [];
    });
  });

describe("pinned Ruby runner images", () => {
  it("finds the jobs it is meant to police", () => {
    expect(PINNED_RUBY_JOBS.map(job => `${job.file}:${job.name}`)).toEqual(
      expect.arrayContaining([
        "plugins-sync.yml:guard-trace",
        "quality.yml:test_integration",
      ])
    );
  });

  it.each(PINNED_RUBY_JOBS)(
    "$file $name installs Ruby $version on a pinned image",
    ({ runsOn }) => {
      expect(runsOn).toMatch(/^ubuntu-\d{2}\.\d{2}$/);
    }
  );
});
