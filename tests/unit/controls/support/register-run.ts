/**
 * Running `lisa controls register` in-process against fixture repositories,
 * for the suites that check what it writes and what it refuses
 * (CodySwannGT/lisa#4983).
 * @module tests/unit/controls/support/register-run
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { runRegister } from "../../../../src/controls/commands/register.js";
import { CONTROL_REGISTER_PATH } from "../../../../src/controls/register-types.js";
import {
  buildDeclaredFixture,
  type DeclaredFixtureName,
  type GatesBlock,
} from "../../../helpers/control-register.js";
import { keep, type Run } from "./report-check-run.js";

/**
 * Run the command in-process and capture what it prints.
 * @param target - The path argument, as an operator would type it
 * @param check - Whether to pass `--check`
 * @param cwd - The directory the command is run from
 * @returns Exit code and printed lines
 */
export async function register(
  target: string | undefined,
  check = false,
  cwd?: string
): Promise<Run> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runRegister(
    target,
    { check },
    {
      ...(cwd === undefined ? {} : { cwd }),
      stdout: line => {
        stdout.push(line);
      },
      stderr: line => {
        stderr.push(line);
      },
    }
  );
  return { code, stdout, stderr };
}

/**
 * Build a fixture with a gates declaration, removed after the case.
 * @param name - Which fixture
 * @param gates - The declaration; the fixture's own by default
 * @returns The repository root
 */
export function declared(
  name: DeclaredFixtureName,
  gates?: GatesBlock
): string {
  return keep(buildDeclaredFixture(name, gates)).repoPath;
}

/**
 * Read the register a repository holds.
 * @param repoPath - The repository root
 * @returns The file content
 */
export function readRegister(repoPath: string): string {
  return readFileSync(path.join(repoPath, CONTROL_REGISTER_PATH), "utf8");
}

/**
 * Replace the register a repository holds, as a hand edit would.
 * @param repoPath - The repository root
 * @param text - The new file content
 */
export function writeRegister(repoPath: string, text: string): void {
  writeFileSync(path.join(repoPath, CONTROL_REGISTER_PATH), text);
}

/**
 * Edit the register a repository holds as parsed JSON, keeping its form.
 * @param repoPath - The repository root
 * @param edit - Changes the parsed register in place
 */
export function editRegister(
  repoPath: string,
  edit: (document: {
    entries: Record<string, unknown>[];
    [key: string]: unknown;
  }) => void
): void {
  const document = JSON.parse(readRegister(repoPath)) as {
    entries: Record<string, unknown>[];
  };
  edit(document);
  writeRegister(repoPath, `${JSON.stringify(document, null, 2)}\n`);
}
