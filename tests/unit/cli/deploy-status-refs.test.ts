import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractWorkItemRefs,
  type RefExtractionDeps,
} from "../../../src/cli/deploy-status-refs.js";
import { cleanGitEnv } from "../../helpers/test-utils.js";

const REPOSITORY = "acme/app";
const MERGED_AT = "2026-07-01T00:00:00Z";
const REF_101 = "acme/app#101";
const REF_102 = "acme/app#102";
const REF_103 = "acme/app#103";

/**
 * Run a command in the fixture repo with a hook-sanitized environment.
 * @param cwd - Fixture repo path
 * @param command - Executable name
 * @param args - Argv after the executable
 * @returns Trimmed stdout
 */
function run(
  cwd: string,
  command: string,
  args: readonly string[]
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { cwd, env: cleanGitEnv(process.env), encoding: "utf8" },
      (error, stdout) => {
        if (error !== null) reject(error);
        else resolve(stdout.trim());
      }
    );
  });
}

/**
 * Build extraction deps backed by real git and a scripted gh.
 * @param cwd - Fixture repo path
 * @param ghResponses - Response payload per gh invocation (queue order)
 * @param ghCalls - Sink recording gh argv
 * @returns Injectable deps
 */
function fixtureDeps(
  cwd: string,
  ghResponses: readonly string[],
  ghCalls: string[][]
): RefExtractionDeps {
  const queue = [...ghResponses];
  return {
    execGit: args => run(cwd, "git", args),
    execGh: args => {
      ghCalls.push([...args]);
      return Promise.resolve(queue.shift() ?? "[]");
    },
  };
}

/**
 * Create an empty commit with the given message in the fixture repo.
 * @param repo - Fixture repo path
 * @param message - Full commit message
 */
async function commitEmpty(repo: string, message: string): Promise<void> {
  await run(repo, "git", ["commit", "--allow-empty", "-m", message]);
}

describe("extractWorkItemRefs", () => {
  let repo: string;
  let baseSha: string;
  let headSha: string;

  beforeEach(async () => {
    repo = await mkdtemp(path.join(os.tmpdir(), "lisa-dss-refs-"));
    await run(repo, "git", ["init", "--initial-branch=main"]);
    await run(repo, "git", ["config", "user.email", "test@example.com"]);
    await run(repo, "git", ["config", "user.name", "Test"]);
    await commitEmpty(repo, "chore: baseline");
    baseSha = await run(repo, "git", ["rev-parse", "HEAD"]);
    await commitEmpty(repo, `feat: first\n\nWork-Item: ${REF_101}`);
    await commitEmpty(repo, `feat: second\n\nWork-Item: ${REF_102}`);
    headSha = await run(repo, "git", ["rev-parse", "HEAD"]);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("unions trailers with merged-PR body refs, deduped (AC 1)", async () => {
    const ghCalls: string[][] = [];
    const pr = JSON.stringify([
      {
        number: 7,
        merged_at: MERGED_AT,
        body: "Summary\n\nCloses #102\nRefs #103\n",
      },
    ]);
    const deps = fixtureDeps(repo, [pr, pr], ghCalls);
    const result = await extractWorkItemRefs(
      {
        range: `${baseSha}..${headSha}`,
        tracker: "github",
        repository: REPOSITORY,
        cwd: repo,
      },
      deps
    );
    expect(result.refs).toEqual([REF_101, REF_102, REF_103]);
    expect(result.headSha).toBe(headSha);
    expect(ghCalls[0]?.[0]).toBe("api");
    expect(ghCalls[0]?.[1]).toMatch(/^repos\/acme\/app\/commits\/.+\/pulls$/);
  });

  it("skips out-of-repo refs with a reason instead of erroring", async () => {
    const pr = JSON.stringify([
      {
        number: 8,
        merged_at: MERGED_AT,
        body: "Refs other/repo#9\nRefs #103",
      },
    ]);
    const result = await extractWorkItemRefs(
      {
        range: `${baseSha}..${headSha}`,
        tracker: "github",
        repository: REPOSITORY,
        cwd: repo,
      },
      fixtureDeps(repo, [pr, pr], [])
    );
    expect(result.refs).toContain(REF_103);
    expect(result.refs).not.toContain("other/repo#9");
    expect(result.skipped.some(entry => entry.token === "other/repo#9")).toBe(
      true
    );
  });

  it("ignores unmerged pull requests", async () => {
    const pr = JSON.stringify([
      { number: 9, merged_at: null, body: "Closes #500" },
    ]);
    const result = await extractWorkItemRefs(
      {
        range: `${baseSha}..${headSha}`,
        tracker: "github",
        repository: REPOSITORY,
        cwd: repo,
      },
      fixtureDeps(repo, [pr, pr], [])
    );
    expect(result.refs).toEqual([REF_101, REF_102]);
  });

  it("canonicalizes KEY-N refs for jira and skips foreign tokens", async () => {
    await commitEmpty(repo, "feat: jira\n\nWork-Item: PROJ-5");
    const newHead = await run(repo, "git", ["rev-parse", "HEAD"]);
    const pr = JSON.stringify([
      {
        number: 10,
        merged_at: MERGED_AT,
        body: "Refs PROJ-6\nRefs OTHER-7\nRefs #103",
      },
    ]);
    const result = await extractWorkItemRefs(
      {
        range: `${baseSha}..${newHead}`,
        tracker: "jira",
        repository: REPOSITORY,
        projectKey: "PROJ",
        cwd: repo,
      },
      fixtureDeps(repo, [pr, pr, pr], [])
    );
    expect(result.refs).toEqual(["PROJ-5", "PROJ-6"]);
    expect(result.skipped.map(entry => entry.token)).toEqual(
      expect.arrayContaining([REF_101, "OTHER-7", "#103"])
    );
  });

  it("extracts trailers without PR lookups when no repository is configured", async () => {
    const ghCalls: string[][] = [];
    const result = await extractWorkItemRefs(
      { range: `${baseSha}..${headSha}`, tracker: "github", cwd: repo },
      fixtureDeps(repo, [], ghCalls)
    );
    expect(result.refs).toEqual([]);
    expect(result.skipped).toHaveLength(2);
    expect(ghCalls).toHaveLength(0);
  });
});
