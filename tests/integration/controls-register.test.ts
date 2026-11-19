/**
 * `lisa controls register`, run as the built command inside repositories Lisa
 * was never applied to.
 *
 * The unit suites run the command from source. This one runs the built
 * artifact with the fixture repository as its working directory, which is how
 * the configure step and a commit hook call it. It covers what the register
 * exists for: a file a generic validator accepts, the same bytes on every
 * run, and a check that fails by name when the file is edited by hand
 * (CodySwannGT/lisa#4983).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  controlAuditGitEnv,
  type ControlAuditFixture,
} from "../helpers/control-audit-fixtures.js";
import {
  DECLARED_FIXTURES,
  buildDeclaredFixture,
  registerSchemaErrors,
  type DeclaredFixtureName,
} from "../helpers/control-register.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "index.js");
const REGISTER = ".lisa/controls/register.json";

const fixtures: ControlAuditFixture[] = [];

/**
 * Build a fixture with its gates declaration, removed after the case.
 * @param name - Which fixture
 * @returns The repository root
 */
function repository(name: DeclaredFixtureName): string {
  const built = buildDeclaredFixture(name);
  fixtures.push(built);
  return built.repoPath;
}

/**
 * Run the built command from inside a repository, with no path argument.
 * @param repoPath - The repository to stand in
 * @param flags - Flags after `register`
 * @returns Exit status and both streams
 */
function register(
  repoPath: string,
  flags: readonly string[] = []
): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const child = boundedSpawnSync({
    label: "lisa controls register (built CLI in a fixture)",
    command: process.execPath,
    args: [DIST_CLI, "controls", "register", ...flags],
    cwd: repoPath,
    env: { ...controlAuditGitEnv(), LISA_SKIP_UPDATE_CHECK: "1" },
  });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

/**
 * Read the register a repository holds.
 * @param repoPath - The repository root
 * @returns The file content
 */
function registerText(repoPath: string): string {
  return readFileSync(path.join(repoPath, REGISTER), "utf8");
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("built lisa controls register in a repository without Lisa", () => {
  it.each(DECLARED_FIXTURES)(
    "writes a register for %s that the published schema accepts, the same bytes twice",
    name => {
      const repoPath = repository(name);

      const first = register(repoPath);
      const written = registerText(repoPath);
      const second = register(repoPath);

      expect(first.stderr).toBe("");
      expect(first.status).toBe(0);
      expect(registerSchemaErrors(JSON.parse(written))).toEqual([]);
      expect(second.status).toBe(0);
      expect(registerText(repoPath)).toBe(written);
      expect(register(repoPath, ["--check"]).status).toBe(0);
    }
  );

  it("fails the check on a hand edit, naming the entry, and regenerating restores the file", () => {
    const repoPath = repository("F-mixed");
    register(repoPath);
    const generated = registerText(repoPath);
    writeFileSync(
      path.join(repoPath, REGISTER),
      generated.replace('"ruff"', '"true"')
    );

    const check = register(repoPath, ["--check"]);
    const rewrite = register(repoPath);

    expect(check.status).toBe(1);
    expect(check.stdout).toBe("");
    expect(check.stderr.split("\n")[0]).toBe(
      `The entry "code-style@api" in ${REGISTER} does not match the gates declaration: measuring_mechanism differs.`
    );
    expect(check.stderr).toContain('run "lisa controls register"');
    expect(rewrite.status).toBe(0);
    expect(registerText(repoPath)).toBe(generated);
  });
});
