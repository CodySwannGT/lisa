/**
 * `actions/checkout` writes an unscoped git credential into `.git/config`
 * unless told not to. Every later step in that job can read it — including
 * third-party actions, the caller-supplied `pre_suite_command`, and anything
 * Maestro executes — and use it to push as the workflow.
 *
 * No job in this workflow pushes. It builds with EAS, boots a device, and runs
 * flows. So the credential is pure blast radius, and the fix is one line per
 * checkout.
 *
 * The check is written as a pure function over the parsed document so it can be
 * run against a DELIBERATELY BROKEN copy in the same file. A guard observed
 * only passing has not been shown to work; the second test mutates each
 * checkout in turn and requires the guard to name that exact job.
 */

import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REUSABLE_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

/** Root shape of the parsed reusable workflow. */
interface Workflow {
  jobs: Record<string, { steps?: WorkflowStep[] }>;
}

/** The action every checkout step in this workflow uses. */
const CHECKOUT_ACTION = "actions/checkout";

/** The `with:` key that stops the checkout writing a token into .git/config. */
const PERSIST_CREDENTIALS = "persist-credentials";

/**
 * Every checkout in the workflow that would leave a git credential behind.
 *
 * Enumerated from the parsed document rather than checked against a count, so a
 * checkout added to a NEW job in future is covered the day it lands — a guard
 * pinned to "five checkouts" passes the moment a sixth appears.
 * @param doc - The parsed workflow to inspect
 * @returns `job/step-name` for each offending checkout
 */
const credentialLeaks = (doc: Workflow): string[] => {
  const leaks: string[] = [];
  for (const [jobName, job] of Object.entries(doc.jobs)) {
    for (const step of job.steps ?? []) {
      if (!String(step.uses ?? "").startsWith(CHECKOUT_ACTION)) {
        continue;
      }
      if (step.with?.[PERSIST_CREDENTIALS] !== false) {
        leaks.push(`${jobName}/${step.name ?? step.uses}`);
      }
    }
  }
  return leaks;
};

/**
 * Every checkout step in the workflow, with the job that owns it.
 * @param doc - The parsed workflow to inspect
 * @returns Pairs of job name and checkout step
 */
const checkoutSteps = (doc: Workflow): Array<[string, WorkflowStep]> => {
  const found: Array<[string, WorkflowStep]> = [];
  for (const [jobName, job] of Object.entries(doc.jobs)) {
    for (const step of job.steps ?? []) {
      if (String(step.uses ?? "").startsWith(CHECKOUT_ACTION)) {
        found.push([jobName, step]);
      }
    }
  }
  return found;
};

describe("maestro-native-e2e checkout credentials", () => {
  let workflow: Workflow;

  beforeAll(async () => {
    workflow = yaml.load(await fs.readFile(REUSABLE_YML, "utf-8")) as Workflow;
  });

  it("leaves no git credential in .git/config in ANY job", () => {
    expect(credentialLeaks(workflow)).toEqual([]);
  });

  it("covers every checkout the workflow has, not a remembered subset", () => {
    // Guards decay into stale proxies when they encode which values existed at
    // the time they were written. This one asserts only that checkouts EXIST to
    // be covered; the coverage itself comes from the enumeration above.
    expect(checkoutSteps(workflow).length).toBeGreaterThan(0);
  });

  it("BITE: the check fails when any single checkout drops the setting", () => {
    for (const [jobName, step] of checkoutSteps(workflow)) {
      const mutated = yaml.load(yaml.dump(workflow)) as Workflow;
      const victim = (mutated.jobs[jobName].steps ?? []).find(
        candidate =>
          String(candidate.uses ?? "").startsWith(CHECKOUT_ACTION) &&
          candidate.name === step.name
      );
      if (victim?.with) {
        delete victim.with[PERSIST_CREDENTIALS];
      }
      expect(
        credentialLeaks(mutated),
        `dropping persist-credentials in ${jobName} went undetected`
      ).toContain(`${jobName}/${step.name ?? step.uses}`);
    }
  });
});
