/**
 * `--tracker-create` on the two state-based trackers (CodySwannGT/lisa#5198).
 *
 * Linear and Jira carry the ready role as a workflow state, so the owner has
 * to resolve the configured state itself: Linear sets it at creation, Jira
 * moves the new issue after. Each transport is a stand-in that records the
 * request, so the tests read exactly what would have been sent.
 * @module tests/unit/secrets/task-tracker-create-vendors
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  flagValue,
  journalCalls,
  recorded,
  standIn,
  trackerCreateFixture,
  type Call,
} from "../../helpers/task-tracker-create-fixture.js";

const cleanup: string[] = [];
const BODY = "## Context\n\nThe full ticket body.\n";
const READY = "build-ready";

afterEach(() => {
  for (const dir of cleanup.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * A fixture for the given tracker, removed after the test.
 * @param config - Tracker settings.
 * @returns The fixture.
 */
function unbound(config: Record<string, unknown>) {
  const fixture = trackerCreateFixture(config);
  cleanup.push(...fixture.dirs);
  return fixture;
}

describe("filing on Linear", () => {
  const linear = {
    tracker: "linear",
    linear: {
      workspace: "fixture",
      teamKey: "FIX",
      workflow: { ready: "Todo" },
    },
  };
  const replies =
    'const out=stdin.includes("teams(")?{data:{teams:{nodes:[{id:"team-1",key:"FIX",states:{nodes:[{id:"state-backlog",name:"Backlog"},{id:"state-todo",name:"Todo"}]}}]}}}:stdin.includes("issueLabels")?{data:{issueLabels:{nodes:[{id:"label-bug",name:"Bug",team:null}]}}}:{data:{issueCreate:{success:true,issue:{identifier:"FIX-9",url:"https://linear.app/fixture/issue/FIX-9",team:{key:"FIX"}}}}};console.log(JSON.stringify(out));';

  it("files into the configured team's ready state with the named labels", () => {
    const { f, create, filed } = unbound(linear);
    const adapter = path.join(
      f.plugin,
      "skills/lisa-linear-access/scripts/linear-graphql.sh"
    );
    const script = `${adapter}.js`;
    const journal = path.join(f.root, "linear.jsonl");
    // The owner runs the adapter with bash, so the stand-in hands off to node.
    const handoff = [process.execPath, script].map(p => JSON.stringify(p));
    writeFileSync(adapter, `exec ${handoff.join(" ")} "$@"\n`);
    standIn(script, journal, replies);
    const result = create({
      title: "Linear ticket",
      body: BODY,
      labels: ["Bug"],
      readiness: READY,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).ref).toBe("FIX-9");
    const mutation = recorded(
      journalCalls(journal).find(call => call.stdin.includes("issueCreate"))
    );
    const variables = JSON.parse(flagValue(mutation.argv, "--variables"));
    expect(variables.input).toEqual({
      teamId: "team-1",
      title: "Linear ticket",
      description: BODY,
      stateId: "state-todo",
      labelIds: ["label-bug"],
    });
    expect(mutation.argv).toEqual(
      expect.arrayContaining(["--workspace", "fixture", "--team-key", "FIX"])
    );
    expect(filed()).toEqual([]);
  });
});

describe("filing on Jira", () => {
  const jira = {
    tracker: "jira",
    jira: { project: "FIX", workflow: { ready: "Ready" } },
    atlassian: {
      cloudId: "cloud-1",
      email: "agent@example.com",
      site: "fixture.atlassian.net",
    },
  };
  const replies =
    'const url=a.at(-1);const post=a.includes("POST");const out=url.endsWith("/myself")?{emailAddress:"agent@example.com"}:url.endsWith("/issue")&&post?{key:"FIX-3"}:url.includes("fields=status")?{fields:{status:{name:"Backlog"}}}:url.endsWith("/transitions")&&!post?{transitions:[{id:"11",to:{name:"Ready"}},{id:"12",to:{name:"Done"}}]}:null;if(out)console.log(JSON.stringify(out));';

  it("creates the issue, then moves it into the ready state", () => {
    const { f, bin, create } = unbound(jira);
    const journal = path.join(f.root, "jira.jsonl");
    standIn(path.join(bin, "curl"), journal, replies);
    const result = create({
      title: "Jira ticket",
      body: BODY,
      readiness: READY,
      issue_type: "Bug",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      code: "tracker-created",
      ref: "FIX-3",
      url: "https://fixture.atlassian.net/browse/FIX-3",
    });
    const sent = journalCalls(journal);
    const payload = (call: Call | undefined) =>
      JSON.parse(flagValue(recorded(call).argv, "--data-binary"));
    const posts = sent.filter(call => call.argv.includes("POST"));
    const api = "https://api.atlassian.com/ex/jira/cloud-1/rest/api/3";
    expect(posts.map(call => call.argv.at(-1))).toEqual([
      `${api}/issue`,
      `${api}/issue/FIX-3/transitions`,
    ]);
    expect(payload(posts[0]).fields).toMatchObject({
      project: { key: "FIX" },
      summary: "Jira ticket",
      issuetype: { name: "Bug" },
    });
    expect(payload(posts[1])).toEqual({ transition: { id: "11" } });
    expect(readFileSync(journal, "utf8")).not.toContain("synthetic-token");
  });
});
