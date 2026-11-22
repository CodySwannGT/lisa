/**
 * Tests for parsing the quality inputs a project's `ci.yml` forwards.
 * @module tests/unit/cli/ci-workflow-inputs
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseCiWorkflowInputs,
  type CiWorkflowInputs,
} from "../../../src/cli/ci-workflow-inputs.js";

/** Per-test temp directory. */
interface Resources {
  dir: string;
}

const resources: Resources = { dir: "" };

beforeEach(async () => {
  resources.dir = await mkdtemp(
    path.join(tmpdir(), "lisa-ci-workflow-inputs-")
  );
});

afterEach(async () => {
  await rm(resources.dir, { recursive: true, force: true });
});

/**
 * Write a minimal calling `ci.yml` that forwards quality inputs.
 * @param withBlock - YAML fragment for the quality job `with:` map
 */
async function writeCiYml(withBlock: string): Promise<void> {
  const workflows = path.join(resources.dir, ".github", "workflows");
  await mkdir(workflows, { recursive: true });
  await writeFile(
    path.join(workflows, "ci.yml"),
    [
      "name: CI",
      "on: pull_request",
      "jobs:",
      "  quality:",
      "    uses: ./.github/workflows/quality.yml",
      "    with:",
      withBlock,
      "    secrets: inherit",
      "",
    ].join("\n"),
    "utf8"
  );
}

describe("parseCiWorkflowInputs", () => {
  it("reads skip_jobs and gate inputs from the quality caller with-block", async () => {
    await writeCiYml(
      [
        "      skip_jobs: 'snyk,sonarcloud'",
        // Still present in the fixture on purpose. `verify_enforced` was
        // retired in CodySwannGT/lisa#3021 but is still ACCEPTED by
        // quality.yml, so a real caller may carry it — and what this asserts
        // is that the parser does not carry it into the parsed inputs.
        "      verify_enforced: true",
        "      compliance_framework: soc2",
        "      require_approval: true",
      ].join("\n")
    );

    const inputs = await parseCiWorkflowInputs(resources.dir);

    expect(inputs).toEqual({
      skipJobs: ["snyk", "sonarcloud"],
      complianceFramework: "soc2",
      requireApproval: true,
    } satisfies CiWorkflowInputs);
  });

  it("returns empty skip list and defaults when with-block omits optional keys", async () => {
    await writeCiYml("      skip_jobs: ''\n");

    const inputs = await parseCiWorkflowInputs(resources.dir);

    expect(inputs.skipJobs).toEqual([]);
    expect(inputs.complianceFramework).toBe("none");
    expect(inputs.requireApproval).toBe(false);
  });
});
