/**
 * A shipped workflow's NAME must not assert a step its jobs do not perform
 * (issue #3493).
 *
 * The CDK `deploy.yml` was named `🚀 Release and Deploy` and its job list was
 * `determine_environment`, `pre_deploy_gates`, `release`, `post_deploy_gates`.
 * Nothing deployed. CDK consumers deploy through a self-mutating AWS
 * CodePipeline defined in their own stack code, triggered from `main` inside
 * AWS rather than from GitHub Actions — so a green check on that workflow
 * proved the change was RELEASED and said nothing about whether it was
 * deployed. Those are different facts, and at the call site only the name is
 * visible.
 *
 * The observed cost was not hypothetical: an automated grooming pass
 * recommended transitioning a work item to Done because a workflow called
 * "Release and Deploy" reported SUCCESS on the merge commit. The change was
 * sitting at a manual approval gate inside CodePipeline, deployed to nothing.
 * Disproving it took a second pass that read the run's actual jobs, plus two
 * API calls that returned no deployments and no environments — none of which a
 * reader of the name and the green check ever sees.
 *
 * **Stated over the whole set of shipped templates, deliberately.** Pinning the
 * CDK file by name would say nothing about the next template that acquires a
 * name stronger than its jobs, and that is the failure mode: a workflow whose
 * behaviour varies by consumer, but whose name is fixed, will keep asserting
 * the stronger claim. The name has to describe the weakest configuration it
 * ships in.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED — the
 * scaffolding job ids below are written out rather than derived from any
 * template.
 *
 * @module tests/unit/config/deploy-workflow-naming
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { globSync } from "glob";
import { load as loadYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

/** Repository root, resolved from this file rather than from cwd. */
const ROOT = path.resolve(__dirname, "../../..");

/**
 * The jobs that make up the release scaffolding every stack's `deploy.yml`
 * shares, none of which deploys anything.
 *
 * `pre_deploy_gates` and `post_deploy_gates` carry the word in their ids and
 * are the reason a substring search over job names cannot answer this: they
 * prove a property AROUND a deploy, they do not perform one. `release` cuts a
 * tag and publishes artifacts.
 *
 * **This set is the escape hatch, so it is kept small on purpose.** Adding an
 * id here is how a future change would silence this test while leaving a
 * workflow that still over-promises, so an addition needs to be a job that
 * genuinely deploys nothing — and it should be argued for in review, not
 * appended.
 */
const RELEASE_SCAFFOLDING: readonly string[] = [
  "determine_environment",
  "pre_deploy_gates",
  "release",
  "post_deploy_gates",
];

/** Shape of the parts of a workflow file this test reads. */
interface WorkflowDoc {
  readonly name?: unknown;
  readonly jobs?: Record<string, unknown>;
}

/**
 * Every `deploy.yml` Lisa seeds into a consumer, one per stack.
 *
 * `create-only` rather than `copy-overwrite` because these are the files a host
 * owns after seeding; the ones under `.github/` in this repository are Lisa's
 * own and are not shipped to anyone.
 * @returns Repository-relative paths, sorted for a stable failure message.
 */
function shippedDeployWorkflows(): readonly string[] {
  return globSync("*/create-only/.github/workflows/deploy.yml", {
    cwd: ROOT,
  }).sort((a, b) => a.localeCompare(b));
}

/**
 * Every workflow file Lisa seeds into a consumer, of any kind.
 * @returns Repository-relative paths, sorted for a stable failure message.
 */
function shippedWorkflows(): readonly string[] {
  return globSync("*/create-only/.github/workflows/*.yml", {
    cwd: ROOT,
  }).sort((a, b) => a.localeCompare(b));
}

/**
 * Parse a workflow into the subset of its structure this test reads.
 * @param relative - Repository-relative path to the workflow file.
 * @returns The parsed document, or an empty object when it is not a mapping.
 */
function readWorkflow(relative: string): WorkflowDoc {
  const parsed = loadYaml(readFileSync(path.join(ROOT, relative), "utf8"));
  return typeof parsed === "object" && parsed !== null
    ? (parsed as WorkflowDoc)
    : {};
}

/**
 * Whether a workflow's name claims to the reader that it deploys.
 * @param doc - Parsed workflow document.
 * @returns True when the word appears anywhere in the workflow name.
 */
function nameClaimsDeploy(doc: WorkflowDoc): boolean {
  return typeof doc.name === "string" && /deploy/iu.test(doc.name);
}

/**
 * The job ids in a workflow that are not part of the release scaffolding.
 *
 * Anything left over is the workflow doing something of its own, which for a
 * `deploy.yml` is the deploy. Computed by exclusion rather than by looking for
 * a job called "deploy": the stacks name theirs `deploy`, `deploy_rails` and
 * `trigger_eas_build`, and a list of accepted spellings would go stale the
 * first time a new stack picked a fourth.
 * @param doc - Parsed workflow document.
 * @returns Job ids outside the shared scaffolding.
 */
function jobsBeyondScaffolding(doc: WorkflowDoc): readonly string[] {
  const jobs = doc.jobs;
  if (typeof jobs !== "object" || jobs === null) return [];
  return Object.keys(jobs).filter(id => !RELEASE_SCAFFOLDING.includes(id));
}

describe("a shipped workflow name matches what its jobs do", () => {
  it("finds the deploy workflows it is supposed to be checking", () => {
    // A glob that silently matches nothing would make every assertion below
    // vacuously true, which is the shape of green this whole file exists to
    // refuse.
    expect(shippedDeployWorkflows().length).toBeGreaterThanOrEqual(5);
  });

  it("never names a workflow for a deploy it does not contain", () => {
    const overPromising = shippedDeployWorkflows().filter(relative => {
      const doc = readWorkflow(relative);
      return nameClaimsDeploy(doc) && jobsBeyondScaffolding(doc).length === 0;
    });
    expect(overPromising).toEqual([]);
  });

  it("does say Deploy when a deploy job is there", () => {
    // The converse matters as much: a workflow that really does deploy must
    // not be renamed into understating itself, or the same reader is misled in
    // the other direction.
    const underPromising = shippedDeployWorkflows().filter(relative => {
      const doc = readWorkflow(relative);
      return !nameClaimsDeploy(doc) && jobsBeyondScaffolding(doc).length > 0;
    });
    expect(underPromising).toEqual([]);
  });
});

describe("a shipped workflow does not end in a dangling comment", () => {
  it("has no top-level comment trailing the jobs block", () => {
    // `# Trigger staging deployment after CDK trust fix` was the last line of
    // the CDK template, at column zero, after the final job's `with:` block —
    // so it scoped to nothing and read as documentation of a deploy step the
    // file did not have. A commit-message-shaped line written to force a re-run
    // and never removed. Every consumer received it, because Lisa shipped it.
    const dangling = shippedWorkflows().filter(relative => {
      const lines = readFileSync(path.join(ROOT, relative), "utf8")
        .split("\n")
        .filter(line => line.trim().length > 0);
      const last = lines[lines.length - 1] ?? "";
      return last.startsWith("#");
    });
    expect(dangling).toEqual([]);
  });
});
