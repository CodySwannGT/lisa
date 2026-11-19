/**
 * The gate registry's command line, on a declaration that uses `parts`.
 *
 * `validate` and `list` are what an operator runs to check a declaration, and
 * what every hook and workflow reads. This drives the real script against a
 * real settings file in a throwaway repository with no `package.json`, so the
 * verdict is the one a repository on any stack would get.
 * @module tests/unit/scripts/lisa-gates-parts-cli
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);
const GATES = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-gates.mjs"
);

/** Wall-clock ceiling for one CLI invocation. */
const CLI_TIMEOUT_MS = 30_000;

/** The flag that asks `list` about the commit moment. */
const AT_COMMIT = "--moment=commit";

/** A gate proved by one command per folder. */
const TWO_PARTS = {
  "x-lint": {
    commit: "required",
    criteria: ["SI7"],
    owner: "Platform team",
    tier: "advisory",
    parts: [
      { scope: "api", command: ["go", "vet", "./..."] },
      { scope: "web", command: ["npm", "run", "lint"] },
    ],
  },
};

describe("lisa-gates.mjs on a declaration with parts", () => {
  let directory = "";

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-gates-parts-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  /**
   * Run the registry in the throwaway repository.
   * @param gates - The gates block to declare
   * @param args - The subcommand and its flags
   * @returns The exit status and both output streams
   */
  const run = (
    gates: Record<string, unknown>,
    args: readonly string[]
  ): { status: number | null; stdout: string; stderr: string } => {
    fs.writeFileSync(
      path.join(directory, ".lisa.config.json"),
      JSON.stringify({ gates }, null, 2)
    );
    const result = spawnSync(process.execPath, [GATES, ...args], {
      cwd: directory,
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
    });
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };

  it("validate accepts two parts with different scopes", () => {
    const result = run(TWO_PARTS, ["validate"]);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("gates and policy: configuration is valid");
  });

  it("validate refuses a command written as one string, naming gate and key", () => {
    const result = run(
      {
        "x-lint": {
          commit: "required",
          parts: [{ scope: "api", command: "go vet ./..." }],
        },
      },
      ["validate"]
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gates."x-lint".parts[0].command');
    expect(result.stderr).toContain("Invalid gates configuration:");
    expect(result.stdout).not.toContain("configuration is valid");
  });

  it("validate refuses a scope that leaves the repository", () => {
    const result = run(
      {
        "x-lint": {
          commit: "required",
          parts: [{ scope: "../other", command: ["go", "vet"] }],
        },
      },
      ["validate"]
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'gates."x-lint".parts[0].scope is "../other"'
    );
    expect(result.stderr).toContain("Invalid gates configuration:");
  });

  it("list --json returns one entry per part with its scope and argv", () => {
    const result = run(TWO_PARTS, ["list", AT_COMMIT, "--json"]);
    const resolved = JSON.parse(result.stdout) as {
      id: string;
      scope: string;
      argv: string[];
      command: string | null;
    }[];

    expect(result.status).toBe(0);
    expect(resolved.map(entry => [entry.id, entry.scope, entry.argv])).toEqual([
      ["x-lint", "api", ["go", "vet", "./..."]],
      ["x-lint", "web", ["npm", "run", "lint"]],
    ]);
    expect(resolved.map(entry => entry.command)).toEqual([null, null]);
  });

  it("list prints each part's folder and argument list, not NO PROVER", () => {
    const result = run(TWO_PARTS, ["list", AT_COMMIT]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('in api: ["go","vet","./..."]');
    expect(result.stdout).toContain('in web: ["npm","run","lint"]');
    expect(result.stdout).not.toContain("NO PROVER");
  });

  it("list refuses a malformed part instead of resolving it", () => {
    const result = run(
      {
        "x-lint": {
          commit: "required",
          parts: [{ scope: "api", command: "go vet ./..." }],
        },
      },
      ["list", AT_COMMIT, "--json"]
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('gates."x-lint".parts[0].command');
  });
});
