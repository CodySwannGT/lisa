/**
 * CodySwannGT/lisa#4873 (CodeRabbit, PR #4881): Jira's search index can miss a
 * ticket created seconds earlier. An allocation retry inside that window must
 * find the ticket the previous run created rather than file a second one. The
 * adapter remembers each created ticket on the automation account's own Jira
 * user property, which reads back consistently, and reconciles it into search.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allocateLeaf } from "../../../all/copy-overwrite/scripts/lib/npm-update-allocate.mjs";
import { createTracker } from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker.mjs";
import { withPrivateRoot } from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { fakeJira } from "../../support/npm-update-jira-fake.js";
import {
  JIRA_CONFIG,
  JIRA_MAINTAINER,
  REGISTRY_METADATA,
  automation,
  codeHost,
  committedHost,
} from "../../support/npm-update-tracker-host.js";

const CREDENTIALS = { JIRA_API_TOKEN: "t", JIRA_LOGIN: "bot@example.test" };

/**
 * Two allocations of the same selection against one lagging Jira project.
 * @param remember - Whether the fake accepts the user-property write.
 * @returns Both work items and the number of tickets created.
 */
async function retryInsideIndexWindow(remember: boolean) {
  const config = { ...JIRA_CONFIG, automationProvenance: await automation() };
  return withPrivateRoot(async (root, env) => {
    const host = await committedHost(root, env, JIRA_MAINTAINER);
    const jira = fakeJira({ assignable: [JIRA_MAINTAINER], indexLag: true });
    const transport: typeof jira.transport = (url, init) =>
      !remember && String(url).includes("/user/properties/")
        ? Promise.resolve(new Response("{}", { status: 403 }))
        : jira.transport(url, init);
    const api = {
      ...codeHost(host.parent),
      tracker: createTracker(config, CREDENTIALS, transport)!,
    };
    const first = (await allocateLeaf({ api, config, ...host })).workItem;
    const second = (await allocateLeaf({ api, config, ...host })).workItem;
    return { first, second, creates: jira.creates(), jira };
  });
}

describe("Jira allocation retried inside the search-index window", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(REGISTRY_METADATA)
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("finds the ticket the earlier run created instead of filing a second one", async () => {
    const { first, second, creates, jira } = await retryInsideIndexWindow(true);
    expect(first).toBe("PROJ-1");
    expect(second).toBe("PROJ-1");
    expect(creates).toBe(1);
    const priorSearches = jira.log.filter(
      entry =>
        entry.operation.endsWith("/search/jql") &&
        String((entry.body as { jql?: string }).jql).includes("labels =")
    );
    expect(priorSearches.at(-1)?.body).toMatchObject({
      reconcileIssues: [10_001],
    });
  });

  it("is the pre-#4873 behaviour, a second ticket, only when the account cannot keep the record", async () => {
    // The control: without the remembered ticket the lagging index hides PROJ-1.
    const { second, creates } = await retryInsideIndexWindow(false);
    expect(second).toBe("PROJ-2");
    expect(creates).toBe(2);
  });
});
