/** Canonical intake metadata writes preserve raw context and binding ownership. */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { taskFixture } from "../../helpers/task-readiness-fixture.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const roots: string[] = [];
const CONTEXT = ".lisa/work-item-context.md";
const REF = "fixture/project#1";
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/** Initialize an isolated real git metadata owner.
 * @returns Owned project and canonical preparation command.
 */
function project() {
  const f = taskFixture(true);
  const script = path.join(
    f.plugin,
    "skills/lisa-secrets-access/scripts/preflight-secrets.mjs"
  );
  const prepare = (complete = true) =>
    boundedSpawnSync({
      label: "canonical required-access metadata",
      command: process.execPath,
      args: [script, "--prepare", "--ref", REF],
      cwd: f.root,
      env: f.env,
      input: JSON.stringify({
        requirements_complete: complete,
        required_access: [],
      }),
    });
  const git = boundedSpawnSync({
    label: "isolated metadata repository",
    command: "/usr/bin/git",
    args: ["init", "-q"],
    cwd: f.root,
    env: f.env,
  });
  roots.push(f.root);
  expect(git.status).toBe(0);
  writeFileSync(path.join(f.root, ".gitignore"), `${CONTEXT}\n`);
  writeFileSync(path.join(f.root, CONTEXT), f.body);
  return { ...f, prepare };
}

describe("canonical requirements-only intake transaction", () => {
  it("preserves every original body/comment byte and leaves canonical binding creation to its owner", () => {
    const f = project();
    const result = f.prepare();
    const context = readFileSync(path.join(f.root, CONTEXT), "utf8");
    expect(result.status).toBe(0);
    expect(context.slice(context.indexOf("\n-->\n") + 5)).toBe(f.body);
    expect(existsSync(path.join(f.root, ".git/lisa/work-item.json"))).toBe(
      false
    );
    expect(f.run().counters).toEqual({
      claim: 1,
      branch: 1,
      code: 1,
      external: 1,
    });
  });
  it("refuses incomplete enumeration and missing EAS exclusion without replacing the context", () => {
    const f = project();
    expect(f.prepare(false).status).not.toBe(0);
    expect(readFileSync(path.join(f.root, CONTEXT), "utf8")).toBe(f.body);
    writeFileSync(path.join(f.root, ".easignore"), "node_modules\n");
    expect(f.prepare().status).not.toBe(0);
    expect(readFileSync(path.join(f.root, CONTEXT), "utf8")).toBe(f.body);
  });
  it("binds ref/provider while branch attachment preserves the requirements header", () => {
    const f = project();
    const file = path.join(f.root, ".git/lisa/work-item.json");
    const state = { version: 1, provider: "github", ref: REF, branch: null };
    mkdirSync(path.dirname(file), { recursive: true });
    expect(f.prepare().status).toBe(0);
    writeFileSync(file, JSON.stringify(state));
    expect(f.run().status).toBe(0);
    writeFileSync(file, JSON.stringify({ ...state, branch: "feature" }));
    expect(f.run().status).toBe(0);
    writeFileSync(file, JSON.stringify({ ...state, ref: "fixture/project#2" }));
    expect(f.run().status).toBe(2);
  });
});
