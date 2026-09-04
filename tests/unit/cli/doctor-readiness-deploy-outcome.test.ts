/**
 * The readiness half of #3740: report a deploy job that goes silent when its
 * release fails, without standing up a ship blocker.
 *
 * Two assertions here carry the design decisions the ticket demanded be made
 * explicitly rather than by default, and both would pass silently if made
 * wrongly:
 *
 * 1. **The finding must carry NO `blocker` key.** The blocker engine stands a
 *    blocker up on any finding that names an id and carries evidence,
 *    regardless of the finding's status — so a finding that named one would
 *    flip an otherwise healthy repository to NOT_READY. #3740 required a
 *    deliberate choice among "which existing blocker", "non-blocking", and
 *    "open the closed set"; this is the non-blocking one, asserted so it cannot
 *    drift into a blocker by accident.
 * 2. **The finding must reach the PASS record too.** A repository whose release
 *    paths are clean is exactly the repository where this observation would
 *    otherwise be dropped, and dropping a finding on the healthy path is how a
 *    check ends up reporting nothing in the case it was written for.
 * @module tests/unit/cli/doctor-readiness-deploy-outcome
 */
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { assessDeliveryAuthorityDimension } from "../../../src/cli/doctor-readiness-delivery.js";
import { deployOutcomeObservations } from "../../../src/cli/doctor-readiness-deploy-outcome.js";
import { parseRepositoryWorkflows } from "../../../src/cli/doctor-readiness-workflows.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** A deploy workflow whose deploy job skips when the release fails. */
const SKIPPING = [
  "name: Deploy",
  "on:",
  "  push:",
  "    branches: [main]",
  "jobs:",
  "  release:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: Cut the release",
  "        run: npm publish",
  "  deploy:",
  "    name: Deploy",
  "    needs: [release]",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: Ship it",
  "        run: echo deploying",
  "",
].join("\n");

/** The same workflow with #3738's fix applied. */
const GUARDED = SKIPPING.replace(
  "    runs-on: ubuntu-latest\n    steps:\n      - name: Ship it",
  "    if: ${{ !cancelled() }}\n    runs-on: ubuntu-latest\n    steps:\n      - name: Ship it"
);

/** The repo-relative workflow path every case seeds. */
const WORKFLOW = [".github", "workflows", "deploy.yml"] as const;

describe("deploy-outcome readiness reporting (#3740)", () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await mkdir(path.join(projectDir, WORKFLOW[0], WORKFLOW[1]), {
      recursive: true,
    });
    return async (): Promise<void> => {
      await cleanupTempDir(tempDir);
    };
  });

  /**
   * Seed one workflow and assess the delivery/authority dimension.
   * @param source - Workflow source
   * @returns The dimension record
   */
  async function assess(
    source: string
  ): Promise<Awaited<ReturnType<typeof assessDeliveryAuthorityDimension>>> {
    await writeFile(path.join(projectDir, ...WORKFLOW), source);
    return assessDeliveryAuthorityDimension(projectDir);
  }

  /**
   * Every finding on a record, as loosely-typed records.
   * @param record - The dimension record
   * @returns The findings
   */
  function findings(
    record: Awaited<ReturnType<typeof assessDeliveryAuthorityDimension>>
  ): readonly Record<string, unknown>[] {
    return (record.findings ?? []) as readonly Record<string, unknown>[];
  }

  it("names the workflow file and the job", async () => {
    await writeFile(path.join(projectDir, ...WORKFLOW), SKIPPING);
    const observations = deployOutcomeObservations(
      await parseRepositoryWorkflows(projectDir)
    );

    expect(observations).toHaveLength(1);
    expect(observations[0]).toContain(".github/workflows/deploy.yml");
    expect(observations[0]).toContain("`deploy`");
    expect(observations[0]).toContain("`release`");
  });

  it("prints a remediation someone who is not an engineer can act on", async () => {
    await writeFile(path.join(projectDir, ...WORKFLOW), SKIPPING);
    const [observation = ""] = deployOutcomeObservations(
      await parseRepositoryWorkflows(projectDir)
    );

    expect(observation).toContain("the run still looks green");
    expect(observation).toContain("nobody is told");
    expect(observation).toContain("!cancelled()");
  });

  it("raises no finding once the job survives a failed release", async () => {
    await writeFile(path.join(projectDir, ...WORKFLOW), GUARDED);

    expect(
      deployOutcomeObservations(await parseRepositoryWorkflows(projectDir))
    ).toEqual([]);
  });

  it("carries the observation into the dimension record", async () => {
    const observations = findings(await assess(SKIPPING)).filter(finding =>
      String(finding.observation ?? "").includes("skipped rather than failed")
    );

    expect(observations).toHaveLength(1);
  });

  it("stands up no ship blocker — the finding names none", async () => {
    const record = await assess(SKIPPING);

    const carrying = findings(record).filter(finding =>
      String(finding.observation ?? "").includes("skipped rather than failed")
    );

    expect(carrying).toHaveLength(1);
    expect(carrying[0]).not.toHaveProperty("blocker");
    expect(carrying[0]?.blocking).toBe(false);
  });

  it("does not flip the dimension's status on its own", async () => {
    const withDefect = await assess(SKIPPING);
    const withoutDefect = await assess(GUARDED);

    expect(withDefect.status).toBe(withoutDefect.status);
  });
});
