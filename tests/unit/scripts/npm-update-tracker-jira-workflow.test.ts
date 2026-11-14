/**
 * CodySwannGT/lisa#4859 review fixes for the Jira adapter: a ticket created
 * but not movable to Ready is named to the operator (B2); an app/service
 * account's comments are managed by account id alone (N1); the relationship
 * query searches summary and description (N4); the field-limit refusal is a
 * plain sentence (N8); comment lists page past 100 and an incomplete search
 * refuses (N9).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allocateLeaf } from "../../../all/copy-overwrite/scripts/lib/npm-update-allocate.mjs";
import { discoverPrior } from "../../../all/copy-overwrite/scripts/lib/npm-update-allocate.mjs";
import { createTracker } from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker.mjs";
import { adfCodeBlock } from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker-wire.mjs";
import { publicFailure } from "../../../all/copy-overwrite/scripts/lib/npm-update-invariants.mjs";
import { withPrivateRoot } from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { fakeJira } from "../../support/npm-update-jira-fake.js";
import type { JiraFakeOptions } from "../../support/npm-update-jira-fake.js";
import {
  JIRA_CONFIG,
  JIRA_MAINTAINER,
  REGISTRY_METADATA,
  automation,
  codeHost,
  committedHost,
} from "../../support/npm-update-tracker-host.js";

const CONFIG = { ...JIRA_CONFIG, automationProvenance: await automation() };
const CREDENTIALS = {
  JIRA_API_TOKEN: "jira-token-fixture",
  JIRA_LOGIN: "bot@example.test",
};
const STRANDED =
  "PROJ-1 was created but could not be moved to Ready. Move it to Ready by hand or fix the workflow transition, then rerun.";

/**
 * Allocate once over a committed host against a Jira fake with the given options.
 * @param options - Fake project options.
 * @returns The fake and the allocation outcome (value or error).
 */
async function allocateWith(options: JiraFakeOptions) {
  const jira = fakeJira({ assignable: [JIRA_MAINTAINER], ...options });
  const outcome = await withPrivateRoot(async (root, env) => {
    const host = await committedHost(root, env, JIRA_MAINTAINER);
    const api = {
      ...codeHost(host.parent),
      tracker: createTracker(CONFIG, CREDENTIALS, jira.transport)!,
    };
    return allocateLeaf({ api, config: CONFIG, ...host }).then(
      value => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error })
    );
  });
  return { jira, ...outcome };
}

describe("Jira allocation workflow edges", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(REGISTRY_METADATA)
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([0, 2])(
    "names the created ticket when %i transitions reach Ready",
    async readyTransitions => {
      const { jira, error } = await allocateWith({ readyTransitions });
      expect(jira.creates()).toBe(1);
      const text = publicFailure(error);
      expect(text).toContain(STRANDED);
      expect(text).not.toContain("Nothing was created");
    }
  );

  it("treats an app/service account's own comments as managed", async () => {
    const { jira, value, error } = await allocateWith({ accountType: "app" });
    expect(error).toBeUndefined();
    expect(value?.workItem).toBe("PROJ-1");
    expect(jira.issues[0]!.comments[0]!.accountType).toBe("app");
  });
});

describe("Jira queries and bounds", () => {
  const tracker = (jira: ReturnType<typeof fakeJira>) =>
    createTracker(CONFIG, CREDENTIALS, jira.transport)!;

  it("searches summary and description, not every text field, for relationships", async () => {
    const jira = fakeJira();
    jira.seed({ summary: "Bump npm packages", labels: [] });
    const found = await tracker(jira).relationships();
    expect(found.query).toBe(
      'project = "PROJ" AND (summary ~ "npm" OR description ~ "npm")'
    );
    expect(found.items).toEqual([{ number: 1, state: "open" }]);
  });

  it("explains the Jira field limit in a plain sentence before any request", async () => {
    const jira = fakeJira();
    const failure = await tracker(jira)
      .comment(1, "x".repeat(32_768))
      .then(
        () => undefined,
        (error: unknown) => error
      );
    expect(publicFailure(failure)).toContain("32,767");
    expect(jira.log).toEqual([]);
  });

  it("reads every comment past the first page of 100", async () => {
    const jira = fakeJira();
    jira.seed({ summary: "Seeded", labels: [] });
    for (let index = 0; index < 150; index++)
      jira.comment(1, adfCodeBlock(`comment ${index}`), "someone-else");
    const comments = await tracker(jira).comments(1);
    expect(comments).toHaveLength(150);
    expect(comments[149]!.body).toBe("comment 149");
    expect(
      jira.log.filter(entry => entry.operation.includes("/comment?"))
    ).toHaveLength(2);
  });

  it("refuses prior discovery when the selection search is incomplete", async () => {
    const jira = fakeJira();
    const selectionKey = "e".repeat(64);
    for (let index = 0; index < 101; index++)
      jira.seed({ summary: "Seeded", labels: [`lisa-npm-${selectionKey}`] });
    const api = { tracker: tracker(jira) };
    expect(
      (await api.tracker.searchPrior({ selectionKey })).incomplete_results
    ).toBe(true);
    await expect(
      discoverPrior(api, { repository: "acme/widgets", selectionKey })
    ).rejects.toThrow(/incomplete/);
  });
});
