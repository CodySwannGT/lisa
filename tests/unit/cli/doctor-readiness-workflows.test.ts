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
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseRepositoryWorkflows } from "../../../src/cli/doctor-readiness-workflows.js";

/** A no-op step reused by fixtures that only exercise workflow metadata. */
const RUN_ECHO = "      - run: echo hi";

let tempDir: string | undefined;

/**
 * Resolve a temporary directory for one parser test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await mkdtemp(
    path.join(os.tmpdir(), "lisa-readiness-workflows-")
  );
  return tempDir;
}

/**
 * Write one workflow file into the scratch repository.
 * @param root - Repository root
 * @param fileName - Workflow file name, e.g. `release.yml`
 * @param body - Raw YAML body
 */
async function writeWorkflow(
  root: string,
  fileName: string,
  body: string
): Promise<void> {
  const dir = path.join(root, ".github", "workflows");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), body, "utf8");
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
    await writeWorkflow(
      cwd,
      "release.yml",
      [
        "name: Release",
        "on:",
        "  push:",
        "    branches: [main]",
        "permissions:",
        "  contents: read",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: npm run test",
        "  publish:",
        "    needs: [test]",
        "    environment: production",
        "    permissions:",
        "      contents: write",
        "      id-token: write",
        "    secrets: inherit",
        "    steps:",
        "      - uses: actions/download-artifact@v4",
        "      - run: npm publish --provenance",
        "",
      ].join("\n")
    );

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
      { inputs: "", name: "", run: "npm run test", uses: "" },
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
      { inputs: "", name: "", run: "", uses: "actions/download-artifact@v4" },
      { inputs: "", name: "", run: "npm publish --provenance", uses: "" },
    ]);
    expect(publish.workflow).toBe(".github/workflows/release.yml");
  });

  it("normalizes a scalar needs value and a reusable-workflow job", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(
      cwd,
      "ci.yml",
      [
        "name: CI",
        "on: [push]",
        "jobs:",
        "  quality:",
        "    uses: ./.github/workflows/quality.yml",
        "  gate:",
        "    needs: quality",
        "    permissions: write-all",
        "    steps:",
        "      - run: echo done",
        "",
      ].join("\n")
    );

    const workflows = await parseRepositoryWorkflows(cwd);

    expect(workflows[0].jobs[0].uses).toBe("./.github/workflows/quality.yml");
    expect(workflows[0].jobs[1].needs).toEqual(["quality"]);
    expect(workflows[0].jobs[1].permissions).toBe("write-all");
  });

  it("captures the trigger block, including push branches and tags", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(
      cwd,
      "tagged.yml",
      [
        "name: Tagged",
        "on:",
        "  push:",
        "    tags: ['v*']",
        "  workflow_dispatch:",
        "jobs:",
        "  noop:",
        "    steps:",
        RUN_ECHO,
        "",
      ].join("\n")
    );
    await writeWorkflow(
      cwd,
      "called.yml",
      [
        "name: Called",
        "on:",
        "  workflow_call:",
        "    inputs: {}",
        "jobs:",
        "  noop:",
        "    steps:",
        RUN_ECHO,
        "",
      ].join("\n")
    );

    const [called, tagged] = await parseRepositoryWorkflows(cwd);

    expect(called.on.events).toEqual(["workflow_call"]);
    expect(called.on.pushBranches).toEqual([]);
    expect(tagged.on.events).toEqual(["push", "workflow_dispatch"]);
    expect(tagged.on.pushTags).toEqual(["v*"]);
    expect(tagged.on.pushBranches).toEqual([]);
  });

  it("normalizes a scalar and list trigger into the same shape", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(
      cwd,
      "scalar.yml",
      [
        "name: Scalar",
        "on: push",
        "jobs:",
        "  a:",
        "    steps:",
        RUN_ECHO,
        "",
      ].join("\n")
    );

    const [workflow] = await parseRepositoryWorkflows(cwd);

    expect(workflow.on.events).toEqual(["push"]);
    expect(workflow.on.pushBranches).toEqual([]);
    expect(workflow.on.pushTags).toEqual([]);
  });

  it("reads .yaml files and skips a file that cannot be parsed", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(
      cwd,
      "deploy.yaml",
      [
        "name: Deploy",
        "on: [push]",
        "jobs:",
        "  ship:",
        "    steps:",
        "      - run: cdk deploy",
        "",
      ].join("\n")
    );
    await writeWorkflow(cwd, "broken.yml", "jobs:\n  a: [\n   unclosed\n");
    await writeWorkflow(cwd, "notes.md", "not a workflow\n");

    const workflows = await parseRepositoryWorkflows(cwd);

    expect(workflows.map(workflow => workflow.file)).toEqual([
      ".github/workflows/deploy.yaml",
    ]);
    expect(workflows[0].jobs[0].steps[0].run).toBe("cdk deploy");
  });
});
