/** CodeRabbit RED authority contract for the nightly tracking workflows. */
import yaml from "js-yaml";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  boundedExecFileSync,
  ChildFailure,
} from "../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../helpers/test-utils.js";
import { resolveGit } from "../support/git-executable.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const REUSABLE_REL = ".github/workflows/nightly-e2e-tracking.yml";
const CALLER_REL =
  "expo/create-only/.github/workflows/nightly-e2e-tracking.yml";
const GIT = resolveGit();

/** Relevant parsed shape of the tracking workflows. */
interface TrackingWorkflow {
  readonly jobs: Record<
    string,
    {
      readonly if?: string;
      readonly uses?: string;
      readonly steps?: readonly {
        readonly id?: string;
        readonly with?: { readonly script?: string };
      }[];
    }
  >;
}

/**
 * Read one repository-relative text file.
 * @param relative - Repository-relative path
 * @returns UTF-8 file contents
 */
function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/**
 * Parse one tracking workflow.
 * @param relative - Repository-relative workflow path
 * @returns Relevant workflow shape
 */
function workflow(relative: string): TrackingWorkflow {
  return yaml.load(read(relative)) as TrackingWorkflow;
}

/**
 * Decide whether cat-file proved this exact pinned commit is absent.
 * @param error - Failure returned by the bounded git child
 * @param commit - Exact forty-character commit
 * @returns Whether the failure is the expected missing-object diagnosis
 */
function isMissingCommit(error: unknown, commit: string): boolean {
  return (
    error instanceof ChildFailure &&
    error.exitCode === 128 &&
    error.stderr.trim() === `fatal: Not a valid object name ${commit}^{commit}`
  );
}

/**
 * Capture a cat-file failure without invoking the fetch fallback.
 * @param commit - Exact forty-character commit
 * @param cwd - Directory in which git should inspect the object database
 * @returns The bounded child failure
 */
function catFileFailure(commit: string, cwd: string): ChildFailure {
  try {
    boundedExecFileSync({
      label: "git reject unavailable pinned reusable",
      command: GIT,
      args: ["cat-file", "-e", `${commit}^{commit}`],
      cwd,
      env: cleanGitEnv(process.env),
    });
  } catch (error) {
    if (error instanceof ChildFailure) return error;
    throw error;
  }
  throw new Error("expected git cat-file to reject the unavailable commit");
}

/**
 * Read one file from an immutable local commit.
 * @param commit - Exact forty-character commit
 * @param relative - Repository-relative path
 * @returns Committed UTF-8 file contents
 */
function committedFile(commit: string, relative: string): string {
  try {
    boundedExecFileSync({
      label: "git locate pinned reusable",
      command: GIT,
      args: ["cat-file", "-e", `${commit}^{commit}`],
      cwd: REPO_ROOT,
      env: cleanGitEnv(process.env),
    });
  } catch (error) {
    if (!isMissingCommit(error, commit)) throw error;
    boundedExecFileSync({
      label: "git fetch pinned reusable",
      command: GIT,
      args: [
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        "--depth=1",
        "origin",
        commit,
      ],
      cwd: REPO_ROOT,
      env: cleanGitEnv(process.env),
    });
  }
  return boundedExecFileSync({
    label: "git show pinned reusable",
    command: GIT,
    args: ["show", `${commit}:${relative}`],
    cwd: REPO_ROOT,
    env: cleanGitEnv(process.env),
  });
}

/**
 * Read the named properties passed to the actual workflow-run API call.
 * @param script - JavaScript embedded in the GitHub Script step
 * @returns Every literal property in exact source order
 */
function workflowRunOptions(script: string): readonly string[] {
  const parsed = ts.createSourceFile(
    "nightly-e2e-findings.js",
    script,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const collect = (node: ts.Node): readonly ts.CallExpression[] => {
    const here =
      ts.isCallExpression(node) &&
      node.expression.getText(parsed) === "github.rest.actions.listWorkflowRuns"
        ? [node]
        : [];
    const below = node.getChildren(parsed).flatMap(collect);
    return [...here, ...below];
  };
  const calls = collect(parsed);
  const argument = calls.length === 1 ? calls[0]?.arguments[0] : undefined;
  if (calls.length !== 1) {
    throw new Error("expected exactly one listWorkflowRuns call");
  }
  if (argument === undefined || !ts.isObjectLiteralExpression(argument)) {
    throw new Error("listWorkflowRuns requires one literal options object");
  }
  return argument.properties.map(property => property.getText(parsed));
}

describe("nightly tracking review authority", () => {
  it("fetches only after the exact pinned commit is missing", () => {
    const absent = "f".repeat(40);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-nightly-pin-"));

    try {
      expect(isMissingCommit(catFileFailure(absent, REPO_ROOT), absent)).toBe(
        true
      );
      expect(isMissingCommit(catFileFailure(absent, outside), absent)).toBe(
        false
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("accepts only scheduled workflow-run events from the caller", () => {
    const caller = workflow(CALLER_REL);
    const track = caller.jobs.track;

    expect(track?.if).toContain(
      "github.event.workflow_run.event == 'schedule'"
    );
    expect(track?.if).toContain(
      "github.event.workflow_run.head_branch == " +
        "github.event.repository.default_branch"
    );
    expect(track?.if).toContain(
      "github.event.workflow_run.head_repository.full_name == " +
        "github.repository"
    );
  });

  it("reads only completed scheduled suite runs on the default branch", () => {
    const reusable = workflow(REUSABLE_REL);
    const findings = reusable.jobs.plan?.steps?.find(
      step => step.id === "findings"
    );
    const script = findings?.with?.script ?? "";

    expect(workflowRunOptions(script)).toEqual([
      "...context.repo",
      "workflow_id: matches[0].id",
      "branch: context.payload.repository.default_branch",
      "event: 'schedule'",
      "status: 'completed'",
      "per_page: 1",
    ]);
  });

  it("pins the remote reusable to immutable identical workflow bytes", () => {
    const caller = workflow(CALLER_REL);
    const uses = caller.jobs.track?.uses ?? "";
    const prefix =
      "CodySwannGT/lisa/.github/workflows/nightly-e2e-tracking.yml@";

    expect(uses.startsWith(prefix)).toBe(true);
    const commit = uses.slice(prefix.length);
    expect(commit).toMatch(/^[0-9a-f]{40}$/u);
    expect(committedFile(commit, REUSABLE_REL)).toBe(read(REUSABLE_REL));
  });
});
