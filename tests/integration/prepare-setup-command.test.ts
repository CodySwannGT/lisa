/**
 * The environment-preparation setup seam runs BEFORE the verbs, everywhere.
 *
 * Why the seam exists: the target environment is not always a runtime argument.
 * A project may materialise it as a build-time fact — copying a gitignored
 * `.env.local`, exporting a profile — and its `environment:reset` then refuses
 * unless that file agrees with `--env`. The refusal is correct: the sweeper
 * underneath defaults to a real environment when the file is absent, so "no
 * target named" must never resolve to "the default one". Without a seam, the
 * job checks out, installs, and runs a verb that cannot know what it is aimed
 * at — so the repo ships a preparation that can only fail.
 *
 * Why ORDER is the thing asserted: a setup command placed after the verbs is
 * not a smaller version of this feature, it is a no-op that looks like the
 * feature. It would run, succeed, and change nothing, and the failure it was
 * added to prevent would still happen — with a configured input sitting in the
 * caller implying otherwise.
 *
 * All four preparation sites are covered together, because the seam is only
 * useful if it exists at every one. A caller that sets it and silently gets it
 * at three of four is worse than not having it.
 * @module tests/integration/prepare-setup-command
 */

import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = path.resolve(__dirname, "..", "..", ".github", "workflows");

const MAESTRO = "maestro-native-e2e.yml";

/** Every job that prepares an environment, and the workflow it lives in. */
const PREPARE_SITES = [
  ["environment-prepare.yml", "prepare"],
  ["playwright-e2e.yml", "prepare"],
  [MAESTRO, "pre_suite"],
  [MAESTRO, "inter_leg_prepare"],
] as const;

const SETUP_STEP = "Prepare setup command";
const VERB_STEP = "🧼 Prepare the environment";

/**
 * The step names of one job.
 * @param file Workflow filename.
 * @param job Job key.
 * @returns Ordered step names.
 */
function stepNames(file: string, job: string): string[] {
  const doc = yaml.load(readFileSync(path.join(WORKFLOWS, file), "utf8")) as {
    jobs: Record<string, { steps: { name: string }[] }>;
  };
  return doc.jobs[job].steps.map(step => step.name);
}

describe("the preparation setup seam", () => {
  it.each(PREPARE_SITES.map(site => [`${site[0]}:${site[1]}`, ...site]))(
    "%s runs the setup command before the verbs",
    (_label, file, job) => {
      const names = stepNames(file, job);
      const setupAt = names.findIndex(name => name.includes(SETUP_STEP));
      const verbAt = names.findIndex(name => name.startsWith(VERB_STEP));

      // Both must exist. A missing verb step would make the ordering assertion
      // pass vacuously against -1.
      expect(setupAt).toBeGreaterThanOrEqual(0);
      expect(verbAt).toBeGreaterThanOrEqual(0);
      expect(setupAt).toBeLessThan(verbAt);
    }
  );

  it.each(PREPARE_SITES.map(site => [`${site[0]}:${site[1]}`, ...site]))(
    "%s runs the setup command after dependencies are installed",
    (_label, file, job) => {
      // The command frequently needs the project's own tooling. Placing it
      // before the install would make the common case fail for a reason that
      // has nothing to do with what it is trying to do.
      const names = stepNames(file, job);
      const installAt = names.findIndex(name => name.includes("Install"));
      const setupAt = names.findIndex(name => name.includes(SETUP_STEP));

      expect(installAt).toBeGreaterThanOrEqual(0);
      expect(setupAt).toBeGreaterThan(installAt);
    }
  );

  it("covers every preparation site the workflows declare", () => {
    // The absent-case rule. If a new preparation site is added and not listed
    // here, every assertion above still passes while the new site has no
    // coverage at all. This fails instead.
    const declared = new Set(
      PREPARE_SITES.map(([file, job]) => `${file}:${job}`)
    );
    const found = new Set<string>();

    for (const file of [
      "environment-prepare.yml",
      "playwright-e2e.yml",
      MAESTRO,
    ]) {
      const doc = yaml.load(
        readFileSync(path.join(WORKFLOWS, file), "utf8")
      ) as {
        jobs: Record<string, { steps?: { name: string }[] }>;
      };
      for (const [job, body] of Object.entries(doc.jobs)) {
        if ((body.steps ?? []).some(step => step.name?.startsWith(VERB_STEP))) {
          found.add(`${file}:${job}`);
        }
      }
    }

    const byName = (a: string, b: string) => a.localeCompare(b);
    expect([...found].slice().sort(byName)).toEqual(
      [...declared].slice().sort(byName)
    );
  });
});
