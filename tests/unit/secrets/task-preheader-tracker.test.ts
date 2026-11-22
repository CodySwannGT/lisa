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
      atlassian: { cloudId, email },
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

it("admits the native Jira issue read for the configured cloud and project only", () => {
  const f = fixture("jira");
  const issue = { cloudId, issueIdOrKey: ref, fields: ["*all"] };
  const call = (args: Record<string, unknown>, tool = "getJiraIssue") =>
    boundedSpawnSync({
      label: "native Jira intake read",
      command: "/bin/bash",
      args: [path.join(f.plugin, "hooks/secrets-preflight.sh"), "--task-hook"],
      cwd: f.root,
      env: f.env,
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        cwd: f.root,
        tool_name: `mcp__plugin_atlassian_atlassian__${tool}`,
        tool_input: args,
        mcp_server: { name: "plugin:atlassian:atlassian", source: "plugin" },
      }),
    });
  expect(call(issue).status).toBe(0);
  expect(call({ ...issue, cloudId: "other" }).status).toBe(2);
  expect(call({ ...issue, issueIdOrKey: "OPS-123" }).status).toBe(2);
  expect(call(issue, "editJiraIssue").status).toBe(2);
});
