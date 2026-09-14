/**
 * Coverage produced by either unit-test path must reach the scan workspace.
 * Exercises the workflow's real conditions and artifact-name command; hosted
 * CI supplies the actual upload/download proof.
 * @module tests/unit/config/sonar-coverage-handoff
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import yaml from "js-yaml";
import { afterEach, describe, expect, it } from "vitest";

import { githubCondition } from "../../helpers/github-expression.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** Workflow step fields used by the handoff. */
interface Step {
  readonly id?: string;
  readonly name?: string;
  readonly if?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly with?: Record<string, unknown>;
  readonly "working-directory"?: string;
  readonly "continue-on-error"?: unknown;
}

/** Workflow job fields used by the handoff. */
interface Job {
  readonly steps: readonly Step[];
  readonly needs?: readonly string[];
  readonly outputs?: Record<string, string>;
}

const workflow = yaml.load(
  readFileSync(
    path.resolve(import.meta.dirname, "../../../.github/workflows/quality.yml"),
    "utf8"
  )
) as { readonly jobs: Record<string, Job> };
const temporaryDirectories: string[] = [];
const PROJECT_DIRECTORY = "${{ inputs.working_directory || '.' }}";

afterEach(() => {
  temporaryDirectories
    .splice(0)
    .forEach(directory => rmSync(directory, { recursive: true, force: true }));
});

/**
 * Find the actual step, refusing missing workflow wiring.
 * @param job - Job identifier.
 * @param id - Step identifier.
 * @returns The shipped step.
 */
function step(job: string, id: string): Step {
  const found = workflow.jobs[job]?.steps.find(
    candidate => candidate.id === id
  );
  if (!found) throw new Error(`Missing ${job}.${id}`);
  return found;
}

describe("Sonar coverage artifact handoff", () => {
  it.each([
    ["success", "skipped", true],
    ["failure", "skipped", true],
    ["skipped", "success", true],
    ["skipped", "failure", true],
    ["skipped", "skipped", false],
  ])(
    "produces coverage when declared=%s and fallback=%s",
    (declared, fallback, expected) => {
      expect(
        githubCondition(step("test_unit", "coverage_name").if ?? "", {
          steps: {
            gate_run: { outcome: declared },
            test_coverage: { outcome: fallback },
          },
        })
      ).toBe(expected);
    }
  );

  it("does not upload when canceled or when no producer ran", () => {
    const upload = step("test_unit", "coverage_artifact");
    const present = {
      steps: { coverage_name: { outputs: { name: "coverage-run" } } },
    };
    expect(githubCondition(upload.if ?? "", present)).toBe(true);
    expect(githubCondition(upload.if ?? "", present, true)).toBe(false);
    expect(
      githubCondition(upload.if ?? "", {
        steps: { coverage_name: { outputs: {} } },
      })
    ).toBe(false);
    expect(upload.with?.["if-no-files-found"]).toBe("ignore");
    expect(upload.uses).toMatch(/^actions\/upload-artifact@/u);
    expect(upload.with?.name).toBe("${{ steps.coverage_name.outputs.name }}");
  });

  it("gives repeated reusable-workflow invocations distinct artifact names", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "lisa-coverage-name-"));
    temporaryDirectories.push(directory);
    const output = path.join(directory, "output");
    const command = step("test_unit", "coverage_name").run ?? "";
    for (const iteration of [1, 2]) {
      const result = boundedSpawnSync({
        command: "bash",
        args: ["-c", command],
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          GITHUB_OUTPUT: output,
          BASH_ENV: "/dev/null",
          ENV: "/dev/null",
        },
        label: `coverage artifact name ${iteration}`,
      });
      expect(result.status).toBe(0);
    }
    const names = readFileSync(output, "utf8").trim().split("\n");
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(names.every(name => /^name=coverage-[a-f0-9-]+$/u.test(name))).toBe(
      true
    );
  });

  it("downloads only an artifact the producer actually uploaded", () => {
    const download = step("sonarcloud", "coverage_download");
    for (const [artifactId, expected] of [
      ["1234", true],
      ["", false],
    ] as const) {
      const context = {
        needs: { test_unit: { outputs: { coverage_artifact_id: artifactId } } },
      };
      expect(githubCondition(download.if ?? "", context)).toBe(expected);
      expect(githubCondition(download.if ?? "", context, true)).toBe(false);
    }
    expect(workflow.jobs.test_unit?.outputs?.coverage_artifact_id).toBe(
      "${{ steps.coverage_artifact.outputs.artifact-id }}"
    );
    expect(download.with?.["artifact-ids"]).toBe(
      "${{ needs.test_unit.outputs.coverage_artifact_id }}"
    );
    expect(download["continue-on-error"]).toBeUndefined();
    expect(download.uses).toMatch(/^actions\/download-artifact@/u);
  });

  it("keeps coverage and scan paths relative to the same project directory", () => {
    const upload = step("test_unit", "coverage_artifact");
    const download = step("sonarcloud", "coverage_download");
    expect(upload.with?.path).toBe(`${PROJECT_DIRECTORY}/coverage`);
    expect(download.with?.path).toBe(upload.with?.path);
    expect(step("sonarcloud", "sonar_scan").with?.projectBaseDir).toBe(
      PROJECT_DIRECTORY
    );
    expect(
      workflow.jobs.sonarcloud?.steps.find(
        candidate => candidate.name === "🔍 Validate SonarCloud results"
      )?.["working-directory"]
    ).toBe(PROJECT_DIRECTORY);
  });

  it("waits for the producer and downloads before either scan path", () => {
    const job = workflow.jobs.sonarcloud;
    const steps = job?.steps ?? [];
    expect(job?.needs).toContain("test_unit");
    const downloaded = steps.indexOf(step("sonarcloud", "coverage_download"));
    expect(downloaded).toBeLessThan(
      steps.indexOf(step("sonarcloud", "gate_run"))
    );
    expect(downloaded).toBeLessThan(
      steps.indexOf(step("sonarcloud", "sonar_scan"))
    );
    const produced = workflow.jobs.test_unit?.steps ?? [];
    expect(
      produced.indexOf(step("test_unit", "coverage_name"))
    ).toBeGreaterThan(produced.indexOf(step("test_unit", "test_coverage")));
  });
});
