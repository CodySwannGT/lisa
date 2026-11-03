/**
 * Failed PR reads are unknown, never evidence that the commit has no PR (#4631).
 * These controls execute the real reader and CLI with journaled raw responses.
 * @module tests/integration/third-party-review-pull-read-cli
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import {
  HEAD,
  installControlledGitHub,
  OTHER_HEAD,
  PROVER,
  PULL,
  REPO,
  routesRead,
  ROUTES,
  runThirdPartyReviewCli,
} from "../helpers/third-party-review-cli-fixture.js";

useIoLatencyBudget();

const FAILED_READ = { __refuse__: "HTTP 502: simulated PR read failure" };

/**
 * Run the CLI with the repository inputs a local agent or CI supplies.
 * @param args - Explicit repository arguments
 * @param repository - GitHub Actions' repository environment value
 * @returns Actual process result and every attempted GitHub read
 */
function runWithRepository(args: readonly string[], repository?: string) {
  const folder = fs.mkdtempSync(path.join(tmpdir(), "review-repository-"));
  try {
    const github = installControlledGitHub(folder, { pulls: [] });
    const result = boundedSpawnSync({
      label: "the review prover's repository usage contract",
      command: process.execPath,
      args: [
        path.resolve(import.meta.dirname, "../..", PROVER),
        `--sha=${HEAD}`,
        `--root=${folder}`,
        "--json",
        ...args,
      ],
      cwd: folder,
      env: {
        ...process.env,
        PATH: `${github.bindir}${path.delimiter}${process.env.PATH ?? ""}`,
        GITHUB_REPOSITORY: repository,
      },
      baseMs: 30000,
    });
    return { ...result, calls: github.calls() };
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

describe("repository inputs before real GitHub reads (#4631)", () => {
  it.each([undefined, ""])(
    "requires --repo when GITHUB_REPOSITORY is %j",
    repository => {
      const run = runWithRepository([], repository);
      expect(run.status).toBe(2);
      expect(String(run.stderr)).toContain("--repo <owner>/<repo>");
      expect(String(run.stdout)).toBe("");
      expect(run.calls).toEqual([]);
    }
  );

  it("uses GITHUB_REPOSITORY when --repo is absent", () => {
    const run = runWithRepository([], REPO);
    expect(run.status).toBe(0);
    expect(JSON.parse(String(run.stdout)).outcome).toBe(
      "not-a-pull-request-head"
    );
    expect(run.calls.map(call => call.argv[1])).toEqual([ROUTES.pulls]);
  });

  it("prefers explicit --repo over GITHUB_REPOSITORY", () => {
    const run = runWithRepository(["--repo", REPO], "other/repository");
    expect(run.status).toBe(0);
    expect(run.calls.map(call => call.argv[1])).toEqual([ROUTES.pulls]);
  });

  it.each(["", "/code", "acme/", "acme/code/extra", "acme/ code"])(
    "rejects explicit repository %j without reading GitHub",
    repository => {
      const run = runWithRepository([`--repo=${repository}`], REPO);
      expect(run.status).toBe(2);
      expect(String(run.stderr)).toContain("--repo <owner>/<repo>");
      expect(run.calls).toEqual([]);
    }
  );
});

describe("real pull-request read acceptance (#4631)", () => {
  it.each([
    ["failed", FAILED_READ],
    ["malformed", { message: "a non-list response" }],
  ])("reports a %s read as unreadable and exits 1", (_name, pullResponse) => {
    const run = runThirdPartyReviewCli({ pullResponse }, process.env);
    expect(run.verdict.outcome).toBe("pull-requests-unreadable");
    expect(run.status).toBe(1);
    expect(routesRead(run)).toEqual([ROUTES.pulls]);
  });

  it.each([
    ["empty", []],
    [
      "nonmatching",
      [{ number: PULL, state: "open", head: { sha: OTHER_HEAD } }],
    ],
  ])("keeps a successful %s list as an exit-0 no-op", (_name, pulls) => {
    const run = runThirdPartyReviewCli({ pulls }, process.env);
    expect(run.verdict.outcome).toBe("not-a-pull-request-head");
    expect(run.status).toBe(0);
    expect(routesRead(run)).toEqual([ROUTES.pulls]);
  });

  it("decides without any follow-up read after an API failure", () => {
    const run = runThirdPartyReviewCli(
      { pullResponse: FAILED_READ },
      process.env
    );
    expect(run.verdict).toMatchObject({
      outcome: "pull-requests-unreadable",
      readings: [],
    });
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0]).toMatchObject({ allowed: true, refused: true });
    expect(routesRead(run)).not.toContain(ROUTES.status);
    expect(routesRead(run)).not.toContain(ROUTES.checkRuns);
    expect(routesRead(run)).not.toContain(ROUTES.comments);
  });
});
