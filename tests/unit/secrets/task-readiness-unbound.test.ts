/**
 * A session with no work item bound (CodySwannGT/lisa#5192).
 *
 * The guard refuses project work until a ticket is bound, and that stays. What
 * changed: the refusal says what is actually wrong and names the read command
 * this installation admits, a write that lands in no git repository is not
 * project work, and re-binding a checkout to a new ticket lets the prepare
 * step replace the previous ticket's context instead of dead-ending.
 * @module tests/unit/secrets/task-readiness-unbound
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSymlink } from "../../support/borrowed-node-modules.mjs";
import { taskFixture } from "../../helpers/task-readiness-fixture.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { readTaskConfig as readConfig } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";
import { prepareRequirements } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/task-requirements.mjs";

const cleanup: string[] = [];
const CONTEXT = ".lisa/work-item-context.md";
const UNBOUND = "work-item-unbound";
const NOTE = "note.md";
const SURFACE = { LISA_SECRETS_SURFACE: "local" };

afterEach(() => {
  for (const dir of cleanup.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * A fresh directory under the system temp directory.
 * @param prefix - Name prefix
 * @returns Its path
 */
function scratch(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

/**
 * An isolated project with no work item bound.
 * @returns The fixture and a hook driver
 */
function unbound() {
  const f = taskFixture(true);
  const hook = path.join(f.plugin, "hooks/secrets-preflight.sh");
  const drive = (tool: string, input: Record<string, unknown>) =>
    boundedSpawnSync({
      label: "unbound readiness hook",
      command: "/bin/bash",
      args: [hook, "--task-hook"],
      cwd: f.root,
      env: f.env,
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        cwd: f.root,
        tool_name: tool,
        tool_input: input,
      }),
    });
  const write = (file: string) =>
    drive("Write", { file_path: file, content: "x\n" });
  cleanup.push(f.root);
  rmSync(path.join(f.root, CONTEXT));
  return { f, drive, write };
}

describe("the refusal with no work item bound", () => {
  it("says no work item is bound and names the read command it admits", () => {
    const { drive } = unbound();
    const result = drive("Bash", { command: "synthetic-command --flag" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`${UNBOUND}: No work item is bound`);
    expect(result.stderr).toContain("bind its ticket first with lisa-track");
    expect(result.stderr).not.toContain("input resolver");
    const read =
      /exactly this command[^:]*: (gh issue view [^\n]*?)\.(?: |$)/m.exec(
        result.stderr
      )?.[1];
    expect(read).toContain("--repo fixture/project --json number,title,body");
    // The command it names is one the guard really admits.
    const admitted = drive("Bash", {
      command: String(read).replace("<number>", "7"),
    });
    expect(admitted.status, admitted.stderr).toBe(0);
  });

  it("names the Linear key read, with this installation's path, for a Linear project", () => {
    const { f, drive } = unbound();
    const file = path.join(f.root, ".lisa.config.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(
      file,
      JSON.stringify({
        ...config,
        tracker: "linear",
        linear: { workspace: "fixture-space", teamKey: "FIX" },
      })
    );
    const result = drive("Bash", { command: "synthetic-command" });
    expect(result.status).toBe(2);
    const read = /exactly this command[^:]*: (node [^\n]*?--read issue)/.exec(
      result.stderr
    )?.[1];
    expect(read).toContain(
      "skills/lisa-secrets-access/scripts/preflight-secrets.mjs --tracker-intake-read --ref FIX-<number>"
    );
    expect(result.stderr).toContain("--read comments");
    const admitted = drive("Bash", {
      command: String(read).replace("<number>", "12"),
    });
    expect(admitted.status, admitted.stderr).toBe(0);
  });
});

describe("writes with no work item bound", () => {
  it("admits a write that lands in no git repository", () => {
    const { drive, write } = unbound();
    const outside = scratch("lisa-unbound-outside-");
    expect(write(path.join(outside, NOTE)).status).toBe(0);
    expect(write(path.join(outside, "new/dir/memory.md")).status).toBe(0);
    writeFileSync(path.join(outside, NOTE), "x\n");
    expect(
      drive("Edit", {
        file_path: path.join(outside, NOTE),
        old_string: "x",
        new_string: "y",
      }).status
    ).toBe(0);
    expect(
      drive("NotebookEdit", {
        notebook_path: path.join(outside, "n.ipynb"),
        new_source: "",
      }).status
    ).toBe(0);
    expect(
      drive("apply_patch", {
        command: `*** Begin Patch\n*** Add File: ${path.join(outside, "a.md")}\n+a\n*** End Patch`,
      }).status
    ).toBe(0);
  });

  it("refuses a write into the project, another repository, a link into the project, or a relative path", () => {
    const { f, drive, write } = unbound();
    const other = scratch("lisa-unbound-repo-");
    mkdirSync(path.join(other, ".git"));
    const outside = scratch("lisa-unbound-link-");
    createSymlink(f.root, path.join(outside, "project"), "dir");
    // A link to a file that does not exist yet, inside the project.
    createSymlink(path.join(f.root, "new.md"), path.join(outside, "dangling"));
    // A bare repository has no `.git` folder, only git's own layout.
    const bare = scratch("lisa-unbound-bare-");
    writeFileSync(path.join(bare, "HEAD"), "ref: refs/heads/main\n");
    mkdirSync(path.join(bare, "objects"));
    mkdirSync(path.join(bare, "refs"));
    for (const file of [
      path.join(f.root, NOTE),
      path.join(f.root, "src/new.ts"),
      path.join(other, NOTE),
      path.join(other, ".git/hooks/pre-commit"),
      path.join(outside, "project", NOTE),
      path.join(outside, "dangling"),
      path.join(bare, "config"),
      path.join(bare, "hooks/pre-receive"),
      NOTE,
    ]) {
      const result = write(file);
      expect(result.status, file).toBe(2);
      expect(result.stderr, file).toContain(UNBOUND);
    }
    const scratchHunk = `*** Add File: ${path.join(outside, "a.md")}\n+a\n`;
    const projectFile = path.join(f.root, "b.md");
    // The patch tool trims each header, so an indented or CRLF header for a
    // project file is still applied and must still be seen.
    for (const header of [
      `*** Add File: ${projectFile}`,
      `   *** Add File: ${projectFile}`,
      `*** Add File: ${projectFile}\r`,
    ])
      expect(
        drive("apply_patch", {
          command: `*** Begin Patch\n${scratchHunk}${header}\n+b\n*** End Patch`,
        }).status,
        JSON.stringify(header)
      ).toBe(2);
    expect(drive("Write", { content: "x" }).status).toBe(2);
  });
});

describe("a bound task is unchanged", () => {
  it("does not admit a write outside every repository on the strength of this change", () => {
    const f = taskFixture(true);
    cleanup.push(f.root);
    // The fixture's prepared task requires a credential its provider refuses,
    // so a bound write is refused for that reason, wherever it lands.
    expect(f.run().status).toBe(2);
    const outside = scratch("lisa-bound-outside-");
    const hook = path.join(f.plugin, "hooks/secrets-preflight.sh");
    const result = boundedSpawnSync({
      label: "bound readiness hook",
      command: "/bin/bash",
      args: [hook, "--task-hook"],
      cwd: f.root,
      env: f.env,
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        cwd: f.root,
        tool_name: "Write",
        tool_input: { file_path: path.join(outside, NOTE), content: "x" },
      }),
    });
    expect(result.status).toBe(2);
    expect(result.stderr).not.toContain(UNBOUND);
  });
});

describe("preparing after the checkout is bound to a new ticket", () => {
  const NEW_REF = "fixture/project#2";

  /**
   * A fixture whose prepared context is for ticket #1.
   * @param boundTo - Ticket the checkout is bound to, or none
   * @returns The fixture root and task configuration
   */
  function preparedForFirst(boundTo?: string) {
    const f = taskFixture(true);
    cleanup.push(f.root);
    if (boundTo) {
      mkdirSync(path.join(f.root, ".git/lisa"), { recursive: true });
      writeFileSync(
        path.join(f.root, ".git/lisa/work-item.json"),
        JSON.stringify({
          version: 1,
          provider: "github",
          ref: boundTo,
          branch: null,
        })
      );
    }
    return { root: f.root, cfg: readConfig(f.root, SURFACE) };
  }

  const fresh = {
    requirements_complete: true,
    required_access: [],
    context_body: "# Ticket two\nIts full body.\n",
  };

  it("replaces the previous ticket's context with the new ticket's", () => {
    const { root, cfg } = preparedForFirst(NEW_REF);
    expect(prepareRequirements(cfg, NEW_REF, fresh)).toEqual({
      code: "requirements-prepared",
      body_preserved: false,
    });
    const context = readFileSync(path.join(root, CONTEXT), "utf8");
    expect(context).toContain(`"work_item_ref":"${NEW_REF}"`);
    expect(context.endsWith(fresh.context_body)).toBe(true);
  });

  it("still refuses when the checkout is not bound to the new ticket", () => {
    const { cfg } = preparedForFirst();
    expect(() => prepareRequirements(cfg, NEW_REF, fresh)).toThrow();
  });

  it("still refuses to replace a body for the same ticket", () => {
    const { cfg } = preparedForFirst("fixture/project#1");
    expect(() =>
      prepareRequirements(cfg, "fixture/project#1", fresh)
    ).toThrow();
  });

  it("never replaces a context that names no ticket", () => {
    const { root, cfg } = preparedForFirst(NEW_REF);
    writeFileSync(path.join(root, CONTEXT), "# A bundle with no header\n");
    expect(() => prepareRequirements(cfg, NEW_REF, fresh)).toThrow();
  });
});
