/** CodeRabbit RED authority contract for the nightly tracking workflows. */
import yaml from "js-yaml";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const REUSABLE_REL = ".github/workflows/nightly-e2e-tracking.yml";
const CALLER_REL =
  "expo/create-only/.github/workflows/nightly-e2e-tracking.yml";

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

/*
 * REMOVED with the SHA pin: `committedFile`, `isMissingCommit` and
 * `catFileFailure`, along with the test that exercised them.
 *
 * They resolved the caller's pinned forty-character commit — fetching it
 * shallowly when the local clone lacked the object — so the reusable's bytes at
 * that commit could be compared against the working tree. Every one of them
 * existed to serve a pin, and the caller now tracks `@main`.
 *
 * The deleted test asserted that the fetch fallback fired only after `cat-file`
 * proved the exact commit absent. That was worth asserting while a pin existed.
 * With no pin anywhere in the templates it would have exercised nothing but
 * these helpers — a test whose subject is its own scaffolding, which reads as
 * coverage and proves nothing about what ships.
 */

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

  it("tracks the remote reusable at `@main`, never a commit", () => {
    // This asserted a forty-character SHA, and compared that commit's copy of
    // the reusable byte-for-byte against the working tree. Both halves are gone
    // deliberately, and the second cannot be ported: with `@main` there is no
    // commit to resolve, and comparing a feature branch's working tree against
    // `origin/main` would be flaky by construction.
    //
    // What replaced the guarantee is not a weaker version of it. A SHA pin is
    // immutable right up to the moment history is rewritten, and then the
    // commit is unreachable, Actions cannot load the workflow, zero jobs run,
    // and the required check is ABSENT rather than red — every pull request
    // blocks on a verdict that never arrives. That happened here. Tracking
    // `@main` trades byte-identity for a failure that is loud.
    const caller = workflow(CALLER_REL);
    const uses = caller.jobs.track?.uses ?? "";
    const prefix =
      "CodySwannGT/lisa/.github/workflows/nightly-e2e-tracking.yml@";

    expect(uses.startsWith(prefix)).toBe(true);
    expect(uses.slice(prefix.length)).toBe("main");
  });
});
