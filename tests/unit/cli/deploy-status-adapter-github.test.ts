import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createGithubAdapter } from "../../../src/cli/deploy-status-adapter-github.js";
import { createExecGh } from "../../../src/cli/deploy-status-adapter.js";
import { DEPLOY_STATUS_SYNC_MARKER } from "../../../src/core/deploy-status-transition.js";

const REPOSITORY = "acme/app";
const REF = "acme/app#41";
const DEV_LABEL = "status:on-dev";
const STAGING_LABEL = "status:on-stg";
const DONE_LABEL = "status:done";
const DONE_STATUSES = [DEV_LABEL, STAGING_LABEL, DONE_LABEL];

/**
 * Build a github adapter over a scripted execGh queue.
 * @param responses - Stdout payload per gh invocation, in call order
 * @returns Adapter plus the recorded argv list
 */
function recordingAdapter(responses: readonly string[]): {
  readonly adapter: ReturnType<typeof createGithubAdapter>;
  readonly calls: string[][];
} {
  const queue = [...responses];
  const calls: string[][] = [];
  const adapter = createGithubAdapter(
    { repository: REPOSITORY, doneStatuses: DONE_STATUSES },
    {
      execGh: args => {
        calls.push([...args]);
        return Promise.resolve(queue.shift() ?? "");
      },
    }
  );
  return { adapter, calls };
}

const ISSUE_JSON = JSON.stringify({
  number: 41,
  state: "OPEN",
  labels: [{ name: DEV_LABEL }, { name: "type:Story" }],
});
const HIERARCHY_JSON = JSON.stringify({
  data: {
    repository: {
      issue: { subIssues: { nodes: [{ state: "OPEN" }, { state: "CLOSED" }] } },
    },
  },
});

describe("github adapter fetchItemState", () => {
  it("maps labels, hierarchy, and state into TrackerItemState", async () => {
    const { adapter, calls } = recordingAdapter([ISSUE_JSON, HIERARCHY_JSON]);
    const state = await adapter.fetchItemState(REF);
    expect(state).toEqual({
      ref: REF,
      type: "type:Story",
      openChildren: 1,
      currentStatus: DEV_LABEL,
      closed: false,
    });
    expect(calls[0]?.slice(0, 4)).toEqual(["issue", "view", "41", "--repo"]);
    // -f passes owner/repo as raw strings; -F stays only for the integer
    // number variable (typed parsing is wanted there, never for strings).
    expect(calls[1]?.slice(0, 2)).toEqual(["api", "graphql"]);
    expect(calls[1]?.slice(4)).toEqual([
      "-f",
      "owner=acme",
      "-f",
      "repo=app",
      "-F",
      "number=41",
    ]);
  });

  it("picks the highest-rung label when several done labels are present", async () => {
    const issue = JSON.stringify({
      number: 41,
      state: "OPEN",
      labels: [{ name: DEV_LABEL }, { name: STAGING_LABEL }],
    });
    const { adapter } = recordingAdapter([issue, HIERARCHY_JSON]);
    const state = await adapter.fetchItemState(REF);
    expect(state.currentStatus).toBe(STAGING_LABEL);
  });
});

describe("github adapter writes", () => {
  it("adds the target label and removes the other done labels in one edit", async () => {
    const { adapter, calls } = recordingAdapter([""]);
    await adapter.transitionToDone(REF, STAGING_LABEL);
    expect(calls[0]).toEqual([
      "issue",
      "edit",
      "41",
      "--repo",
      REPOSITORY,
      "--add-label",
      STAGING_LABEL,
      "--remove-label",
      DEV_LABEL,
      "--remove-label",
      DONE_LABEL,
    ]);
  });

  it("closes natively via gh issue close", async () => {
    const { adapter, calls } = recordingAdapter([""]);
    await adapter.closeNatively(REF);
    expect(calls[0]).toEqual(["issue", "close", "41", "--repo", REPOSITORY]);
  });
});

describe("github adapter managed comment", () => {
  const BODY = `${DEPLOY_STATUS_SYNC_MARKER}\nDeploy status sync: body.`;

  it("creates the comment when no marker comment exists", async () => {
    const { adapter, calls } = recordingAdapter(["[]", "{}"]);
    await expect(adapter.upsertManagedComment(REF, BODY)).resolves.toBe(
      "created"
    );
    expect(calls[0]).toEqual([
      "api",
      "repos/acme/app/issues/41/comments",
      "--paginate",
      "--slurp",
    ]);
    expect(calls[1]?.slice(0, 2)).toEqual([
      "api",
      "repos/acme/app/issues/41/comments",
    ]);
    expect(calls[1]).toContain(`body=${BODY}`);
  });

  it("finds the marker comment on a later slurped page (never re-creates)", async () => {
    // --paginate --slurp emits one top-level array whose elements are the
    // per-page arrays; the marker comment sitting on page 2 must be found.
    const twoPages = JSON.stringify([
      [{ id: 1, body: "unrelated" }],
      [{ id: 9002, body: BODY }],
    ]);
    const { adapter, calls } = recordingAdapter([twoPages]);
    await expect(adapter.upsertManagedComment(REF, BODY)).resolves.toBe(
      "unchanged"
    );
    expect(calls).toHaveLength(1);
  });

  it("updates a changed marker comment found on a later slurped page", async () => {
    const twoPages = JSON.stringify([
      [{ id: 1, body: "unrelated" }],
      [{ id: 9002, body: `${DEPLOY_STATUS_SYNC_MARKER}\nold` }],
    ]);
    const { adapter, calls } = recordingAdapter([twoPages, "{}"]);
    await expect(adapter.upsertManagedComment(REF, BODY)).resolves.toBe(
      "updated"
    );
    expect(calls[1]?.[1]).toBe("repos/acme/app/issues/comments/9002");
  });

  it("updates the existing marker comment when the body changed", async () => {
    const existing = JSON.stringify([
      [{ id: 9001, body: `${DEPLOY_STATUS_SYNC_MARKER}\nold` }],
    ]);
    const { adapter, calls } = recordingAdapter([existing, "{}"]);
    await expect(adapter.upsertManagedComment(REF, BODY)).resolves.toBe(
      "updated"
    );
    expect(calls[1]).toEqual([
      "api",
      "repos/acme/app/issues/comments/9001",
      "-X",
      "PATCH",
      "-f",
      `body=${BODY}`,
    ]);
  });

  it("makes zero write calls when the body is byte-identical", async () => {
    const existing = JSON.stringify([[{ id: 9001, body: BODY }]]);
    const { adapter, calls } = recordingAdapter([existing]);
    await expect(adapter.upsertManagedComment(REF, BODY)).resolves.toBe(
      "unchanged"
    );
    expect(calls).toHaveLength(1);
  });
});

describe("github adapter gh failure shape", () => {
  it("surfaces a nonzero gh exit as a decision-readable error", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lisa-dss-ghfail-"));
    try {
      const script = `#!/bin/sh\necho "gh: boom" >&2\nexit 3\n`;
      await writeFile(path.join(dir, "gh"), script, "utf8");
      await chmod(path.join(dir, "gh"), 0o755);
      const execGh = createExecGh(dir, {
        ...process.env,
        PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}`,
      });
      const adapter = createGithubAdapter(
        { repository: REPOSITORY, doneStatuses: [DONE_LABEL] },
        { execGh }
      );
      await expect(adapter.closeNatively(REF)).rejects.toThrow(
        /gh issue failed \(exit 3\): gh: boom/
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("github adapter argv fidelity via PATH-faked gh", () => {
  it("passes the exact argv to the gh executable", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lisa-dss-gh-"));
    try {
      const log = path.join(dir, "args.log");
      const script = `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}"\n`;
      await writeFile(path.join(dir, "gh"), script, "utf8");
      await chmod(path.join(dir, "gh"), 0o755);
      const execGh = createExecGh(dir, {
        ...process.env,
        PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}`,
      });
      const adapter = createGithubAdapter(
        { repository: REPOSITORY, doneStatuses: [DONE_LABEL] },
        { execGh }
      );
      await adapter.closeNatively(REF);
      const logged = (await readFile(log, "utf8")).trim().split("\n");
      expect(logged).toEqual(["issue", "close", "41", "--repo", REPOSITORY]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
