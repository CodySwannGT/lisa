/** Supported injected primary must prove actual scoped API reads before continuation. */
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { taskFixture } from "../../helpers/task-readiness-fixture.js";
import {
  DATABASE,
  WORKSPACE,
  notionRequirement,
  nativeFixture,
  selfResult,
  fetchResult,
} from "../../helpers/task-native-events.js";
import { installNotionApi } from "../../helpers/task-notion-api.js";
const roots: string[] = [];
const CALLS = "calls.jsonl";
const SELF = "notion:self",
  DATABASE_READ = "notion:database",
  MISMATCH = "identity-mismatch";
/** Fixed synthetic curl argv and public response contract; no value is journaled.
 * @returns Installed real-wrapper fixture.
 */
function fixture() {
  const f = taskFixture(false, true, { NOTION_API_TOKEN: "synthetic-token" });
  roots.push(f.root);
  writeFileSync(
    path.join(f.root, ".lisa.config.json"),
    JSON.stringify({
      source: "notion",
      notion: { workspaceId: "fixture", prdDatabaseId: DATABASE },
    })
  );
  installNotionApi(f);
  f.refresh([notionRequirement]);
  return f;
}
afterEach(() =>
  roots
    .splice(0)
    .forEach(root => rmSync(root, { recursive: true, force: true }))
);
describe("Notion actual supported primary", () => {
  it("uses documented bot.workspace_id rather than top-level user id or owner.workspace boolean", () => {
    const f = fixture();
    writeFileSync(
      path.join(f.root, ".lisa.config.json"),
      JSON.stringify({
        source: "notion",
        notion: { workspaceId: WORKSPACE, prdDatabaseId: DATABASE },
      })
    );
    f.refresh([notionRequirement]);
    const positive = f.run();
    expect(positive.status).toBe(0);
    expect(positive.ordered).toEqual([SELF, DATABASE_READ]);
    expect(positive.counters.code).toBe(1);
    f.env.FIXTURE_NOTION_MISSING = "1";
    f.env.FIXTURE_NOTION_USER_MATCH = "1";
    const missing = f.run();
    expect(missing.status).toBe(2);
    expect(missing.counters.code).toBe(0);
    expect(missing.ordered).toEqual([SELF]);
    expect(missing.stderr).toContain(MISMATCH);
    delete f.env.FIXTURE_NOTION_MISSING;
    delete f.env.FIXTURE_NOTION_USER_MATCH;
    f.env.FIXTURE_NOTION_NATIVE_SHAPE = "1";
    const nativeShape = f.run();
    expect(nativeShape.status).toBe(2);
    expect(nativeShape.counters.code).toBe(0);
  });
  it("fresh newly valid primary proves self->database; removing it cannot resurrect an older native observation", () => {
    const f = nativeFixture(),
      action = f.action();
    roots.push(f.root);
    expect(f.runEvent(action).status).toBe(2);
    const self = f.self(),
      fetch = f.fetch();
    expect(f.runEvent(self).status).toBe(0);
    f.after(self, selfResult());
    expect(f.runEvent(fetch).status).toBe(0);
    f.after(fetch, fetchResult());
    installNotionApi(f);
    writeFileSync(path.join(f.root, CALLS), "");
    f.env.NOTION_API_TOKEN = "synthetic-new-primary";
    const primary = f.runEvent(action);
    const calls = readFileSync(path.join(f.root, CALLS), "utf8")
      .trim()
      .split("\n")
      .map(l => JSON.parse(l).label);
    expect(primary.status).toBe(0);
    expect(primary.effects).toBe(1);
    expect(calls.filter(l => l.startsWith("notion:"))).toEqual([
      SELF,
      DATABASE_READ,
    ]);
    delete f.env.NOTION_API_TOKEN;
    const removed = f.runEvent(action);
    expect(removed.status).toBe(2);
    expect(removed.effects).toBe(1);
    f.env.NOTION_API_TOKEN = "synthetic-wrong-primary";
    f.env.FIXTURE_NOTION_WRONG = "1";
    const wrong = f.runEvent(action);
    expect(wrong.status).toBe(2);
    expect(wrong.effects).toBe(1);
    expect(wrong.stderr).toContain(MISMATCH);
    console.info(
      "QUALIFICATION_OBSERVATION",
      JSON.stringify({
        case: "fresh-primary-vs-old-native",
        primary_exit: primary.status,
        primary_effects: primary.effects,
        calls,
        removed_exit: removed.status,
        removed_effects: removed.effects,
        wrong_exit: wrong.status,
        wrong_effects: wrong.effects,
      })
    );
  });
  it("reaches the documented matching native fallback after a genuinely unavailable primary", () => {
    const f = nativeFixture(),
      action = f.action(),
      self = f.self(),
      fetch = f.fetch();
    roots.push(f.root);
    f.env.NOTION_API_TOKEN = "synthetic-unavailable";
    f.refresh([notionRequirement]);
    writeFileSync(
      path.join(f.env.PATH, "curl"),
      `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2);if(JSON.stringify(a)!==JSON.stringify(['--config','-']))process.exit(64);const s=fs.readFileSync(0,'utf8');if(!s.includes('https://api.notion.com/v1/users/me'))process.exit(64);fs.appendFileSync(${JSON.stringify(path.join(f.root, CALLS))},JSON.stringify({tool:'curl',label:'notion:unavailable',argv:a})+'\\n');process.exitCode=7;\n`,
      { mode: 0o755 }
    );
    expect(f.runEvent(action).status).toBe(2);
    expect(f.runEvent(self).status).toBe(0);
    f.after(self, selfResult());
    expect(f.runEvent(fetch).status).toBe(0);
    f.after(fetch, fetchResult());
    expect(f.runEvent(action).effects).toBe(1);
    expect(f.runEvent(action).status).toBe(2);
  });
  it("reads authenticated self and exact database then releases the actual wrapper continuation", () => {
    const f = fixture(),
      r = f.run();
    console.info(
      "QUALIFICATION_OBSERVATION",
      JSON.stringify({
        case: "notion-real-primary",
        exit: r.status,
        effects: r.counters,
        calls: r.ordered,
      })
    );
    expect(r.status).toBe(0);
    expect(r.ordered).toEqual([SELF, DATABASE_READ]);
    expect(r.counters.code).toBe(1);
    expect(
      [
        r.stdout,
        r.stderr,
        readFileSync(path.join(f.root, CALLS), "utf8"),
      ].join()
    ).not.toContain("synthetic-token");
  });
  it.each(["FIXTURE_NOTION_WRONG", "FIXTURE_DATABASE_WRONG"])(
    "refuses %s without mutation",
    flag => {
      const f = fixture();
      f.env[flag] = "1";
      const r = f.run();
      expect(r.counters.code).toBe(0);
      expect(r.stderr).toContain(MISMATCH);
    }
  );
});
