import { describe, expect, it } from "vitest";
import { createJiraAdapter } from "../../../src/cli/deploy-status-adapter-jira.js";
import { DEPLOY_STATUS_SYNC_MARKER } from "../../../src/core/deploy-status-transition.js";

const REF = "PROJ-41";
const CLOUD_ID = "cloud-123";
const GATEWAY = `https://api.atlassian.com/ex/jira/${CLOUD_ID}`;
const BASIC = `Basic ${Buffer.from("dev@acme.test:jira-token").toString("base64")}`;

/** One recorded fetch request. */
interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/**
 * Build a jira adapter over a scripted fetch queue.
 * @param payloads - JSON response payload per request, in call order
 * @param env - Environment for credential sourcing
 * @returns Adapter plus recorded requests
 */
function recordingAdapter(
  payloads: readonly unknown[],
  env: Record<string, string | undefined> = { JIRA_API_TOKEN: "jira-token" }
): {
  readonly adapter: ReturnType<typeof createJiraAdapter>;
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
      new Response(JSON.stringify(queue.shift() ?? {}), { status: 200 })
    );
  }) as typeof fetch;
  const adapter = createJiraAdapter(
    { cloudId: CLOUD_ID, email: "dev@acme.test" },
    { fetchImpl, env }
  );
  return { adapter, calls };
}

const ISSUE_PAYLOAD = {
  key: REF,
  fields: {
    status: { name: "On Dev", statusCategory: { key: "indeterminate" } },
    issuetype: { name: "Story" },
    subtasks: [
      { fields: { status: { statusCategory: { key: "done" } } } },
      { fields: { status: { statusCategory: { key: "new" } } } },
    ],
  },
};

describe("jira adapter request contract", () => {
  it("GETs the issue through the cloudId gateway with Basic auth", async () => {
    const { adapter, calls } = recordingAdapter([ISSUE_PAYLOAD]);
    await adapter.fetchItemState(REF);
    expect(calls[0]?.url).toBe(
      `${GATEWAY}/rest/api/3/issue/${REF}?fields=status,issuetype,subtasks`
    );
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers["Authorization"]).toBe(BASIC);
  });

  it("maps the issue payload into TrackerItemState", async () => {
    const { adapter } = recordingAdapter([ISSUE_PAYLOAD]);
    await expect(adapter.fetchItemState(REF)).resolves.toEqual({
      ref: REF,
      type: "Story",
      openChildren: 1,
      currentStatus: "On Dev",
      closed: false,
    });
  });

  it("resolves the transition id then POSTs the transition", async () => {
    const { adapter, calls } = recordingAdapter([
      {
        transitions: [
          { id: "11", to: { name: "On Dev" } },
          { id: "21", to: { name: "On Stg" } },
        ],
      },
      {},
    ]);
    await adapter.transitionToDone(REF, "On Stg");
    expect(calls[0]?.url).toBe(
      `${GATEWAY}/rest/api/3/issue/${REF}/transitions`
    );
    expect(calls[1]?.method).toBe("POST");
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
      transition: { id: "21" },
    });
  });

  it("fails decision-readably when no transition reaches the done status", async () => {
    const { adapter } = recordingAdapter([
      { transitions: [{ id: "11", to: { name: "On Dev" } }] },
    ]);
    await expect(adapter.transitionToDone(REF, "On Stg")).rejects.toThrow(
      /On Stg/
    );
  });

  it("treats closeNatively as a no-op (terminal status IS closure)", async () => {
    const { adapter, calls } = recordingAdapter([]);
    await adapter.closeNatively(REF);
    expect(calls).toHaveLength(0);
  });

  it("fails decision-readably without credentials", async () => {
    const { adapter } = recordingAdapter([ISSUE_PAYLOAD], {});
    await expect(adapter.fetchItemState(REF)).rejects.toThrow(
      /JIRA_API_TOKEN|ATLASSIAN_API_TOKEN/
    );
  });
});

describe("jira adapter managed comment", () => {
  const BODY = `${DEPLOY_STATUS_SYNC_MARKER}\nDeploy status sync: body.`;

  it("creates an ADF comment when no marker comment exists", async () => {
    const { adapter, calls } = recordingAdapter([{ comments: [] }, {}]);
    await expect(adapter.upsertManagedComment(REF, BODY)).resolves.toBe(
      "created"
    );
    expect(calls[1]?.method).toBe("POST");
    const body = JSON.parse(calls[1]?.body ?? "{}") as {
      body?: { content?: { content?: { text?: string }[] }[] };
    };
    expect(body.body?.content?.[0]?.content?.[0]?.text).toBe(BODY);
  });

  it("returns unchanged with no write when the ADF body is identical", async () => {
    const existing = {
      comments: [
        {
          id: "5001",
          body: {
            type: "doc",
            version: 1,
            content: [
              { type: "paragraph", content: [{ type: "text", text: BODY }] },
            ],
          },
        },
      ],
    };
    const { adapter, calls } = recordingAdapter([existing]);
    await expect(adapter.upsertManagedComment(REF, BODY)).resolves.toBe(
      "unchanged"
    );
    expect(calls).toHaveLength(1);
  });

  it("updates the existing marker comment when the body changed", async () => {
    const existing = {
      comments: [
        {
          id: "5001",
          body: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: `${DEPLOY_STATUS_SYNC_MARKER}\nold` },
                ],
              },
            ],
          },
        },
      ],
    };
    const { adapter, calls } = recordingAdapter([existing, {}]);
    await expect(adapter.upsertManagedComment(REF, BODY)).resolves.toBe(
      "updated"
    );
    expect(calls[1]?.method).toBe("PUT");
    expect(calls[1]?.url).toBe(
      `${GATEWAY}/rest/api/3/issue/${REF}/comment/5001`
    );
  });
});
