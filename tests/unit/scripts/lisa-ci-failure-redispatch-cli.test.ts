/**
 * The CI-failure re-dispatch CLI and its write path.
 *
 * The planner decides; `applyPlan` only performs. These cases pin the argv each
 * write sends (the live workflow runs exactly these), that writes happen in the
 * planned order, that a recorded fixture can never reach a write, and that the
 * `--dry-run` CLI prints the plan without writing.
 * @module tests/unit/scripts/lisa-ci-failure-redispatch-cli
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import {
  applyPlan,
  main,
  recordedGh,
} from "../../../scripts/lisa-ci-failure-redispatch.mjs";

const SCRIPT = "scripts/lisa-ci-failure-redispatch.mjs";
const FIXTURE = "tests/fixtures/ci-failure-redispatch/agent-pr-failed.json";
const REPO = "CodySwannGT/lisa";

/**
 * A live-shaped gh runner that records every call and answers success.
 * @param answer - Optional override per argv key.
 * @returns The runner and its call log.
 */
function fakeGh(answer: (key: string) => any = () => ({ ok: true })) {
  const calls: { args: string[]; input?: string | undefined }[] = [];
  const gh = (args: string[], options: { input?: string } = {}) => {
    calls.push({ args, input: options.input });
    return { stdout: "", stderr: "", ...answer(args.join(" ")) };
  };
  return { gh, calls };
}

describe("applyPlan", () => {
  it("posts the comment before moving the label, through the configured repository", () => {
    const { gh, calls } = fakeGh();
    applyPlan(
      {
        repository: REPO,
        actions: [
          { kind: "comment", item: `${REPO}#7`, body: "hello" },
          {
            kind: "relabel",
            item: `${REPO}#7`,
            remove: "status:in-progress",
            add: "status:ready",
          },
        ],
      },
      gh
    );
    expect(calls).toEqual([
      {
        args: ["issue", "comment", "7", "--repo", REPO, "--body-file", "-"],
        input: "hello",
      },
      {
        args: [
          "issue",
          "edit",
          "7",
          "--repo",
          REPO,
          "--remove-label",
          "status:in-progress",
          "--add-label",
          "status:ready",
        ],
        input: undefined,
      },
    ]);
  });

  it("edits a marker comment by its numeric id with a JSON body on stdin", () => {
    const { gh, calls } = fakeGh();
    applyPlan(
      {
        repository: REPO,
        actions: [{ kind: "edit-comment", commentId: 99, body: "cleared" }],
      },
      gh
    );
    expect(calls[0]?.args).toEqual([
      "api",
      "-X",
      "PATCH",
      `repos/${REPO}/issues/comments/99`,
      "--input",
      "-",
    ]);
    expect(JSON.parse(calls[0]?.input ?? "")).toEqual({ body: "cleared" });
  });

  it("stops at the first failed write and names it", () => {
    const { gh, calls } = fakeGh(() => ({ ok: false, stderr: "HTTP 403" }));
    expect(() =>
      applyPlan(
        {
          repository: REPO,
          actions: [
            { kind: "comment", item: `${REPO}#7`, body: "a" },
            { kind: "comment", item: `${REPO}#7`, body: "b" },
          ],
        },
        gh
      )
    ).toThrow(/HTTP 403/u);
    expect(calls).toHaveLength(1);
  });

  it("can never write through a recorded fixture", () => {
    expect(() =>
      applyPlan(
        {
          repository: REPO,
          actions: [{ kind: "comment", item: `${REPO}#7`, body: "a" }],
        },
        recordedGh({})
      )
    ).toThrow(/recorded/u);
  });
});

describe("main", () => {
  it("reads the run by id on the live path before planning", () => {
    const { gh, calls } = fakeGh(key =>
      key === `api repos/${REPO}/actions/runs/42`
        ? {
            ok: true,
            stdout: JSON.stringify({
              id: 42,
              head_sha: "b".repeat(40),
              pull_requests: [],
              repository: { full_name: REPO },
            }),
          }
        : { ok: true, stdout: "[]" }
    );
    const out: string[] = [];
    const code = main(["--run-id", "42", "--dry-run"], {
      gh,
      write: (line: string) => out.push(line),
    });
    expect(code).toBe(0);
    expect(calls[0]?.args).toEqual(["api", `repos/${REPO}/actions/runs/42`]);
    expect(out.join("\n")).toContain("no-pull-request");
  });

  it("refuses a run id that is not a positive integer", () => {
    const out: string[] = [];
    expect(
      main(["--run-id", "42; rm -rf /", "--dry-run"], {
        gh: fakeGh().gh,
        write: (line: string) => out.push(line),
      })
    ).toBe(2);
  });

  it("refuses to apply a recorded fixture without --dry-run", () => {
    const out: string[] = [];
    expect(
      main(["--payload", FIXTURE], { write: (line: string) => out.push(line) })
    ).toBe(2);
    expect(out.join("\n")).toMatch(/--dry-run/u);
  });
});

describe("the CLI under plain node", () => {
  it("prints exactly one planned comment and one lane move for the failed-agent fixture", () => {
    const result = boundedSpawnSync({
      label: "ci-failure-redispatch dry-run CLI",
      command: process.execPath,
      args: [SCRIPT, "--payload", FIXTURE, "--dry-run"],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("dry run");
    const json = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
    expect(json.outcome).toBe("redispatch");
    expect(json.actions.map((a: { kind: string }) => a.kind)).toEqual([
      "comment",
      "relabel",
    ]);
    expect(JSON.parse(readFileSync(FIXTURE, "utf8")).event).toBeDefined();
  });
});
