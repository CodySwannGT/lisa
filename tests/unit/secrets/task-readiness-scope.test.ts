/** Actual task decisions and hook continuations with isolated synthetic sources. */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { taskFixture, HEADER } from "../../helpers/task-readiness-fixture.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const roots: string[] = [];
const KEY = "TASK_API_KEY";
const MISSING_CREDENTIAL = "credential-missing";
const credential = {
  id: "task-input",
  kind: "credential",
  credential_names: [KEY],
};
const github = {
  id: "repository",
  kind: "capability",
  credential_names: ["GH_TOKEN"],
  access_layer: "github",
  operation: "repository-read",
  resource: "fixture/project",
};
const zero = { claim: 0, branch: 0, code: 0, external: 0 };
const one = { claim: 1, branch: 1, code: 1, external: 1 };
const CONFIG = ".lisa.config.json";
const LOCAL_CONFIG = ".lisa.config.local.json";
const CONTEXT = ".lisa/work-item-context.md";
const OWNER_SCRIPT = "skills/lisa-secrets-access/scripts/preflight-secrets.mjs";
/** Register a synthetic project for cleanup.
 * @param routing - Add the GitHub routing floor.
 * @returns Isolated project and native continuation.
 */
function fixture(routing = false) {
  const f = taskFixture(routing);
  roots.push(f.root);
  return f;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
/** Change only an owned fixture configuration.
 * @param f - Owned fixture.
 * @param value - Synthetic config document.
 * @param local - Select its local override.
 */
function changeConfig(
  f: ReturnType<typeof fixture>,
  value: unknown,
  local = false
) {
  writeFileSync(
    path.join(f.root, local ? LOCAL_CONFIG : CONFIG),
    JSON.stringify(value)
  );
}
/** Invoke the actual task-mode preclaim CLI.
 * @param f - Owned fixture with isolated environment.
 * @returns Actual exit status and streams.
 */
function decision(f: ReturnType<typeof fixture>) {
  return boundedSpawnSync({
    label: "real task preclaim CLI",
    command: process.execPath,
    args: [
      path.join(f.plugin, OWNER_SCRIPT),
      "--task",
      "--ref",
      "fixture/project#1",
    ],
    cwd: f.root,
    env: f.env,
  });
}

/** Ask the real hook whether a terminal command may begin.
 * @param f - Isolated project.
 * @param command - Actual native command envelope.
 * @param tool - Native tool identity, independent of its argument fields.
 * @returns Observed blocking result.
 */
function commandHook(
  f: ReturnType<typeof fixture>,
  command: string,
  tool = "Bash"
) {
  return boundedSpawnSync({
    label: "canonical readiness recovery envelope",
    command: "/bin/bash",
    args: [path.join(f.plugin, "hooks/secrets-preflight.sh")],
    cwd: f.root,
    env: f.env,
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      cwd: f.root,
      tool_name: tool,
      tool_input: { command },
    }),
  });
}

describe("requirements freshness, identity and real continuation boundary", () => {
  it("allows only the actual scoped native GitHub operation despite unavailable vault", () => {
    const f = fixture(true);
    f.refresh([github]);
    const result = f.run();
    expect(result.counters).toEqual(one);
    expect(result.ordered.some(c => c === "gh:api:repos/fixture/project")).toBe(
      true
    );
    const output = JSON.parse(String(decision(f).stdout));
    expect(output.capabilities[0].source).toBe("native-github");
    expect(output.capabilities[0].provider_health).toBe("not-observed");
  });
  it("refuses a populated credential used against the wrong repository identity", () => {
    const f = fixture(true);
    Object.assign(f.env, { GH_TOKEN: "synthetic", FIXTURE_GH_WRONG: "1" });
    f.refresh([github]);
    const result = f.run();
    expect(result.counters).toEqual(zero);
    expect(result.stderr).toContain("identity-mismatch");
  });
  it("observes the authenticated GitHub actor separately from repository ownership", () => {
    const f = fixture(true);
    f.refresh([github]);
    const observed = JSON.parse(String(decision(f).stdout));
    expect(observed.capabilities[0].authenticated_actor_observed).toBe(true);
    expect(observed.capabilities[0].authenticated_actor_id).toBe(17);
    expect(observed.capabilities[0].repository_observed).toBe(true);
    expect(f.run().ordered).toContain("gh:api:user");
    f.env.FIXTURE_ACTOR_INVALID = "1";
    const denied = f.run();
    expect(denied.counters).toEqual(zero);
    expect(denied.stderr).toContain("identity-mismatch");
  });
  it.each([
    "project_root",
    "work_item_ref",
    "context_sha256",
    "effective_config_sha256",
    "surface",
    "requirements_sha256",
    "requirements_complete",
  ])("refuses stale or mismatched %s before actual mutations", field => {
    const f = fixture();
    const header = {
      ...f.manifest,
      [field]: field === "requirements_complete" ? false : "mismatch",
    };
    writeFileSync(
      path.join(f.root, CONTEXT),
      `${HEADER + JSON.stringify(header)}\n-->\n${f.body}`
    );
    expect(f.run().counters).toEqual(zero);
  });
  it("rechecks config and newly added requirements instead of trusting a prior successful action", () => {
    const f = fixture();
    f.refresh([]);
    expect(f.run().counters).toEqual(one);
    changeConfig(f, { secrets: { provider: "env" } });
    expect(f.run().counters).toEqual(zero);
    f.refresh([credential]);
    expect(f.run().counters).toEqual(zero);
  });
  it("checks declared/routing floor even with an explicitly complete empty task list", () => {
    const f = fixture();
    changeConfig(f, { secrets: { provider: "env", require: [KEY] } });
    f.refresh([]);
    expect(f.run().counters).toEqual(zero);
  });
  it("does not call an unavailable shell adapter proof of missing native connector access", () => {
    const f = fixture();
    changeConfig(f, {
      notion: { prdDatabaseId: "fixture-database" },
      secrets: { provider: "env" },
    });
    f.env[KEY as keyof typeof f.env] = "synthetic";
    f.refresh([
      {
        id: "notion-database",
        kind: "capability",
        credential_names: [KEY],
        access_layer: "notion",
        operation: "database-read",
        resource: "fixture-database",
      },
    ]);
    const result = f.run();
    expect(result.counters).toEqual(zero);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("native-response-unrepresented");
    expect(String(result.stderr).includes(MISSING_CREDENTIAL)).toBe(false);
  });
  it("keeps fixed read orientation available during an affected task refusal", () => {
    const f = fixture();
    expect(f.run("PreToolUse", "Read").status).toBe(0);
  });
  it("admits the exact readiness owner check without admitting a chained mutation", () => {
    const f = fixture(true);
    const script = path.join(f.plugin, OWNER_SCRIPT);
    const command = `${process.execPath} ${script} --task --ref fixture/project#1`;
    expect(commandHook(f, command).status).toBe(0);
    expect(decision(f).status).toBe(2);
    expect(commandHook(f, `${command}; synthetic-mutation`).status).toBe(2);
    expect(commandHook(f, command, "Write").status).toBe(2);
    expect(commandHook(f, "pwd", "Write").status).toBe(2);
    expect(f.run().counters).toEqual(zero);
  });
  it("permits the bounded owner metadata refresh and only then the newly proved continuation", () => {
    const f = fixture(true);
    const script = path.join(f.plugin, OWNER_SCRIPT);
    writeFileSync(
      path.join(f.root, ".gitignore"),
      ".lisa/work-item-context.md\n"
    );
    expect(
      commandHook(f, `node ${script} --prepare --ref fixture/project#1`).status
    ).toBe(0);
    const prepared = boundedSpawnSync({
      label: "actual guarded requirement refresh",
      command: process.execPath,
      args: [script, "--prepare", "--ref", "fixture/project#1"],
      cwd: f.root,
      env: f.env,
      input: JSON.stringify({
        requirements_complete: true,
        required_access: [],
      }),
    });
    expect(prepared.status).toBe(0);
    const context = readFileSync(path.join(f.root, CONTEXT), "utf8");
    expect(context.slice(context.indexOf("\n-->\n") + 5)).toBe(f.body);
    expect(f.run().counters).toEqual(one);
  });
  it("rejects malformed, primitive, prototype and attacker-supplied header controls without reflection", () => {
    for (const configText of [
      "{",
      "null",
      '{"__proto__":{"x":1}}',
      '{"secrets":{"provider":"unknown"}}',
    ]) {
      const f = fixture();
      writeFileSync(path.join(f.root, CONFIG), configText);
      const result = f.run();
      expect(result.counters).toEqual(zero);
      expect(result.status).toBe(2);
    }
  });
  it("excludes an in-memory provider error canary from stdout, stderr, hook JSON and persisted result", () => {
    const f = fixture();
    const canary = `SYNTHETIC_PRIVATE_${Date.now()}`;
    Object.assign(f.env, { FIXTURE_CANARY: canary });
    const hook = f.run();
    const cli = decision(f);
    const artifact = JSON.stringify({
      stdout: hook.stdout,
      stderr: hook.stderr,
      result: JSON.parse(String(cli.stdout)),
    });
    const persisted = path.join(f.root, "safe-readiness-result.json");
    writeFileSync(persisted, artifact);
    expect(
      [
        hook.stdout,
        hook.stderr,
        cli.stdout,
        cli.stderr,
        artifact,
        readFileSync(persisted, "utf8"),
        readFileSync(path.join(f.root, CONTEXT), "utf8"),
      ].every(v => !String(v).includes(canary))
    ).toBe(true);
    expect(hook.counters).toEqual(zero);
  });
});
