import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { boundedExecFileSync } from "../helpers/io-latency-budget.js";
import { describe, expect, it } from "vitest";

import { loadWorkflow } from "./support/maestro-android-retry-harness.js";

const job = {
  status: "in_progress",
  runner_name: "fixture-runner",
  started_at: "2026-01-01T00:00:00Z",
};

/**
 * Execute the real deadline step with an isolated GitHub API fixture.
 * @param platform - Native platform under test.
 * @param jobs - Jobs returned by the synthetic current-attempt API.
 * @param reject - Simulate an API access refusal.
 * @returns Exported environment, warnings and the recorded API invocation.
 */
async function discover(
  platform: "android" | "ios",
  jobs = [job],
  reject = false
) {
  const workflow = await loadWorkflow();
  const step = workflow.jobs[platform]?.steps?.find(candidate =>
    candidate.name?.includes("retry deadline")
  );
  const script = step?.with?.script;
  if (typeof script !== "string") throw new Error("Missing deadline step");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "maestro-deadline-"));
  try {
    const fixture = path.join(dir, "fixture.json");
    const driver = path.join(dir, "deadline.mjs");
    await fs.writeJson(fixture, { jobs, reject });
    await fs.writeFile(
      driver,
      `
import { readFileSync } from "node:fs";
const { jobs, reject } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const exported = {}, warnings = [], calls = [];
const github = { paginate: async (...args) => {
  calls.push(args);
  if (reject) throw new Error("synthetic API refusal");
  return jobs;
}};
const context = { repo: { owner: "fixture", repo: "app" }, runId: 123 };
const core = { warning: message => warnings.push(message),
  exportVariable: (key, value) => { exported[key] = value; } };
await (async () => {
${script}
})();
console.log(JSON.stringify({ exported, warnings, calls }));
`
    );
    return JSON.parse(
      boundedExecFileSync({
        label: "actual retry deadline workflow step",
        command: process.execPath,
        args: [driver, fixture],
        cwd: dir,
        env: {
          RUNNER_NAME: "fixture-runner",
          GITHUB_RUN_ATTEMPT: "2",
          SUITE_TIMEOUT_MINUTES: "90",
        },
      })
    ) as {
      exported: Record<string, string>;
      warnings: string[];
      calls: unknown[][];
    };
  } finally {
    await fs.remove(dir);
  }
}

describe.each(["android", "ios"] as const)(
  "%s job deadline discovery",
  platform => {
    it("uses the current job start and current run attempt, including setup time", async () => {
      const result = await discover(platform, [
        {
          ...job,
          runner_name: "other-runner",
          started_at: "2026-01-01T01:00:00Z",
        },
        job,
        { ...job, status: "completed" },
      ]);
      expect(result.exported.LISA_MAESTRO_SUITE_DEADLINE).toBe("1767231000");
      expect(result.calls).toEqual([
        [
          "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs",
          expect.objectContaining({ run_id: 123, attempt_number: 2 }),
        ],
      ]);
      expect(result.warnings).toHaveLength(0);
    });

    it.each([
      { jobs: [] },
      { jobs: [job, job] },
      { jobs: [{ ...job, started_at: "not-a-date" }] },
    ])(
      "declines optional retries when the current job cannot be established: %j",
      async ({ jobs }) => {
        const result = await discover(platform, jobs);
        expect(result.exported.LISA_MAESTRO_SUITE_DEADLINE).toBe("");
        expect(result.warnings).toHaveLength(1);
      }
    );

    it("retains the suite path when the jobs API refuses access", async () => {
      const result = await discover(platform, [], true);
      expect(result.exported.LISA_MAESTRO_SUITE_DEADLINE).toBe("");
      expect(result.warnings).toHaveLength(1);
    });
  }
);
