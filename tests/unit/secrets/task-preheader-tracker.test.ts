/** Exercise the scoped tracker reader through the actual native readiness hook. */
import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nativeBash } from "../../helpers/task-native-bash.js";
import { taskFixture } from "../../helpers/task-readiness-fixture.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const roots: string[] = [];
const ref = "ENG-123";
const token = "synthetic-scoped-tracker-credential";
const email = "fixture@example.invalid";
const cloudId = "jira-fixture";
const contextFile = ".lisa/work-item-context.md";
const linearSkill = path.resolve(
  import.meta.dirname,
  "../../../plugins/src/base/skills/lisa-linear-access"
);
const mock = `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2), raw = fs.readFileSync(0, 'utf8'), url = argv.find(arg => arg.startsWith('https://'));
const token = ${JSON.stringify(token)}, email = ${JSON.stringify(email)};
if (argv.join(' ').includes(token)) process.exit(64);
let result;
if (url === 'https://api.linear.app/graphql') {
  const header = argv.find(a => a.startsWith('@/'));
  if (!header || !fs.readFileSync(header.slice(1), 'utf8').includes(token)) process.exit(64);
  const {query, variables} = JSON.parse(raw);
  if (query.includes('viewer{id name organization')) result = { data: {viewer: {id:'actor',name:'Fixture',organization:{urlKey:'fixture',name:'Fixture'}},teams:{nodes:[{key:'ENG'}]}} };
  else if (variables.id === 'ENG-123') {
    const id = process.env.FIXTURE_MISMATCH ? 'OPS-123' : 'ENG-123';
    const after = variables.after;
    const more = after !== 'last' || process.env.FIXTURE_REPEAT_CURSOR === '1';
    const comments = {nodes:[{id:after ? 'two' : 'one',body:after ? 'second comment' : 'first comment'}], pageInfo:{hasNextPage:more,endCursor:'last'}};
    result = {data:{issue:{identifier:id, team:{key:'ENG'}, description:'complete body', comments}}};
  }
  if (!result) process.exit(64);
  process.stdout.write(JSON.stringify(result) + '\\n200');
} else {
  if (!raw.includes('Authorization: Basic ' + Buffer.from(email + ':' + token).toString('base64')) || !url.startsWith('https://api.atlassian.com/ex/jira/jira-fixture/rest/api/3/')) process.exit(64);
  if (url.endsWith('/myself')) result = {emailAddress:email};
  else if (url.endsWith('/issue/ENG-123?fields=*all')) result = {key:process.env.FIXTURE_MISMATCH ? 'OPS-123' : 'ENG-123',fields:{project:{key:'ENG'},description:'complete body'}};
  else if (url.endsWith('/issue/ENG-123/remotelink')) result = [{id:1}];
  else if (url.includes('/issue/ENG-123/comment?')) {
    const startAt = Number(new URL(url).searchParams.get('startAt'));
    result = {startAt:process.env.FIXTURE_REPEAT_CURSOR ? 0 : startAt,total:2,comments:[{id:startAt ? 'two' : 'one',body:startAt ? 'second comment' : 'first comment'}]};
  }
  if (!result) process.exit(64);
  process.stdout.write(JSON.stringify(result));
}
`;

afterEach(() =>
  roots
    .splice(0)
    .forEach(root => rmSync(root, { recursive: true, force: true }))
);

/** Install the real guard and adapter with a credential-free HTTP fixture.
 * @param tracker - The configured tracker in the isolated checkout.
 * @returns Read-only native tool envelopes and the fixture that owns them.
 */
function fixture(tracker: "linear" | "jira") {
  const f = taskFixture();
  const owner = path.join(
    f.plugin,
    "skills/lisa-secrets-access/scripts/preflight-secrets.mjs"
  );
  const read = (operation: string, key = ref) =>
    nativeBash(
      f,
      `node '${owner}' --tracker-intake-read --ref ${key} --read ${operation}`
    );
  roots.push(f.root);
  rmSync(path.join(f.root, contextFile));
  writeFileSync(
    path.join(f.root, ".lisa.config.json"),
    JSON.stringify({
      tracker,
      linear: { workspace: "fixture", teamKey: "ENG" },
      jira: { project: "ENG" },
      atlassian: { cloudId, email, site: "jira-fixture.atlassian.net" },
      secrets: { provider: "env" },
    })
  );
  cpSync(linearSkill, path.join(f.plugin, "skills/lisa-linear-access"), {
    recursive: true,
  });
  writeFileSync(path.join(f.env.PATH, "curl"), mock, { mode: 0o755 });
  f.env[tracker === "linear" ? "LINEAR_API_KEY" : "ATLASSIAN_API_TOKEN"] =
    token;
  cpSync("/usr/bin/tr", path.join(f.env.PATH, "tr"));
  return { ...f, read };
}

describe.each(["linear", "jira"] as const)("fresh %s intake", tracker => {
  it("reads the issue body and every comment page without creating context or authorizing mutation", () => {
    const f = fixture(tracker);
    const native = f.read("issue"),
      paged = f.read("comments");
    for (const r of [native, paged]) {
      expect(r.guard.status).toBe(0);
      expect(r.tool?.status, String(r.tool?.stderr)).toBe(0);
      expect(String(r.tool?.stdout) + String(r.tool?.stderr)).not.toContain(
        token
      );
    }
    const issue = JSON.parse(String(native.tool?.stdout));
    expect(
      tracker === "linear" ? issue.description : issue.issue.fields.description
    ).toBe("complete body");
    expect(JSON.parse(String(paged.tool?.stdout))).toEqual([
      { id: "one", body: "first comment" },
      { id: "two", body: "second comment" },
    ]);
    expect(existsSync(path.join(f.root, contextFile))).toBe(false);
    expect(f.read("issue", "OPS-123").guard.status).toBe(2);
    expect(f.read("issue && gh issue close 123").guard.status).toBe(2);
  });

  it("refuses a mismatched issue or incomplete pagination without printing partial data", () => {
    const f = fixture(tracker);
    f.env.FIXTURE_MISMATCH = "1";
    const mismatch = f.read("issue");
    expect(mismatch.tool?.status).toBe(2);
    expect(mismatch.tool?.stdout).toBe("");
    expect(mismatch.tool?.stderr).toContain("identity-mismatch");
    delete f.env.FIXTURE_MISMATCH;
    f.env.FIXTURE_REPEAT_CURSOR = "1";
    const incomplete = f.read("comments");
    expect(incomplete.tool?.status).toBe(2);
    expect(incomplete.tool?.stdout).toBe("");
    expect(incomplete.tool?.stderr).toContain("capability-unreachable");
  });
});

/** Run the actual guard for an intake tool selected by the host.
 * @param f - The isolated tracker and hook.
 * @param tool - The host's exact tool name.
 * @param args - Native tool arguments.
 * @param event - Native connection identity and events from the host.
 * @returns The observed guard decision.
 */
function nativeMcp(
  f: ReturnType<typeof fixture>,
  tool: string,
  args: Record<string, unknown>,
  event: Record<string, unknown> = {}
) {
  const observe = ["PostToolUse", "PostToolUseFailure"].includes(
    String(event.hook_event_name)
  );
  return boundedSpawnSync({
    label: "native tracker intake read",
    command: process.execPath,
    args: [
      path.join(
        f.plugin,
        "skills/lisa-secrets-access/scripts/preflight-secrets.mjs"
      ),
      observe ? "--observe-native" : "--hook",
    ],
    cwd: f.root,
    env: f.env,
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      cwd: f.root,
      tool_name: tool,
      tool_input: args,
      session_id: "native-tracker-intake",
      ...event,
    }),
  });
}

it("admits the native Jira issue read for the configured cloud and project only", () => {
  const f = fixture("jira");
  const issue = { cloudId, issueIdOrKey: ref, fields: ["*all"] };
  const call = (args: Record<string, unknown>, tool = "getJiraIssue") =>
    nativeMcp(f, `mcp__plugin_atlassian_atlassian__${tool}`, args, {
      mcp_server: { name: "plugin:atlassian:atlassian", source: "plugin" },
    });
  expect(call(issue).status).toBe(0);
  expect(call({ ...issue, cloudId: "other" }).status).toBe(2);
  expect(call({ ...issue, issueIdOrKey: "OPS-123" }).status).toBe(2);
  expect(call(issue, "editJiraIssue").status).toBe(2);
});

it("lets the configured Linear owner use its read-only native fallback without an API key", () => {
  const f = fixture("linear");
  const call = (
    tool: string,
    args: Record<string, unknown>,
    event: Record<string, unknown> = {}
  ) =>
    nativeMcp(f, `mcp__linear-server__${tool}`, args, {
      mcp_server: { name: "linear-server", source: "user" },
      ...event,
    });
  delete f.env.LINEAR_API_KEY;

  expect(f.read("issue").tool?.stderr).toContain("credential-missing");
  expect(nativeMcp(f, "Skill", { skill: "lisa:linear-access" }).status).toBe(0);
  expect(call("list_teams", { query: "ENG", limit: 10 }).status).toBe(0);
  expect(call("list_comments", { issueId: ref, limit: 100 }).status).toBe(0);
  expect(call("get_issue", { id: "OPS-123" }).status).toBe(2);
  expect(call("list_teams", { query: "OPS" }).status).toBe(2);
  expect(call("list_comments", { issueId: ref, limit: 101 }).status).toBe(2);
  expect(call("save_issue", { id: ref }).status).toBe(2);
  expect(existsSync(path.join(f.root, contextFile))).toBe(false);
});

it("binds a Linear comment UUID only to a matching native issue response", () => {
  const f = fixture("linear");
  const issueId = "834d0721-7da6-4f28-9ffd-b67e9d2c4a07";
  const issue = { id: ref, includeRelations: true };
  const read = (
    tool: string,
    input: Record<string, unknown>,
    event: Record<string, unknown> = {}
  ) =>
    nativeMcp(f, `mcp__linear__${tool}`, input, {
      mcp_server: { name: "linear", source: "user" },
      ...event,
    });
  const comment = (event: Record<string, unknown> = {}) =>
    read("list_comments", { issueId, cursor: "next-page", limit: 100 }, event);
  const observe = (call: string, workspace: string, hook = "PostToolUse") =>
    read("get_issue", issue, {
      hook_event_name: hook,
      tool_use_id: call,
      tool_response: {
        structuredContent: {
          id: issueId,
          identifier: ref,
          url: `https://linear.app/${workspace}/issue/${ref}/proof`,
        },
      },
    });
  delete f.env.LINEAR_API_KEY;

  expect(comment().status).toBe(2);
  expect(observe("unobserved", "fixture").status).toBe(0);
  expect(comment().status).toBe(2);
  expect(
    read("get_issue", issue, { tool_use_id: "wrong-workspace" }).status
  ).toBe(0);
  expect(observe("wrong-workspace", "other").status).toBe(0);
  expect(comment().status).toBe(2);
  expect(
    read("get_issue", issue, { tool_use_id: "failed-result" }).status
  ).toBe(0);
  expect(observe("failed-result", "fixture", "PostToolUseFailure").status).toBe(
    0
  );
  expect(comment().status).toBe(2);
  expect(
    read("get_issue", issue, { tool_use_id: "matching-issue" }).status
  ).toBe(0);
  expect(observe("matching-issue", "fixture").status).toBe(0);
  expect(comment().status).toBe(0);
  expect(comment().status).toBe(0);
  expect(comment({ session_id: "different-intake" }).status).toBe(2);
  expect(
    comment({ mcp_server: { name: "linear", source: "project" } }).status
  ).toBe(2);
  expect(existsSync(path.join(f.root, contextFile))).toBe(false);
});

it("uses Jira's account-specific token when the shared environment key is absent", () => {
  const f = fixture("jira");
  delete f.env.ATLASSIAN_API_TOKEN;
  f.env.ATLASSIAN_API_TOKEN_fixture_example_invalid = token;
  const result = f.read("issue");

  expect(result.tool?.status, String(result.tool?.stderr)).toBe(0);
  expect(JSON.parse(String(result.tool?.stdout)).issue.key).toBe(ref);
});

it("reads the already authenticated Jira CLI only on the configured site and with complete comments", () => {
  const f = fixture("jira");
  delete f.env.ATLASSIAN_API_TOKEN;
  writeFileSync(
    path.join(f.env.PATH, "acli"),
    `#!${process.execPath}
const args = JSON.stringify(process.argv.slice(2));
if (args === JSON.stringify(['jira','auth','status'])) {
  console.log('  Site: ' + (process.env.FIXTURE_SITE || 'jira-fixture.atlassian.net'));
} else if (args === JSON.stringify(['jira','workitem','view','ENG-123','--fields','*all','--json'])) {
  console.log(JSON.stringify({key:'ENG-123',self:'https://jira-fixture.atlassian.net/rest/api/3/issue/42',fields:{project:{key:'ENG'},description:'complete body',comment:{startAt:0,total:process.env.FIXTURE_PARTIAL ? 2 : 1,comments:[{id:'one',body:'first comment'}]}}}));
} else process.exit(64);
`,
    { mode: 0o755 }
  );
  expect(JSON.parse(String(f.read("issue").tool?.stdout))).toMatchObject({
    issue: { key: ref },
    remoteLinks: null,
  });
  expect(JSON.parse(String(f.read("comments").tool?.stdout))).toEqual([
    { id: "one", body: "first comment" },
  ]);
  f.env.FIXTURE_PARTIAL = "1";
  const partial = f.read("comments");
  expect(partial.tool?.status).toBe(2);
  expect(partial.tool?.stdout).toBe("");
  f.env.FIXTURE_SITE = "other.atlassian.net";
  const wrong = f.read("issue");
  expect(wrong.tool?.status).toBe(2);
  expect(wrong.tool?.stderr).toContain("identity-mismatch");
});
