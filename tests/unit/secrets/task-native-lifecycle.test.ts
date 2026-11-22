/** Actual registered lifecycle dispatch, not warning-based recorder suppression. */
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  nativeFixture,
  selfResult,
  fetchResult,
} from "../../helpers/task-native-events.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
const roots: string[] = [];
const BASH = "/bin/bash";
const HOOK = "hooks/secrets-preflight.sh";
/** Prepare a valid active task and a fully observed ready action.
 * @param agent - Optional subagent scope in the same root session.
 * @returns Driver and exact original action.
 */
function ready(agent?: string) {
  const f = nativeFixture(),
    original = { ...f.action(), ...(agent ? { agent_id: agent } : {}) },
    self = { ...f.self(), ...(agent ? { agent_id: agent } : {}) },
    fetch = { ...f.fetch(), ...(agent ? { agent_id: agent } : {}) };
  roots.push(f.root);
  expect(f.runEvent(original).status).toBe(2);
  expect(f.runEvent(self).status).toBe(0);
  f.after(self, selfResult());
  expect(f.runEvent(fetch).status).toBe(0);
  f.after(fetch, fetchResult());
  return { f, original };
}
/** Dispatch only the actually registered readiness handlers for this native event.
 * @param f - Installed fixture owner.
 * @param event - Native lifecycle event.
 * @returns Number of registered commands actually run.
 */
function lifecycle(f: ReturnType<typeof nativeFixture>, event: string) {
  const manifest = JSON.parse(
    readFileSync(
      path.resolve(
        __dirname,
        "../../../plugins/src/base/.claude-plugin/plugin.json"
      ),
      "utf8"
    )
  );
  const commands: string[] = (manifest.hooks[event] ?? [])
    .flatMap((g: { hooks: { command?: string }[] }) =>
      g.hooks.map(h => h.command ?? "")
    )
    .filter((c: string) => c.includes("secrets-preflight.sh"));
  for (const command of commands) {
    const result = boundedSpawnSync({
      label: "registered native lifecycle",
      command: BASH,
      args: ["-c", command.replaceAll("${CLAUDE_PLUGIN_ROOT}", f.plugin)],
      cwd: f.root,
      env: f.env,
      input: JSON.stringify({
        ...f.action(),
        hook_event_name: event,
        source: "resume",
      }),
    });
    expect(result.status).toBe(0);
  }
  return commands.length;
}
afterEach(() =>
  roots
    .splice(0)
    .forEach(root => rmSync(root, { recursive: true, force: true }))
);
describe("native observation lifecycle", () => {
  it("uses the registered reset arm independently of an equivalent runtime event spelling", () => {
    const { f, original } = ready();
    const result = boundedSpawnSync({
      label: "fixed native lifecycle arm",
      command: BASH,
      args: [path.join(f.plugin, HOOK), "--reset-native"],
      cwd: f.root,
      env: f.env,
      input: JSON.stringify({
        ...f.action(),
        hook_event_name: "userPromptSubmitted",
      }),
    });
    expect(result.status).toBe(0);
    expect(f.runEvent(original).effects).toBe(0);
  });
  it("resets SessionEnd before touching a slow synthetic provider", () => {
    const { f, original } = ready(),
      provider = path.join(f.env.PATH, "bws"),
      bytes = readFileSync(provider),
      marker = path.join(f.root, "unexpected-provider-attempt");
    writeFileSync(
      provider,
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'attempt');setTimeout(()=>{},30000);\n`
    );
    lifecycle(f, "SessionEnd");
    expect(existsSync(marker)).toBe(false);
    writeFileSync(provider, bytes);
    expect(f.runEvent(original).effects).toBe(0);
  });
  it("does not let lifecycle spelling downgrade an actual registered before hook", () => {
    const f = nativeFixture();
    roots.push(f.root);
    const result = boundedSpawnSync({
      label: "before flag retains real boundary",
      command: BASH,
      args: [path.join(f.plugin, HOOK), "--task-hook"],
      cwd: f.root,
      env: f.env,
      input: JSON.stringify({
        ...f.action(),
        hook_event_name: "UserPromptSubmit",
      }),
    });
    expect(result.status).toBe(2);
  });
  it.each(["SessionStart", "UserPromptSubmit"])(
    "withholds same-ID original action after registered %s",
    event => {
      const { f, original } = ready();
      const dispatched = lifecycle(f, event),
        result = f.runEvent(original);
      console.info(
        "QUALIFICATION_OBSERVATION",
        JSON.stringify({
          event,
          dispatched,
          exit: result.status,
          effects: result.effects,
        })
      );
      expect(result.effects).toBe(0);
      expect(result.status).toBe(2);
      const self = f.self(),
        fetch = f.fetch();
      expect(f.runEvent(self).status).toBe(0);
      f.after(self, selfResult());
      expect(f.runEvent(fetch).status).toBe(0);
      f.after(fetch, fetchResult());
      expect(f.runEvent(original).effects).toBe(1);
    }
  );
  it("rotates subagent observations with the root session lifecycle", () => {
    const { f, original } = ready("bounded-resolver");
    lifecycle(f, "SessionStart");
    expect(f.runEvent(original).effects).toBe(0);
  });
  it("invalidates an early config failure before exact restoration", () => {
    const { f, original } = ready(),
      config = path.join(f.root, ".lisa.config.json"),
      bytes = readFileSync(config);
    writeFileSync(config, "{");
    expect(f.runEvent(original).status).toBe(2);
    writeFileSync(config, bytes);
    const result = f.runEvent(original);
    console.info(
      "QUALIFICATION_OBSERVATION",
      JSON.stringify({
        event: "restore-after-failure",
        exit: result.status,
        effects: result.effects,
      })
    );
    expect(result.effects).toBe(0);
  });
  it("clears SessionEnd before malformed configuration is evaluated", () => {
    const { f, original } = ready(),
      config = path.join(f.root, ".lisa.config.json"),
      bytes = readFileSync(config);
    writeFileSync(config, "{");
    lifecycle(f, "SessionEnd");
    writeFileSync(config, bytes);
    expect(f.runEvent(original).effects).toBe(0);
  });
  it("retains uninterrupted fresh-pair one-use continuation", () => {
    const { f, original } = ready();
    expect(f.runEvent(original).effects).toBe(1);
    expect(f.runEvent(original).status).toBe(2);
    expect(f.runEvent(original).effects).toBe(1);
  });
});
