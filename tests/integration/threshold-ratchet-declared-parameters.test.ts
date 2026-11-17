/**
 * The shipped threshold check, run in a repository on no supported stack,
 * refuses a change that loosens a declared threshold (CodySwannGT/lisa#4985).
 *
 * The unit suites prove the comparison. This one proves the thing a host
 * actually has: the three files Lisa ships to every repository under
 * `scripts/`, started with `node` and nothing else, in a repository with no
 * `package.json` and no threshold file of any kind. It runs them the three
 * ways they are run — against a base commit, against what is staged, and as
 * the coding agent's after-edit hook — and it walks the reviewed exception
 * from both sides: one that was merged before the loosening, and one the
 * loosening tries to bring along.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildFNone,
  controlAuditGitEnv,
  runControlAuditGit,
  type ControlAuditFixture,
} from "../helpers/control-audit-fixtures.js";
import {
  COVERAGE_FLOOR,
  COVERAGE_GATE,
  LISA_CONFIG_FILE,
  configText,
  gateOf,
  part,
  thresholdKey,
} from "../helpers/declared-thresholds.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Where Lisa keeps the files it ships to every repository, whatever its stack. */
const SHIPPED_DIR = path.join(REPO_ROOT, "all", "copy-overwrite", "scripts");

/** The check and the two files it imports from beside itself. */
const SHIPPED = [
  "check-threshold-ratchet.mjs",
  "threshold-ratchet-compare.mjs",
  "threshold-ratchet-families.mjs",
] as const;

const CHECK = "scripts/check-threshold-ratchet.mjs";

/** What every refusal of the 60 to 55 change says. */
const LOWERED = "was lowered from 60 to 55";

const fixtures: ControlAuditFixture[] = [];

/**
 * A `.lisa.config.json` declaring the coverage floor for the whole repository.
 * @param value - The floor
 * @param rest - Other top-level keys of the file
 * @returns The file content
 */
function declaring(
  value: number,
  rest: Readonly<Record<string, unknown>> = {}
): string {
  return configText(
    {
      [COVERAGE_GATE]: gateOf(
        part(".", { [COVERAGE_FLOOR]: { value, direction: "floor" } })
      ),
    },
    rest
  );
}

/**
 * Build a repository on no supported stack that holds the shipped check and a
 * declaration, in one commit.
 * @param config - The `.lisa.config.json` it starts with
 * @returns The repository root
 */
function host(config: string): string {
  const shipped = Object.fromEntries(
    SHIPPED.map(name => [
      `scripts/${name}`,
      readFileSync(path.join(SHIPPED_DIR, name), "utf8"),
    ])
  );
  const built = buildFNone({
    extraFiles: { ...shipped, [LISA_CONFIG_FILE]: config },
  });
  fixtures.push(built);
  return built.repoPath;
}

/**
 * Rewrite the declaration in the working tree.
 * @param repoPath - The repository root
 * @param config - The new file content
 */
function edit(repoPath: string, config: string): void {
  writeFileSync(path.join(repoPath, LISA_CONFIG_FILE), config);
}

/**
 * Rewrite the declaration and commit it.
 * @param repoPath - The repository root
 * @param config - The new file content
 */
function commit(repoPath: string, config: string): void {
  edit(repoPath, config);
  runControlAuditGit(repoPath, ["add", "--all"]);
  runControlAuditGit(repoPath, ["commit", "--quiet", "--message", "change"]);
}

/**
 * Run the shipped check from the repository root.
 * @param repoPath - The repository root
 * @param args - Its arguments
 * @param input - What to write to its stdin; nothing unless given
 * @returns Exit status and both streams
 */
function check(
  repoPath: string,
  args: readonly string[],
  input = ""
): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const child = boundedSpawnSync({
    label: "shipped threshold check in a repository on no supported stack",
    command: process.execPath,
    args: [CHECK, ...args],
    cwd: repoPath,
    env: controlAuditGitEnv(),
    input,
  });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

/**
 * A day some weeks from now, so an exception written with it is still live
 * whenever the suite runs.
 * @returns The day as `YYYY-MM-DD`
 */
function aDayStillAhead(): string {
  return new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
}

/**
 * An exception entry for the coverage floor of the whole repository.
 * @returns The `thresholdRatchet` block
 */
function exception(): Readonly<Record<string, unknown>> {
  return {
    thresholdRatchet: {
      allow: [
        {
          file: LISA_CONFIG_FILE,
          key: thresholdKey(COVERAGE_GATE, "."),
          reason: "Coverage tool being replaced; resolved when it lands.",
          until: aDayStillAhead(),
        },
      ],
    },
  };
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("the shipped threshold check in a repository on no supported stack", () => {
  it("refuses a commit that lowers a declared floor, naming the parameter", () => {
    const repoPath = host(declaring(60));
    commit(repoPath, declaring(55));

    const result = check(repoPath, ["--base", "HEAD^"]);

    // The premise: nothing here but the three shipped files and `node`.
    expect(existsSync(path.join(repoPath, "package.json"))).toBe(false);
    expect(existsSync(path.join(repoPath, "node_modules"))).toBe(false);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("blocked by the threshold ratchet");
    expect(result.stderr).toContain(
      `the floor "${COVERAGE_FLOOR}" of the ${COVERAGE_GATE} gate, for the whole repository, was lowered from 60 to 55`
    );
    expect(result.stderr).toContain(
      `"key": "${thresholdKey(COVERAGE_GATE, ".")}"`
    );
  });

  it("accepts a commit that raises it", () => {
    const repoPath = host(declaring(60));
    commit(repoPath, declaring(65));

    const result = check(repoPath, ["--base", "HEAD^"]);

    expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("accepts the commit that declares thresholds for the first time", () => {
    const repoPath = host('{ "tracker": "github" }\n');
    commit(repoPath, declaring(1));

    expect(check(repoPath, ["--base", "HEAD^"]).status).toBe(0);
  });

  it("refuses a commit that deletes the file the floor was declared in", () => {
    const repoPath = host(declaring(60));
    runControlAuditGit(repoPath, ["rm", "--quiet", LISA_CONFIG_FILE]);
    runControlAuditGit(repoPath, ["commit", "--quiet", "--message", "delete"]);

    const result = check(repoPath, ["--base", "HEAD^"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`because ${LISA_CONFIG_FILE} was deleted`);
  });

  it("refuses a lowered floor before it is committed", () => {
    const repoPath = host(declaring(60));
    edit(repoPath, declaring(55));
    runControlAuditGit(repoPath, ["add", "--all"]);

    const result = check(repoPath, ["--staged"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(LOWERED);
  });

  it("tells the coding agent as soon as it lowers the floor", () => {
    const repoPath = host(declaring(60));
    edit(repoPath, declaring(55));

    const result = check(
      repoPath,
      ["--hook"],
      JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: path.join(repoPath, LISA_CONFIG_FILE) },
      })
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(LOWERED);
  });
});

describe("a deliberate loosening of a declared threshold", () => {
  it("passes once its exception was merged in an earlier change", () => {
    const repoPath = host(declaring(60));
    commit(repoPath, declaring(60, exception()));
    commit(repoPath, declaring(55, exception()));

    const result = check(repoPath, ["--base", "HEAD^"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      `allowed by thresholdRatchet.allow entry ${LISA_CONFIG_FILE} → ${thresholdKey(COVERAGE_GATE, ".")} (key-scoped)`
    );
    expect(result.stdout).toContain(LOWERED);
  });

  it("is refused when the exception arrives in the same change", () => {
    const repoPath = host(declaring(60));
    commit(repoPath, declaring(55, exception()));

    const result = check(repoPath, ["--base", "HEAD^"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(LOWERED);
    expect(result.stderr).toContain("new threshold exception");
  });

  it("is refused for adding the exception on its own, which a person clears", () => {
    const repoPath = host(declaring(60));
    commit(repoPath, declaring(60, exception()));

    const result = check(repoPath, ["--base", "HEAD^"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("new threshold exception");
    expect(result.stderr).not.toContain("was lowered");
  });
});
