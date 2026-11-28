/**
 * A session bound to a ticket whose requirements went stale keeps its ways
 * out (CodySwannGT/lisa#5203).
 *
 * A pull that changes the project configuration, or a removed context file,
 * makes the bound ticket's header stale. The guard used to refuse everything
 * but orientation then, including the scratch write the prepare step needs
 * and `clear`, so only a person could end the lockout. Every call here goes
 * through `hooks/task-readiness-guard.sh`, the wrapper a host project runs.
 * @module tests/unit/secrets/task-readiness-stale-binding
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { taskFixture } from "../../helpers/task-readiness-fixture.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const cleanup: string[] = [];
const CONFIG = ".lisa.config.json";
const CONTEXT = ".lisa/work-item-context.md";
const REF = "fixture/project#1";
const CLEAR = "node scripts/lisa-work-item.mjs clear";
const STALE = "requirements-stale";
const SCRIPT = "scripts/lisa-work-item.mjs";
const WORK_ITEM = path.resolve(SCRIPT);

afterEach(() => {
  for (const dir of cleanup.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * A project bound to REF, with a valid context, and drivers.
 * @returns The fixture, a scratch folder and drivers
 */
function bound() {
  const f = taskFixture(true);
  const outside = mkdtempSync(path.join(tmpdir(), "lisa-stale-binding-"));
  const state = path.join(f.root, ".git/lisa/work-item.json");
  const guard = (
    tool: string,
    toolInput: Record<string, unknown>,
    cwd = f.root,
    extra: Record<string, unknown> = {}
  ) =>
    boundedSpawnSync({
      label: "host readiness wrapper",
      command: "/bin/bash",
      args: [path.join(f.plugin, "hooks/task-readiness-guard.sh")],
      cwd: f.root,
      env: f.env,
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        cwd,
        tool_name: tool,
        tool_input: toolInput,
        ...extra,
      }),
    });
  const shell = (command: string, cwd = f.root) =>
    guard("Bash", { command }, cwd);
  const write = (file: string) =>
    guard("Write", { file_path: file, content: "x" });
  const staleConfig = () => {
    const config = JSON.parse(readFileSync(path.join(f.root, CONFIG), "utf8"));
    writeFileSync(
      path.join(f.root, CONFIG),
      JSON.stringify({ ...config, gitguardian: { workspaceId: 43 } })
    );
  };
  mkdirSync(path.dirname(state), { recursive: true });
  writeFileSync(
    state,
    `${JSON.stringify({ branch: null, provider: "github", ref: REF, version: 1 })}\n`
  );
  cleanup.push(f.root, outside);
  return { f, outside, state, guard, shell, write, staleConfig };
}

describe("a binding whose requirements are current", () => {
  it("is not affected: project writes follow the ticket's readiness", () => {
    const { f, write } = bound();
    expect(write(path.join(f.root, "x.md")).stderr).not.toContain(
      "This checkout is bound to"
    );
  });
});

describe("a binding whose configuration changed after it was prepared", () => {
  it("admits the exact clear from the root, relative, absolute or quoted", () => {
    const { f, shell, staleConfig } = bound();
    staleConfig();
    const script = path.join(f.root, SCRIPT);
    for (const command of [
      CLEAR,
      `node ${script} clear`,
      `node '${script}' clear`,
    ])
      expect(shell(command).status, command).toBe(0);
  });

  it("refuses the absolute clear from outside the stale checkout, which it would not clear", () => {
    const { f, outside, shell, staleConfig } = bound();
    staleConfig();
    const script = path.join(f.root, SCRIPT);
    for (const cwd of ["/", outside]) {
      const result = shell(`node ${script} clear`, cwd);
      expect(result.status, cwd).toBe(2);
      expect(result.stderr, cwd).toContain(STALE);
    }
  });

  it("rotates the native readiness epoch on every stale decision, admitted or refused", () => {
    const { f, outside, guard, staleConfig } = bound();
    staleConfig();
    const gate = path.join(f.root, "lisa-verification-gate");
    const epochs = () =>
      existsSync(gate)
        ? readdirSync(gate)
            .filter(name => name.startsWith("readiness-epoch-"))
            .map(name => readFileSync(path.join(gate, name), "utf8"))
            .join()
        : "";
    const session = { session_id: "stale-session" };
    const seen = [epochs()];
    for (const file of [
      path.join(f.root, "x.md"),
      path.join(outside, "y.json"),
    ]) {
      guard("Write", { file_path: file, content: "x" }, f.root, session);
      seen.push(epochs());
    }
    expect(seen[1]).not.toBe("");
    expect(new Set(seen).size).toBe(3);
  });

  it("admits a write outside every repository", () => {
    const { outside, write, staleConfig } = bound();
    staleConfig();
    expect(write(path.join(outside, "prepare.json")).status).toBe(0);
  });

  it("refuses project work, naming the cause and both exits", () => {
    const { f, write, staleConfig } = bound();
    staleConfig();
    const refused = write(path.join(f.root, "x.md"));
    expect(refused.status).toBe(2);
    expect(
      refused.stderr.startsWith(
        `${STALE}: This checkout is bound to ${REF}, but its ${CONTEXT} no longer matches this checkout`
      )
    ).toBe(true);
    expect(refused.stderr).toContain(`--prepare --ref ${REF} --input-file`);
    expect(refused.stderr).toContain(
      `run exactly: ${CLEAR}, from the project root`
    );
  });

  it("refuses anything but the exact clear", () => {
    const { f, shell, staleConfig } = bound();
    staleConfig();
    const sub = path.join(f.root, "sub");
    mkdirSync(sub);
    const attempts: [string, string][] = [
      [`${CLEAR}; touch x`, f.root],
      [`${CLEAR} && touch x`, f.root],
      [`${CLEAR} --extra`, f.root],
      [`node scripts/lisa-work-item.mjs link ${REF}`, f.root],
      [CLEAR, sub],
    ];
    for (const [command, cwd] of attempts) {
      const result = shell(command, cwd);
      expect(result.status, command).toBe(2);
      expect(result.stderr, command).toContain(STALE);
    }
  });

  it("lets the session leave on its own: clear, then the session is unbound", () => {
    const { f, state, shell, staleConfig } = bound();
    staleConfig();
    expect(shell(CLEAR).status).toBe(0);
    const run = boundedSpawnSync({
      label: "work-item clear",
      command: process.execPath,
      args: [WORK_ITEM, "clear"],
      cwd: f.root,
      env: f.env,
    });
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(state)).toBe(false);
    expect(shell("synthetic-command").stderr).toMatch(/^work-item-unbound: /u);
  });
});

describe("a binding whose context file is missing", () => {
  it("names the missing file and still admits the ways out", () => {
    const { f, outside, shell, write } = bound();
    rmSync(path.join(f.root, CONTEXT));
    const refused = write(path.join(f.root, "x.md"));
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain(`but its ${CONTEXT} is missing`);
    expect(refused.stderr).toContain('add "context_body"');
    expect(shell(CLEAR).status).toBe(0);
    expect(write(path.join(outside, "prepare.json")).status).toBe(0);
  });
});

describe("stale requirements with nothing bound", () => {
  it("keeps the ordinary refusal", () => {
    const { f, state, outside, write, staleConfig } = bound();
    rmSync(state);
    staleConfig();
    const refused = write(path.join(outside, "x.json"));
    expect(refused.status).toBe(2);
    expect(refused.stderr).not.toContain("This checkout is bound to");
    expect(write(path.join(f.root, "x.md")).status).toBe(2);
  });
});
