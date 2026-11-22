/** Real registered shell decision + typed native events; component, not app execution. */
import {
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  nativeFixture,
  selfResult,
  fetchResult,
  rejectedFetch,
} from "../../helpers/task-native-events.js";
const roots: string[] = [];
const WRONG_RESOURCE = "wrong-resource";
const WRONG_CALL = "wrong-call";
const WRONG_SELF = "wrong-self";
const CONTEXT = ".lisa/work-item-context.md";
/** Register owned fixture cleanup.
 * @param extra - Include a second pending owner.
 * @returns Owned native event driver.
 */
function fixture(extra = false) {
  const f = nativeFixture(extra);
  roots.push(f.root);
  return f;
}
/** Run the supported fixed producer chain through actual before and after commands.
 * @param f - Owned native event driver.
 */
function prove(f: ReturnType<typeof fixture>) {
  const self = f.self(),
    fetch = f.fetch();
  expect(f.runEvent(self).status).toBe(0);
  f.after(self, selfResult());
  expect(f.runEvent(fetch).status).toBe(0);
  f.after(fetch, fetchResult());
}

/** Drive a mismatched or failed self event before attempting any fetch.
 * @param f - Owned event driver.
 * @param mode - Rejection scenario.
 */
function rejectedChain(f: ReturnType<typeof fixture>, mode: string) {
  const self = f.self(),
    fetch = f.fetch(),
    identity = selfResult();
  if (mode === "unsolicited") {
    f.after(self, identity);
    return;
  }
  expect(f.runEvent(self).status).toBe(0);
  if (mode === WRONG_SELF)
    identity.structuredContent.workspace.id =
      "44444444-4444-4444-8444-444444444444";
  f.after(
    { ...self, ...(mode === WRONG_CALL ? { tool_use_id: "unmatched" } : {}) },
    identity
  );
  if ([WRONG_SELF, WRONG_CALL].includes(mode)) return;
  expect(f.runEvent(fetch).status).toBe(0);
  if (mode === "failure")
    f.runEvent({ ...fetch, hook_event_name: "PostToolUseFailure" });
  else f.after(fetch, rejectedFetch(mode));
}

/** Change declared task inputs after proof to exercise freshness refusal.
 * @param f - Owned native driver.
 * @param mode - Controlled metadata change.
 */
function changeMetadata(f: ReturnType<typeof fixture>, mode: string) {
  if (mode === "config")
    writeFileSync(
      path.join(f.root, ".lisa.config.local.json"),
      JSON.stringify({ secrets: { namespace: "other" } })
    );
  if (mode === "context")
    writeFileSync(
      path.join(f.root, CONTEXT),
      `${readFileSync(path.join(f.root, CONTEXT), "utf8")}changed`
    );
  if (mode === "requirements") {
    const header = JSON.parse(
      readFileSync(path.join(f.root, CONTEXT), "utf8").split("\n")[1]!
    );
    f.refresh(header.required_access, {
      ref: "fixture/project#2",
      tracker: "github",
    });
  }
  if (mode === "binding") {
    mkdirSync(path.join(f.root, ".git/lisa"));
    writeFileSync(
      path.join(f.root, ".git/lisa/work-item.json"),
      JSON.stringify({
        version: 1,
        provider: "github",
        ref: "fixture/project#2",
        branch: null,
      })
    );
  }
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
describe("one-use pending native action", () => {
  it("withholds ordinary work, proves all native and executable scopes, consumes once before identical action", () => {
    const f = fixture(),
      action = f.action();
    expect(f.runEvent(action).status).toBe(2);
    expect(f.runEvent(f.self()).effects).toBe(0);
    // The first self is now in flight: complete that generation using its real ID.
    expect(f.runEvent(action).effects).toBe(0);
    // Begin a different action to invalidate the uncompleted probe cleanly.
    const original = f.event("Write", {
      file_path: path.join(f.root, "another.txt"),
      content: "synthetic",
    });
    expect(f.runEvent(original).status).toBe(2);
    prove(f);
    const allowed = f.runEvent({ ...original, tool_use_id: "ordinary-retry" });
    expect(allowed.status).toBe(0);
    expect(allowed.effects).toBe(1);
    expect(
      f.runEvent({ ...original, tool_use_id: "ordinary-replay" }).status
    ).toBe(2);
    console.info(
      "QUALIFICATION_OBSERVATION",
      JSON.stringify({
        case: "native-one-use",
        evidence: "registered-wrapper component",
        first_effects: 0,
        matching_effects: allowed.effects,
        replay_allowed: false,
      })
    );
  });
  it("retains an unsupported second native pending scope after Notion success", () => {
    const f = fixture(true),
      original = f.action();
    expect(f.runEvent(original).status).toBe(2);
    prove(f);
    const r = f.runEvent(original);
    expect(r.status).toBe(2);
    expect(r.effects).toBe(0);
  });
  it.each(["Bash", "mcp__github__claimIssue"])(
    "withholds and releases the identical %s continuation through the actual decision",
    tool => {
      const f = fixture(),
        original = f.event(
          tool,
          tool === "Bash"
            ? { command: "git switch -c synthetic" }
            : { issue: 1 }
        );
      expect(f.runEvent(original).status).toBe(2);
      prove(f);
      const r = f.runEvent({ ...original, tool_use_id: "scoped-retry" });
      expect(r.status).toBe(0);
      expect(r.effects).toBe(1);
      expect(
        f.runEvent({ ...original, tool_use_id: "second-retry" }).status
      ).toBe(2);
    }
  );
  it.each([
    WRONG_SELF,
    WRONG_RESOURCE,
    "error",
    "missing",
    "arbitrary",
    "chatgpt",
    WRONG_CALL,
    "unsolicited",
    "failure",
  ])("never releases ordinary work after %s", mode => {
    const f = fixture(),
      original = f.action();
    expect(f.runEvent(original).status).toBe(2);
    rejectedChain(f, mode);
    expect(f.runEvent(original).status).toBe(2);
    expect(f.runEvent(original).effects).toBe(0);
  });
  it("rejects malformed state rather than treating it as a prior proof", () => {
    const f = fixture(),
      original = f.action();
    expect(f.runEvent(original).status).toBe(2);
    const directory = path.join(f.root, "lisa-verification-gate"),
      file = path.join(
        directory,
        readdirSync(directory).find(n => n.endsWith(".json"))!
      );
    const state = readFileSync(file, "utf8");
    expect(state).not.toContain("fixture");
    expect(state).not.toContain("product.txt");
    writeFileSync(file, "{}");
    const denied = f.runEvent(original);
    expect(denied.status).toBe(2);
    expect(denied.effects).toBe(0);
  });
  it.each([
    "action",
    "config",
    "context",
    "requirements",
    "surface",
    "binding",
    "root",
    "orientation",
    "session-end",
    "missing-call",
    "primary-available",
  ])("invalidates proof after %s changes", mode => {
    const f = fixture(),
      original = f.action();
    expect(f.runEvent(original).status).toBe(2);
    prove(f);
    let retry = original;
    if (mode === "action")
      retry = f.event("Write", {
        file_path: "other.txt",
        content: "synthetic",
      });
    changeMetadata(f, mode);
    if (mode === "surface") f.env.LISA_SECRETS_SURFACE = "container";
    if (mode === "primary-available")
      f.env.NOTION_API_TOKEN = "synthetic-primary";
    if (mode === "root") {
      const other = fixture();
      retry = { ...original, cwd: other.root };
    }
    if (mode === "orientation")
      expect(
        f.runEvent(f.event("Read", { file_path: "source.ts" })).status
      ).toBe(0);
    if (mode === "session-end")
      f.runEvent({ ...original, hook_event_name: "SessionEnd" });
    if (mode === "missing-call") retry = { ...original, tool_use_id: "" };
    expect(f.runEvent(retry).status).toBe(2);
    expect(f.runEvent(retry).effects).toBe(0);
  });
  it.each(["provenance", "input", "missing-after", "replayed-call"])(
    "rejects a %s probe chain",
    mode => {
      const f = fixture(),
        original = f.action();
      expect(f.runEvent(original).status).toBe(2);
      const self = f.self();
      expect(f.runEvent(self).status).toBe(0);
      if (mode !== "missing-after") f.after(self, selfResult());
      if (mode === "replayed-call") expect(f.runEvent(self).status).toBe(2);
      else {
        const fetch = f.fetch();
        if (mode === "provenance")
          fetch.mcp_server = { name: "other-connection", source: "claudeai" };
        if (mode === "input") fetch.tool_input = { id: "wrong-resource" };
        expect(f.runEvent(fetch).status).toBe(2);
      }
      expect(f.runEvent(original).effects).toBe(0);
    }
  );
  it("keeps actual secret/argument/native-response canaries out of every output and state sink", () => {
    const f = fixture(),
      canary = `synthetic-private-${randomUUID()}`,
      original = f.event("Write", {
        file_path: "product.txt",
        content: canary,
      });
    f.env.FIXTURE_CANARY = canary;
    const outputs = [f.runEvent(original)];
    const self = f.self();
    outputs.push(f.runEvent(self));
    const identity = selfResult();
    identity.structuredContent.user.name = canary;
    outputs.push(f.after(self, identity));
    const fetch = f.fetch();
    outputs.push(f.runEvent(fetch));
    const resource = fetchResult();
    resource.content[0]!.resource.text = canary;
    outputs.push(f.after(fetch, resource));
    outputs.push(f.runEvent(original));
    expect(outputs.at(-1)?.effects).toBe(1);
    const directory = path.join(f.root, "lisa-verification-gate");
    const sinks = [
      ...outputs.flatMap(r => [r.stdout, r.stderr]),
      ...readdirSync(directory)
        .filter(n => n.endsWith(".json"))
        .map(n => readFileSync(path.join(directory, n), "utf8")),
    ];
    for (const sink of sinks) expect(String(sink)).not.toContain(canary);
  });
});
