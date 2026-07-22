import { describe, expect, it } from "vitest";
import { createLinearAdapter } from "../../../src/cli/deploy-status-adapter-linear.js";
import { DEPLOY_STATUS_SYNC_MARKER } from "../../../src/core/deploy-status-transition.js";

const REF = "ENG-41";
const KEY = "lin_api_test_key";
const GRAPHQL_URL = "https://api.linear.app/graphql";
const DEV_LABEL = "status:on-dev";
const STAGING_LABEL = "status:on-stg";
const DONE_STATUSES = [DEV_LABEL, STAGING_LABEL, "status:done"];

/** One recorded fetch request. */
interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/**
 * Build a linear adapter over a scripted fetch queue.
 * @param payloads - JSON response payload per request, in call order
 * @param env - Environment for credential sourcing
 * @returns Adapter plus recorded requests
 */
function recordingAdapter(
  payloads: readonly unknown[],
  env: Record<string, string | undefined> = { LINEAR_API_KEY: KEY }
): {
  readonly adapter: ReturnType<typeof createLinearAdapter>;
  readonly calls: RecordedCall[];
} {
  const queue = [...payloads];
  const calls: RecordedCall[] = [];
  const fetchImpl = ((url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string>) },
      body: String(init?.body ?? ""),
    });
    return Promise.resolve(
      new Response(JSON.stringify(queue.shift() ?? { data: {} }), {
        status: 200,
      })
    );
  }) as typeof fetch;
  const adapter = createLinearAdapter(
    { workspace: "acme", doneStatuses: DONE_STATUSES },
    { fetchImpl, env }
  );
  return { adapter, calls };
}

const ISSUE_STATE = {
  data: {
    issue: {
      id: "uuid-41",
      identifier: REF,
      state: { name: "In Progress", type: "started" },
      labels: { nodes: [{ name: DEV_LABEL }, { name: "type:Story" }] },
      children: { nodes: [{ state: { type: "started" } }] },
    },
  },
};

describe("linear adapter request contract", () => {
  it("POSTs GraphQL with the raw Authorization header (no Bearer)", async () => {
    const { adapter, calls } = recordingAdapter([ISSUE_STATE]);
    await adapter.fetchItemState(REF);
    expect(calls[0]?.url).toBe(GRAPHQL_URL);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers["Authorization"]).toBe(KEY);
    expect(calls[0]?.headers["Content-Type"]).toBe("application/json");
  });

  it("maps the issue payload into TrackerItemState", async () => {
    const { adapter } = recordingAdapter([ISSUE_STATE]);
    await expect(adapter.fetchItemState(REF)).resolves.toEqual({
      ref: REF,
      type: "type:Story",
      openChildren: 1,
      currentStatus: DEV_LABEL,
      closed: false,
    });
  });

  it("resolves the label id then issues issueAddLabel for transitions", async () => {
    const { adapter, calls } = recordingAdapter([
      { data: { issue: { id: "uuid-41" } } },
      { data: { issueLabels: { nodes: [{ id: "label-7" }] } } },
      { data: { issueAddLabel: { success: true } } },
    ]);
    await adapter.transitionToDone(REF, STAGING_LABEL);
    expect(calls).toHaveLength(3);
    expect(calls[1]?.body).toContain("issueLabels");
    expect(calls[1]?.body).toContain(STAGING_LABEL);
    expect(calls[2]?.body).toContain("issueAddLabel");
    expect(calls[2]?.body).toContain("label-7");
  });

  it("fails decision-readably when the done label does not exist", async () => {
    const { adapter } = recordingAdapter([
      { data: { issue: { id: "uuid-41" } } },
      { data: { issueLabels: { nodes: [] } } },
    ]);
    await expect(adapter.transitionToDone(REF, STAGING_LABEL)).rejects.toThrow(
      /status:on-stg/
    );
  });

  it("closes natively by moving to the team's completed state", async () => {
    const { adapter, calls } = recordingAdapter([
      {
        data: {
          issue: {
            id: "uuid-41",
            team: {
              states: {
                nodes: [
                  { id: "state-1", name: "In Progress", type: "started" },
                  { id: "state-9", name: "Done", type: "completed" },
                ],
              },
            },
          },
        },
      },
      { data: { issueUpdate: { success: true } } },
    ]);
    await adapter.closeNatively(REF);
    expect(calls[1]?.body).toContain("issueUpdate");
    expect(calls[1]?.body).toContain("state-9");
  });
});

describe("linear adapter managed comment", () => {
  const BODY = `${DEPLOY_STATUS_SYNC_MARKER}\nDeploy status sync: body.`;

  it("returns unchanged with no mutation when the body is identical", async () => {
    const { adapter, calls } = recordingAdapter([
      {
        data: {
          issue: {
            id: "uuid-41",
            comments: { nodes: [{ id: "c1", body: BODY }] },
          },
        },
      },
    ]);
    await expect(adapter.upsertManagedComment(REF, BODY)).resolves.toBe(
      "unchanged"
    );
    expect(calls).toHaveLength(1);
  });

  it("creates a comment when no marker comment exists", async () => {
    const { adapter, calls } = recordingAdapter([
      { data: { issue: { id: "uuid-41", comments: { nodes: [] } } } },
      { data: { commentCreate: { success: true } } },
    ]);
    await expect(adapter.upsertManagedComment(REF, BODY)).resolves.toBe(
      "created"
    );
    expect(calls[1]?.body).toContain("commentCreate");
  });

  it("updates the existing marker comment when the body changed", async () => {
    const { adapter, calls } = recordingAdapter([
      {
        data: {
          issue: {
            id: "uuid-41",
            comments: {
              nodes: [{ id: "c1", body: `${DEPLOY_STATUS_SYNC_MARKER}\nold` }],
            },
          },
        },
      },
      { data: { commentUpdate: { success: true } } },
    ]);
    await expect(adapter.upsertManagedComment(REF, BODY)).resolves.toBe(
      "updated"
    );
    expect(calls[1]?.body).toContain("commentUpdate");
  });
});

describe("linear adapter credential sourcing", () => {
  it("prefers LINEAR_API_KEY, then the workspace-suffixed variable", async () => {
    const { adapter, calls } = recordingAdapter([ISSUE_STATE], {
      LINEAR_API_KEY_acme: "ws-key",
    });
    await adapter.fetchItemState(REF);
    expect(calls[0]?.headers["Authorization"]).toBe("ws-key");
  });

  it("fails decision-readably when no credential source resolves", async () => {
    const { adapter } = recordingAdapter([ISSUE_STATE], {});
    await expect(adapter.fetchItemState(REF)).rejects.toThrow(
      /LINEAR_API_KEY|lisa-linear/
    );
  });
});
