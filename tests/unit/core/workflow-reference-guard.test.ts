import * as fs from "fs-extra";
import * as path from "node:path";
import { findLocalWorkflowReferences } from "../../../src/core/workflow-reference-guard.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const WORKFLOWS = path.join(".github", "workflows");
const BUILD_YML = ".github/workflows/build.yml";
const LIGHTHOUSE_YML = ".github/workflows/lighthouse.yml";
const DEPLOY_YML = ".github/workflows/deploy.yml";
const CI_YML = ".github/workflows/ci.yml";
const DEPLOY_FILE = "deploy.yml";
const BUILD_FILE = "build.yml";

/** A `jobs:` block whose single job calls build.yml as a local reusable. */
const CALLS_BUILD = ["jobs:", "  build:", `    uses: ./${BUILD_YML}`, ""].join(
  "\n"
);

/** A minimal reusable-workflow definition body. */
const WORKFLOW_CALL_BODY = "on:\n  workflow_call:\n";

describe("findLocalWorkflowReferences", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await createTempDir();
    await fs.ensureDir(path.join(projectDir, WORKFLOWS));
  });

  afterEach(async () => {
    await cleanupTempDir(projectDir);
  });

  /**
   * Write a workflow file into the project's workflow directory
   * @param name - Workflow file name (e.g., "deploy.yml")
   * @param content - Raw YAML text
   */
  async function writeWorkflow(name: string, content: string): Promise<void> {
    await fs.writeFile(path.join(projectDir, WORKFLOWS, name), content);
  }

  it("names the workflow that calls the deletion target as a local reusable", async () => {
    await writeWorkflow(DEPLOY_FILE, CALLS_BUILD);
    await writeWorkflow(BUILD_FILE, WORKFLOW_CALL_BODY);

    expect(await findLocalWorkflowReferences(projectDir, BUILD_YML)).toEqual([
      DEPLOY_YML,
    ]);
  });

  it("returns no references for an orphaned workflow", async () => {
    await writeWorkflow(DEPLOY_FILE, CALLS_BUILD);
    await writeWorkflow("lighthouse.yml", WORKFLOW_CALL_BODY);

    expect(
      await findLocalWorkflowReferences(projectDir, LIGHTHOUSE_YML)
    ).toEqual([]);
  });

  it("ignores a remote @ref call to the same file name", async () => {
    // The migrated form of the very call this guard protects: same file name,
    // resolved from the upstream repo instead of the consumer's own tree.
    await writeWorkflow(
      DEPLOY_FILE,
      [
        "jobs:",
        "  build:",
        `    uses: CodySwannGT/lisa/${BUILD_YML}@main`,
        "",
      ].join("\n")
    );

    expect(await findLocalWorkflowReferences(projectDir, BUILD_YML)).toEqual(
      []
    );
  });

  it("matches a quoted uses value written as a list item", async () => {
    await writeWorkflow(
      DEPLOY_FILE,
      ["steps:", `  - uses: "./${BUILD_YML}"`, ""].join("\n")
    );

    expect(await findLocalWorkflowReferences(projectDir, BUILD_YML)).toEqual([
      DEPLOY_YML,
    ]);
  });

  it("does not treat a workflow's reference to itself as a caller", async () => {
    await writeWorkflow(BUILD_FILE, CALLS_BUILD);

    expect(await findLocalWorkflowReferences(projectDir, BUILD_YML)).toEqual(
      []
    );
  });

  it("reports every caller, sorted, when more than one references the target", async () => {
    await writeWorkflow(DEPLOY_FILE, CALLS_BUILD);
    await writeWorkflow("ci.yml", CALLS_BUILD);

    expect(await findLocalWorkflowReferences(projectDir, BUILD_YML)).toEqual([
      CI_YML,
      DEPLOY_YML,
    ]);
  });

  it("treats a directory deletion as covering the composite action inside it", async () => {
    await writeWorkflow(
      "ci.yml",
      ["steps:", "  - uses: ./.github/actions/setup", ""].join("\n")
    );

    expect(
      await findLocalWorkflowReferences(projectDir, ".github/actions")
    ).toEqual([CI_YML]);
  });

  it("returns no references when the project has no workflow directory", async () => {
    await fs.remove(path.join(projectDir, WORKFLOWS));

    expect(await findLocalWorkflowReferences(projectDir, BUILD_YML)).toEqual(
      []
    );
  });
});
