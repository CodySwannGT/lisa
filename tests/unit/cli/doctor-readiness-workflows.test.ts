/**
 * Unit coverage for the offline GitHub-workflow parser used by the readiness
 * producers (PRD #1739, #1896).
 *
 * The delivery/authority producers must reason about what the repository's CI
 * actually does — which job publishes, what it depends on, which credentials it
 * carries — without any network call. This suite pins that contract: every
 * `.github/workflows/*.yml` file is read and parsed offline, each job exposes
 * its `needs`, `steps[].run`/`uses`, `permissions`, `secrets`, and
 * `environment`, a repository with no workflows directory yields an empty list
 * rather than throwing, and an unparseable file is skipped rather than aborting
 * the whole readiness run.
 * @module tests/unit/cli/doctor-readiness-workflows
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { parseRepositoryWorkflows } from "../../../src/cli/doctor-readiness-workflows.js";
import {
  CI_YML,
  DEPLOY_NAME,
  JOBS,
  makeScratchRepo,
  ON,
  ON_PUSH,
  PUSH,
  RELEASE_NAME,
  RELEASE_YML,
  RUNS_ON,
  RUN_PUBLISH,
  RUN_TEST,
  STEPS,
  TAGS,
  TEST_JOB,
  USES_DOWNLOAD,
  writeWorkflow,
} from "../../helpers/readiness-workflow-fixtures.js";

/** A no-op step reused by fixtures that only exercise workflow metadata. */
const RUN_ECHO = "      - run: echo hi";

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one parser test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("workflows");
  return tempDir;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("parseRepositoryWorkflows", () => {
  it("returns an empty list when the repository has no workflows directory", async () => {
    const cwd = await getTempDir();

    expect(await parseRepositoryWorkflows(cwd)).toEqual([]);
  });

  it("exposes each job's needs, steps, permissions, secrets, and environment", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, RELEASE_YML, [
      RELEASE_NAME,
      ON,
      PUSH,
      "    branches: [main]",
      "permissions:",
      "  contents: read",
      JOBS,
      TEST_JOB,
      RUNS_ON,
      STEPS,
      RUN_TEST,
      "  publish:",
      "    needs: [test]",
      "    environment: production",
      "    permissions:",
      "      contents: write",
      "      id-token: write",
      "    secrets: inherit",
      STEPS,
      USES_DOWNLOAD,
      RUN_PUBLISH,
    ]);

    const workflows = await parseRepositoryWorkflows(cwd);

    expect(workflows).toHaveLength(1);
    const workflow = workflows[0];
    expect(workflow.file).toBe(".github/workflows/release.yml");
    expect(workflow.name).toBe("Release");
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.map(job => job.id)).toEqual(["test", "publish"]);

    const test = workflow.jobs[0];
    expect(test.needs).toEqual([]);
    expect(test.steps).toEqual([
      { ifCondition: "", inputs: "", name: "", run: "npm run test", uses: "" },
    ]);

    const publish = workflow.jobs[1];
    expect(publish.needs).toEqual(["test"]);
    expect(publish.environment).toEqual(["production"]);
    expect(publish.permissions).toEqual({
      contents: "write",
      "id-token": "write",
    });
    expect(publish.secrets).toBe("inherit");
    expect(publish.steps).toEqual([
      {
        ifCondition: "",
        inputs: "",
        name: "",
        run: "",
        uses: "actions/download-artifact@v4",
      },
      {
        ifCondition: "",
        inputs: "",
        name: "",
        run: "npm publish --provenance",
        uses: "",
      },
    ]);
    expect(publish.workflow).toBe(".github/workflows/release.yml");
  });

  it("normalizes a scalar needs value and a reusable-workflow job", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, CI_YML, [
      "name: CI",
      ON_PUSH,
      JOBS,
      "  quality:",
      "    uses: ./.github/workflows/quality.yml",
      "  gate:",
      "    needs: quality",
      "    permissions: write-all",
      STEPS,
      "      - run: echo done",
    ]);

    const workflows = await parseRepositoryWorkflows(cwd);

    expect(workflows[0].jobs[0].uses).toBe("./.github/workflows/quality.yml");
    expect(workflows[0].jobs[1].needs).toEqual(["quality"]);
    expect(workflows[0].jobs[1].permissions).toBe("write-all");
  });

  it("captures the `if:` condition on a job and on a step (#1896)", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, CI_YML, [
      "name: CI",
      ON_PUSH,
      JOBS,
      "  gated:",
      "    if: github.ref == 'refs/heads/main'",
      STEPS,
      "      - if: ${{ inputs.confirm == 'yes' }}",
      "        run: echo done",
      "      - run: echo always",
    ]);

    const workflows = await parseRepositoryWorkflows(cwd);

    // The B1/B4 producers read these to tell a deliberately gated operation
    // from an unattended one, so an absent block must be `""`, never undefined.
    const job = workflows[0].jobs[0];
    expect(job.ifCondition).toBe("github.ref == 'refs/heads/main'");
    expect(job.steps[0].ifCondition).toBe("${{ inputs.confirm == 'yes' }}");
    expect(job.steps[1].ifCondition).toBe("");
  });

  it("captures the trigger block, including push branches and tags", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, "tagged.yml", [
      "name: Tagged",
      ON,
      PUSH,
      TAGS,
      "  workflow_dispatch:",
      JOBS,
      "  noop:",
      STEPS,
      RUN_ECHO,
    ]);
    await writeWorkflow(cwd, "called.yml", [
      "name: Called",
      ON,
      "  workflow_call:",
      "    inputs: {}",
      JOBS,
      "  noop:",
      STEPS,
      RUN_ECHO,
    ]);

    const [called, tagged] = await parseRepositoryWorkflows(cwd);

    expect(called.on.events).toEqual(["workflow_call"]);
    expect(called.on.pushBranches).toEqual([]);
    expect(tagged.on.events).toEqual(["push", "workflow_dispatch"]);
    expect(tagged.on.pushTags).toEqual(["v*"]);
    expect(tagged.on.pushBranches).toEqual([]);
  });

  it("normalizes a scalar and list trigger into the same shape", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, "scalar.yml", [
      "name: Scalar",
      "on: push",
      JOBS,
      "  a:",
      STEPS,
      RUN_ECHO,
    ]);

    const [workflow] = await parseRepositoryWorkflows(cwd);

    expect(workflow.on.events).toEqual(["push"]);
    expect(workflow.on.pushBranches).toEqual([]);
    expect(workflow.on.pushTags).toEqual([]);
  });

  it("reads .yaml files and skips a file that cannot be parsed", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, "deploy.yaml", [
      DEPLOY_NAME,
      ON_PUSH,
      JOBS,
      "  ship:",
      STEPS,
      "      - run: cdk deploy",
    ]);
    await writeWorkflow(cwd, "broken.yml", [JOBS, "  a: [", "   unclosed"]);
    await writeWorkflow(cwd, "notes.md", ["not a workflow"]);

    const workflows = await parseRepositoryWorkflows(cwd);

    expect(workflows.map(workflow => workflow.file)).toEqual([
      ".github/workflows/deploy.yaml",
    ]);
    expect(workflows[0].jobs[0].steps[0].run).toBe("cdk deploy");
  });
});
