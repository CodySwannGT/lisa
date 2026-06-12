/**
 * Regression tests for edit-time lint hooks.
 *
 * The edit tier must stay fast: oxlint runs on each edit, while full ESLint is
 * reserved for pre-commit and CI chokepoints.
 * @module tests/unit/hooks/lint-on-edit
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const CODEX_HOOK_PATH = path.resolve("src/codex/scripts/lint-on-edit.sh");
const TYPESCRIPT_HOOK_PATH = path.resolve(
  "plugins/src/typescript/hooks/lint-on-edit.sh"
);
const BASH_PATH = "/bin/bash";
const EXAMPLE_SOURCE_RELATIVE_PATH = path.join("src", "example.ts");

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  tempDirs = [];
});

describe("lint-on-edit hooks", () => {
  it("runs oxlint, not ESLint, for Codex edit hooks", () => {
    const project = createProject();
    const sourcePath = path.join(project, EXAMPLE_SOURCE_RELATIVE_PATH);
    const result = spawnSync(BASH_PATH, [CODEX_HOOK_PATH], {
      cwd: project,
      encoding: "utf8",
      input: JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: sourcePath },
      }),
    });

    expect(result.status).toBe(0);
    expect(readLog(project)).toContain(`oxlint --quiet ${sourcePath}`);
    expect(readLog(project)).not.toContain("eslint");
  });

  it("runs oxlint, not ESLint, for TypeScript-stack edit hooks", () => {
    const project = createProject();
    const sourcePath = path.join(project, EXAMPLE_SOURCE_RELATIVE_PATH);
    const result = spawnSync(BASH_PATH, [TYPESCRIPT_HOOK_PATH], {
      cwd: project,
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: project },
      input: JSON.stringify({ tool_input: { file_path: sourcePath } }),
    });

    expect(result.status).toBe(0);
    expect(readLog(project)).toContain(`oxlint --quiet ${sourcePath}`);
    expect(readLog(project)).not.toContain("eslint");
  });

  it("treats oxlint zero-file matches as pass for Codex edit hooks", () => {
    const project = createProject({
      oxlintBody:
        'printf "No files found to lint\\nFinished in 3ms on 0 files with 159 rules\\n" >&2\nexit 1\n',
    });
    const sourcePath = path.join(project, EXAMPLE_SOURCE_RELATIVE_PATH);
    const result = spawnSync(BASH_PATH, [CODEX_HOOK_PATH], {
      cwd: project,
      encoding: "utf8",
      input: JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: sourcePath },
      }),
    });

    expect(result.status).toBe(0);
  });

  it("treats oxlint zero-file matches as pass for TypeScript-stack edit hooks", () => {
    const project = createProject({
      oxlintBody:
        'printf "No files found to lint\\nFinished in 3ms on 0 files with 159 rules\\n" >&2\nexit 1\n',
    });
    const sourcePath = path.join(project, EXAMPLE_SOURCE_RELATIVE_PATH);
    const result = spawnSync(BASH_PATH, [TYPESCRIPT_HOOK_PATH], {
      cwd: project,
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: project },
      input: JSON.stringify({ tool_input: { file_path: sourcePath } }),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Ignored by lint config");
  });
});

/**
 * Create a temp project with fake local linter binaries.
 * @param options - Fake binary configuration.
 * @param options.oxlintBody - Shell body for the fake oxlint binary.
 * @returns The temp project root.
 */
function createProject(options: { oxlintBody?: string } = {}): string {
  const project = mkdtempSync(path.join(tmpdir(), "lisa-lint-on-edit-"));
  tempDirs.push(project);
  mkdirSync(path.join(project, "src"), { recursive: true });
  mkdirSync(path.join(project, "node_modules", ".bin"), { recursive: true });
  writeFileSync(
    path.join(project, EXAMPLE_SOURCE_RELATIVE_PATH),
    "export const x = 1;\n"
  );
  writeFileSync(path.join(project, ".oxlintrc.json"), "{}\n");
  writeBin(
    project,
    "oxlint",
    options.oxlintBody ?? 'printf \'oxlint %s\\n\' "$*" >> "$PWD/lint.log"\n'
  );
  writeBin(
    project,
    "eslint",
    'printf \'eslint %s\\n\' "$*" >> "$PWD/lint.log"\nexit 42\n'
  );
  return project;
}

/**
 * Write an executable fake binary into node_modules/.bin.
 * @param project - Temp project root.
 * @param name - Binary name.
 * @param body - Shell body to run after the shebang.
 */
function writeBin(project: string, name: string, body: string): void {
  const binPath = path.join(project, "node_modules", ".bin", name);
  writeFileSync(binPath, `#!/usr/bin/env bash\n${body}`);
  chmodSync(binPath, 0o755);
}

/**
 * Read the fake linter invocation log.
 * @param project - Temp project root.
 * @returns The log content.
 */
function readLog(project: string): string {
  return readFileSync(path.join(project, "lint.log"), "utf8");
}
