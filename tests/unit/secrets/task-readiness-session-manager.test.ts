/**
 * The session manager runs in a Lisa-managed project with no ticket bound
 * (CodySwannGT/lisa#5211).
 *
 * The manager hands tickets to workers and binds none itself, so the readiness
 * gate admits its own marked session (except edits to project files) and the
 * operator's exact start/stop/status/validate commands. Everything else an
 * unbound session sends is still refused. The wrapper tests drive the host
 * hook a project actually runs.
 * @module tests/unit/secrets/task-readiness-session-manager
 */
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  MANAGER_CLI,
  managerName,
  managerSession,
  operatorCommand,
  operatorCommands,
  operatorHint,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/task-manager-session.mjs";
import { taskFixture } from "../../helpers/task-readiness-fixture.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const cleanup: string[] = [];
const CONTEXT = ".lisa/work-item-context.md";
const UNBOUND = "work-item-unbound";
const NAME = "demo-manager";
const MARK = "LISA_SESSION_MANAGER";
const LOCAL = ".lisa.config.local.json";
const STATUS = "status";
const LEDGER = ".lisa/session-manager/msg.txt";

afterEach(() => {
  for (const dir of cleanup.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * A real directory with a git folder and an optional manager config.
 * @param config - Parsed `.lisa.config.json`, if any
 * @returns Its real path
 */
function project(config?: Record<string, unknown>): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-sm-gate-")));
  cleanup.push(root);
  mkdirSync(path.join(root, ".git"));
  if (config)
    writeFileSync(path.join(root, ".lisa.config.json"), JSON.stringify(config));
  return root;
}

/**
 * A hook event for one tool call.
 * @param tool - Tool name
 * @param input - Tool input
 * @returns The event
 */
function event(tool: string, input: Record<string, unknown>) {
  return { hook_event_name: "PreToolUse", tool_name: tool, tool_input: input };
}

describe("managerName", () => {
  it("reads the committed name, and the local one over it", () => {
    const root = project({ sessionManager: { name: NAME } });
    expect(managerName(root)).toBe(NAME);
    writeFileSync(
      path.join(root, LOCAL),
      JSON.stringify({ sessionManager: { name: "local-manager" } })
    );
    expect(managerName(root)).toBe("local-manager");
  });

  it("is null with no config, no block, an empty name or a non-string", () => {
    expect(managerName(project())).toBeNull();
    expect(managerName(project({ tracker: "github" }))).toBeNull();
    expect(managerName(project({ sessionManager: { name: "" } }))).toBeNull();
    expect(managerName(project({ sessionManager: { name: 7 } }))).toBeNull();
    const broken = project();
    writeFileSync(path.join(broken, ".lisa.config.json"), "{not json");
    expect(managerName(broken)).toBeNull();
  });
});

describe("managerSession", () => {
  const bash = event("Bash", { command: "node cycle.mjs" });

  it("admits any non-edit call from the marked manager session", () => {
    const cfg = { projectRoot: project({ sessionManager: { name: NAME } }) };
    expect(managerSession(bash, cfg, { [MARK]: NAME })).toBe(true);
    expect(managerSession(event("Skill", {}), cfg, { [MARK]: NAME })).toBe(
      true
    );
  });

  it("refuses a missing, empty or mismatched mark, or no configured name", () => {
    const cfg = { projectRoot: project({ sessionManager: { name: NAME } }) };
    expect(managerSession(bash, cfg, {})).toBe(false);
    expect(managerSession(bash, cfg, { [MARK]: "" })).toBe(false);
    expect(managerSession(bash, cfg, { [MARK]: "other-manager" })).toBe(false);
    expect(
      managerSession(bash, { projectRoot: project() }, { [MARK]: NAME })
    ).toBe(false);
  });

  it("admits an edit under .lisa/ or outside every repository only", () => {
    const root = project({ sessionManager: { name: NAME } });
    const cfg = { projectRoot: root };
    const env = { [MARK]: NAME };
    const write = (file: string) =>
      managerSession(event("Write", { file_path: file }), cfg, env);
    expect(write(path.join(root, LEDGER))).toBe(true);
    expect(write(path.join(root, "src/app.ts"))).toBe(false);
    expect(write(path.join(root, ".lisa"))).toBe(false);
    expect(write(path.join(root, ".lisa-evil/x"))).toBe(false);
    const outside = realpathSync(
      mkdtempSync(path.join(tmpdir(), "lisa-sm-o-"))
    );
    cleanup.push(outside);
    expect(write(path.join(outside, "note.md"))).toBe(true);
    expect(write("relative/path.md")).toBe(false);
    for (const tool of ["Edit", "MultiEdit"])
      expect(
        managerSession(
          event(tool, { file_path: path.join(root, "README.md") }),
          cfg,
          env
        )
      ).toBe(false);
    expect(
      managerSession(
        event("NotebookEdit", { notebook_path: path.join(root, "n.ipynb") }),
        cfg,
        env
      )
    ).toBe(false);
    expect(
      managerSession(
        event("apply_patch", {
          command: `*** Begin Patch\n*** Update File: ${path.join(root, "a.ts")}\n*** End Patch`,
        }),
        cfg,
        env
      )
    ).toBe(false);
    expect(managerSession(event("Write", {}), cfg, env)).toBe(false);
  });
});

describe("operator commands", () => {
  it("names this install's CLI with every verb, plain and quoted", () => {
    const root = project();
    const commands = operatorCommands(root);
    for (const verb of ["start", "stop", STATUS, "validate"])
      expect(commands).toContain(
        `node ${MANAGER_CLI} ${verb} --project-root ${root}`
      );
    expect(commands).toContain(
      `node '${MANAGER_CLI}' ${STATUS} --project-root '${root}'`
    );
  });

  it("admits exactly those commands as Bash, and nothing near them", () => {
    const root = project();
    const cfg = { projectRoot: root };
    const status = `node ${MANAGER_CLI} ${STATUS} --project-root ${root}`;
    const admits = (command: unknown, tool = "Bash") =>
      operatorCommand(event(tool, { command }), cfg);
    expect(admits(status)).toBe(true);
    expect(admits(`${status}; touch x`)).toBe(false);
    expect(admits(`${status} --json`)).toBe(false);
    expect(admits(status.replace(STATUS, "cycle"))).toBe(false);
    expect(admits(status.replace(root, "/elsewhere"))).toBe(false);
    expect(admits(` ${status}`)).toBe(false);
    expect(admits(status, "Write")).toBe(false);
    expect(admits(undefined)).toBe(false);
  });

  it("is empty for a root that does not exist", () => {
    expect(
      operatorCommands(path.join(tmpdir(), "lisa-sm-missing-xyz"))
    ).toEqual([]);
  });

  it("names the command shape in the refusal hint", () => {
    const root = project();
    expect(operatorHint({ projectRoot: root })).toBe(
      "To start, stop or check on the session manager, which needs no ticket, " +
        `run exactly: node ${MANAGER_CLI} <start|stop|status|validate> --project-root ${root}.`
    );
  });
});

/**
 * An unbound host project with a configured manager, driven through the
 * wrapper a host hook runs.
 * @returns The fixture and a driver taking the session's extra environment
 */
function host() {
  const f = taskFixture(true);
  const cli = path.join(
    f.plugin,
    "skills/lisa-session-manager/scripts/session-manager.mjs"
  );
  const guard = (
    tool: string,
    input: Record<string, unknown>,
    env: Record<string, string> = {}
  ) =>
    boundedSpawnSync({
      label: "host readiness wrapper",
      command: "/bin/bash",
      args: [path.join(f.plugin, "hooks/task-readiness-guard.sh")],
      cwd: f.root,
      env: { ...f.env, ...env },
      input: JSON.stringify({ ...event(tool, input), cwd: f.root }),
    });
  cleanup.push(f.root);
  rmSync(path.join(f.root, CONTEXT));
  writeFileSync(
    path.join(f.root, LOCAL),
    JSON.stringify({ sessionManager: { name: NAME } })
  );
  mkdirSync(path.dirname(cli), { recursive: true });
  writeFileSync(cli, "");
  return { f, cli, guard };
}

describe("the host wrapper", () => {
  it("admits the marked manager session's cycle, and refuses its project edits", () => {
    const { f, guard } = host();
    const mark = { [MARK]: NAME };
    const cycle = { command: "node /x/session-manager.mjs cycle" };
    expect(guard("Bash", cycle, mark).status).toBe(0);
    const ledger = guard(
      "Write",
      { file_path: path.join(f.root, LEDGER), content: "x" },
      mark
    );
    expect(ledger.status).toBe(0);
    const edit = guard(
      "Write",
      { file_path: path.join(f.root, "src/app.ts"), content: "x" },
      mark
    );
    expect(edit.status).toBe(2);
    expect(edit.stderr).toContain(UNBOUND);
    const unmarked = guard("Bash", cycle);
    expect(unmarked.status).toBe(2);
    expect(unmarked.stderr).toContain(UNBOUND);
    expect(guard("Bash", cycle, { [MARK]: "other" }).status).toBe(2);
  });

  it("admits the operator's exact status command and names it when refusing", () => {
    const { f, cli, guard } = host();
    const status = `node ${cli} ${STATUS} --project-root ${f.root}`;
    expect(guard("Bash", { command: status }).status).toBe(0);
    const appended = guard("Bash", { command: `${status}; touch x` });
    expect(appended.status).toBe(2);
    expect(appended.stderr).toContain(
      `node ${cli} <start|stop|status|validate> --project-root ${f.root}`
    );
  });
});
