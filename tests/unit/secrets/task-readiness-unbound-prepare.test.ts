/**
 * An unbound host session sees its refusal and can prepare a ticket itself
 * (CodySwannGT/lisa#5196).
 *
 * Every call here goes through `hooks/task-readiness-guard.sh`, the wrapper a
 * host project's hook runs. The wrapper publishes only known refusal codes,
 * so a code missing from its list reaches the agent as a misleading
 * `tool-missing`. An agent's shell tool also has no stdin, so the prepare step
 * takes its JSON from a file outside every repository, named exactly.
 * @module tests/unit/secrets/task-readiness-unbound-prepare
 */
import {
  existsSync,
  mkdtempSync,
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
const CONTEXT = ".lisa/work-item-context.md";
const UNBOUND = "work-item-unbound";
const REF = "fixture/project#1";
const INPUT_FLAG = "--input-file";
const PREPARE_FILE = "prepare.json";
const PREPARE = JSON.stringify({
  requirements_complete: true,
  required_access: [],
  context_body: "# Fixture ticket\nIts full body.\n",
});

afterEach(() => {
  for (const dir of cleanup.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * An isolated project with no work item bound, driven through the wrapper.
 * @returns The fixture, the owner script, a scratch folder and drivers
 */
function unbound() {
  const f = taskFixture(true);
  const outside = mkdtempSync(path.join(tmpdir(), "lisa-unbound-prepare-"));
  const owner = path.join(
    f.plugin,
    "skills/lisa-secrets-access/scripts/preflight-secrets.mjs"
  );
  const guard = (tool: string, input: Record<string, unknown>) =>
    boundedSpawnSync({
      label: "host readiness wrapper",
      command: process.execPath,
      args: [
        path.join(
          f.plugin,
          "skills/lisa-secrets-access/scripts/preflight-secrets.mjs"
        ),
        "--hook",
      ],
      cwd: f.root,
      env: f.env,
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        cwd: f.root,
        tool_name: tool,
        tool_input: input,
      }),
    });
  const shell = (command: string) => guard("Bash", { command });
  cleanup.push(f.root, outside);
  rmSync(path.join(f.root, CONTEXT));
  return { f, owner, outside, guard, shell };
}

describe("the host wrapper", () => {
  it("shows the unbound refusal, not tool-missing", () => {
    const { shell } = unbound();
    const result = shell("synthetic-command --flag");
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^work-item-unbound: No work item is bound/);
    expect(result.stderr).not.toContain("tool-missing");
    expect(result.stderr).toContain(INPUT_FLAG);
  });
});

describe("preparing a ticket with no shell input", () => {
  it("admits the exact file form, prepares the ticket, and hands the decision to it", () => {
    const { f, owner, outside, guard, shell } = unbound();
    const file = path.join(outside, PREPARE_FILE);
    expect(guard("Write", { file_path: file, content: PREPARE }).status).toBe(
      0
    );
    writeFileSync(file, PREPARE);
    const command = `node ${owner} --prepare --ref ${REF} ${INPUT_FLAG} ${file}`;
    expect(shell(command).status).toBe(0);
    const run = boundedSpawnSync({
      label: "prepare from file",
      command: process.execPath,
      args: [owner, "--prepare", "--ref", REF, INPUT_FLAG, file],
      cwd: f.root,
      env: f.env,
    });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout).code).toBe("requirements-prepared");
    expect(readFileSync(path.join(f.root, CONTEXT), "utf8")).toContain(
      `"work_item_ref":"${REF}"`
    );
    // The session is no longer unbound: the ticket's readiness decides.
    const next = guard("Write", {
      file_path: path.join(f.root, "x.md"),
      content: "x",
    });
    expect(next.stderr).not.toContain(UNBOUND);
  });

  it("admits nothing but the exact form", () => {
    const { f, owner, outside, shell } = unbound();
    const scratch = path.join(outside, PREPARE_FILE);
    const inProject = path.join(f.root, PREPARE_FILE);
    writeFileSync(scratch, PREPARE);
    writeFileSync(inProject, PREPARE);
    const base = `node ${owner} --prepare --ref ${REF} ${INPUT_FLAG}`;
    for (const command of [
      `${base} ${inProject}`,
      `${base} ${PREPARE_FILE}`,
      `${base} ${scratch}; synthetic-mutation`,
      `${base} ${scratch} && synthetic-mutation`,
      `${base} ${scratch} --extra`,
      `${base} '${scratch}'`,
      `${base}`,
    ]) {
      const result = shell(command);
      expect(result.status, command).toBe(2);
      expect(result.stderr, command).toContain(UNBOUND);
    }
  });

  it("refuses a file inside a repository even when the step is run directly", () => {
    const { f, owner } = unbound();
    const inProject = path.join(f.root, PREPARE_FILE);
    writeFileSync(inProject, PREPARE);
    const run = boundedSpawnSync({
      label: "prepare from a project file",
      command: process.execPath,
      args: [owner, "--prepare", "--ref", REF, INPUT_FLAG, inProject],
      cwd: f.root,
      env: f.env,
    });
    expect(run.status).toBe(2);
    expect(existsSync(path.join(f.root, CONTEXT))).toBe(false);
  });
});
