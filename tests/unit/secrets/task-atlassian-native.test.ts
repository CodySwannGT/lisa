/** Existing Atlassian native owner must complete the actual one-use gate. */
import { writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nativeFixture } from "../../helpers/task-native-events.js";
const roots: string[] = [];
const PREFIX = "mcp__plugin_atlassian_atlassian__";
/** Prepare both real routed scopes with no independent token assertion.
 * @returns Actual before/after wrapper driver.
 */
function fixture() {
  const f = nativeFixture();
  roots.push(f.root);
  writeFileSync(
    path.join(f.root, ".lisa.config.json"),
    JSON.stringify({
      tracker: "jira",
      source: "confluence",
      jira: { project: "FIX" },
      atlassian: { cloudId: "cloud", site: "fixture.atlassian.net" },
    })
  );
  f.refresh(
    [
      {
        id: "jira",
        kind: "capability",
        credential_names: ["ATLASSIAN_API_TOKEN"],
        access_layer: "atlassian",
        operation: "issue-type-metadata",
        resource: "FIX",
      },
      {
        id: "spaces",
        kind: "capability",
        credential_names: ["ATLASSIAN_API_TOKEN"],
        access_layer: "atlassian",
        operation: "list-spaces",
        resource: "cloud",
      },
    ],
    { ref: "FIX-1", tracker: "jira" }
  );
  return f;
}
/** Runtime-owned plugin provenance and exact existing operation arguments.
 * @param f - Driver.
 * @param tool - Fixed native tool suffix.
 * @param args - Fixed scoped read inputs.
 * @returns Native event.
 */
function event(
  f: ReturnType<typeof fixture>,
  tool: string,
  args: Record<string, unknown>
) {
  return {
    ...f.event(PREFIX + tool, args),
    mcp_server: { name: "plugin:atlassian:atlassian", source: "plugin" },
  };
}
/** Complete one authenticated tenant/resource pair using recognized producer shapes.
 * @param f - Actual wrapper driver.
 * @param jira - Select the already declared Jira operation.
 * @param wrong - Return the wrong tenant.
 */
function pair(f: ReturnType<typeof fixture>, jira: boolean, wrong = false) {
  const self = event(f, "getAccessibleAtlassianResources", {});
  const fetch = event(
    f,
    jira ? "getJiraProjectIssueTypesMetadata" : "getConfluenceSpaces",
    jira ? { cloudId: "cloud", projectIdOrKey: "FIX" } : { cloudId: "cloud" }
  );
  expect(f.runEvent(self).status).toBe(0);
  f.after(self, {
    content: [
      {
        type: "text",
        text: JSON.stringify([
          {
            id: wrong ? "other" : "cloud",
            url: "https://fixture.atlassian.net",
            name: "fixture",
            scopes: ["read:jira-work", "read:confluence-space.summary"],
          },
        ]),
      },
    ],
  });
  if (wrong) return;
  expect(f.runEvent(fetch).status).toBe(0);
  f.after(fetch, {
    structuredContent: jira
      ? {
          issueTypes: [{ id: "1", name: "Task", subtask: false }],
          startAt: 0,
          maxResults: 50,
          total: 1,
        }
      : {
          results: [
            {
              id: "7",
              key: "DOC",
              name: "Docs",
              type: "global",
              status: "current",
            },
          ],
          _links: { base: "https://fixture.atlassian.net/wiki" },
        },
  });
}
afterEach(() =>
  roots
    .splice(0)
    .forEach(root => rmSync(root, { recursive: true, force: true }))
);
describe("Atlassian guarded native continuation", () => {
  it("requires matching Jira and Confluence scope then releases one identical action", () => {
    const f = fixture(),
      action = f.action();
    expect(f.runEvent(action).status).toBe(2);
    pair(f, true);
    pair(f, false);
    const r = f.runEvent(action);
    console.info(
      "QUALIFICATION_OBSERVATION",
      JSON.stringify({
        case: "atlassian-real-gate",
        exit: r.status,
        effects: r.effects,
      })
    );
    expect(r.status).toBe(0);
    expect(r.effects).toBe(1);
    expect(f.runEvent(action).status).toBe(2);
  });
  it("refuses wrong authenticated tenant without continuation", () => {
    const f = fixture(),
      action = f.action();
    f.runEvent(action);
    pair(f, true, true);
    expect(f.runEvent(action).effects).toBe(0);
  });
});
