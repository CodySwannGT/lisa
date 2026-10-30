/** Fixed aliases reach the existing owner; declaration validation is not authenticated access proof. */
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { taskFixture } from "../../helpers/task-readiness-fixture.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
const roots: string[] = [];
const CLOUD = "fixture-cloud";
const jira = {
  id: "jira-project",
  kind: "capability",
  credential_names: ["ATLASSIAN_API_TOKEN"],
  access_layer: "atlassian",
  operation: "issue-type-metadata",
  resource: "FIX",
};
const confluence = {
  id: "confluence-spaces",
  kind: "capability",
  credential_names: ["ATLASSIAN_API_TOKEN"],
  access_layer: "atlassian",
  operation: "list-spaces",
  resource: CLOUD,
};
/** Prepare exact tracker/source requirements, with no live vendor.
 * @param required - Complete declared obligations.
 * @param explicit - Add an independent token assertion.
 * @returns Owned real-owner fixture.
 */
function fixture(required: unknown[] = [jira, confluence], explicit = false) {
  const f = taskFixture(false);
  roots.push(f.root);
  writeFileSync(
    path.join(f.root, ".lisa.config.json"),
    JSON.stringify({
      tracker: "jira",
      source: "confluence",
      jira: { project: "FIX" },
      atlassian: { cloudId: CLOUD, site: "fixture.atlassian.net" },
      ...(explicit ? { secrets: { require: ["ATLASSIAN_API_TOKEN"] } } : {}),
    })
  );
  f.refresh(required, { ref: "FIX-1", tracker: "jira" });
  return f;
}
/** Read the real shared CLI decision, not a fixture verdict.
 * @param f - Owned task fixture.
 * @returns Actual CLI response and decoded safe decision.
 */
function decision(f: ReturnType<typeof fixture>) {
  const r = boundedSpawnSync({
    label: "actual Atlassian owner routing",
    command: process.execPath,
    args: [
      path.join(
        f.plugin,
        "skills/lisa-secrets-access/scripts/preflight-secrets.mjs"
      ),
      "--task",
      "--ref",
      "FIX-1",
    ],
    cwd: f.root,
    env: f.env,
  });
  return { ...r, value: JSON.parse(String(r.stdout)) };
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
describe("Jira/Confluence shared-token routing", () => {
  it("admits only fixed owner discovery without releasing the ordinary action", () => {
    const f = fixture();
    rmSync(path.join(f.root, ".lisa/work-item-context.md"));
    const probe = (tool: string, args: Record<string, string>) =>
      boundedSpawnSync({
        label: "fixed Atlassian discovery admission, not authenticated proof",
        command: process.execPath,
        args: [
          path.join(
            f.plugin,
            "skills/lisa-secrets-access/scripts/preflight-secrets.mjs"
          ),
          "--hook",
        ],
        cwd: f.root,
        env: f.env,
        input: JSON.stringify({
          cwd: f.root,
          session_id: "atlassian-discovery",
          hook_event_name: "PreToolUse",
          tool_name: tool,
          tool_input: args,
          mcp_server: { name: "plugin:atlassian:atlassian", source: "plugin" },
        }),
      });
    expect(
      probe(
        "mcp__plugin_atlassian_atlassian__getAccessibleAtlassianResources",
        {}
      ).status
    ).toBe(0);
    expect(
      probe("mcp__plugin_atlassian_atlassian__getConfluenceSpaces", {
        cloudId: CLOUD,
      }).status
    ).toBe(0);
    expect(
      probe("mcp__plugin_atlassian_atlassian__getConfluenceSpaces", {
        cloudId: "wrong-cloud",
      }).status
    ).toBe(2);
    expect(
      probe("mcp__plugin_atlassian_atlassian__createJiraIssue", {
        cloudId: CLOUD,
      }).status
    ).toBe(2);
    f.refresh([jira, confluence], { ref: "FIX-1", tracker: "jira" });
    expect(f.run().status).toBe(2);
    expect(f.run().counters.code).toBe(0);
  });
  it("retains both scoped native obligations and withholds the ordinary action", () => {
    const f = fixture(),
      r = decision(f);
    expect(r.status).toBe(3);
    expect(r.value.pending).toHaveLength(2);
    expect(r.value.pending.map((p: { owner: string }) => p.owner)).toEqual([
      "lisa-atlassian-access",
      "lisa-atlassian-access",
    ]);
    expect(f.run().status).toBe(2);
    expect(f.run().counters).toEqual({
      claim: 0,
      branch: 0,
      code: 0,
      external: 0,
    });
  });
  it.each([[jira], [confluence]])(
    "does not defer the shared token when only one route is enumerated (%j)",
    required => {
      const f = fixture([required]),
        r = decision(f);
      expect(r.status).toBe(2);
      expect(r.value.code).toBe("credential-missing");
    }
  );
  it.each(["explicit", "credential-only"])(
    "keeps %s assertions independent",
    mode => {
      const f = fixture(
        mode === "credential-only"
          ? [
              jira,
              confluence,
              {
                id: "independent",
                kind: "credential",
                credential_names: ["ATLASSIAN_API_TOKEN"],
              },
            ]
          : [jira, confluence],
        mode === "explicit"
      );
      expect(decision(f).status).toBe(2);
    }
  );
  it("reaches the existing primary owner with supported injected access, without claiming native proof", () => {
    const f = fixture();
    f.env.ATLASSIAN_API_TOKEN = "synthetic-injected";
    const r = decision(f);
    expect(r.status).toBe(3);
    expect(
      r.value.pending.every(
        (p: { primary_available: boolean }) => p.primary_available
      )
    ).toBe(true);
    expect(f.run().status).toBe(2);
  });
  it.each(["wrong-resource", "missing-cloud", "missing-site"])(
    "refuses a %s configured scope before owner admission",
    mode => {
      const f = fixture();
      if (mode === "wrong-resource")
        f.refresh([jira, { ...confluence, resource: "other-cloud" }], {
          ref: "FIX-1",
          tracker: "jira",
        });
      else {
        writeFileSync(
          path.join(f.root, ".lisa.config.local.json"),
          JSON.stringify({
            atlassian:
              mode === "missing-cloud" ? { cloudId: "" } : { site: "" },
          })
        );
        f.refresh([jira, confluence], { ref: "FIX-1", tracker: "jira" });
      }
      expect(decision(f).status).toBe(2);
      expect(f.run().counters).toEqual({
        claim: 0,
        branch: 0,
        code: 0,
        external: 0,
      });
    }
  );
});
