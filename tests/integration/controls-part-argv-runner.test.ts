/**
 * The shipped gate runner on a repository whose gate declares parts.
 *
 * The real command line, started in a real repository with two parts in
 * separate folders. What is proved here is what an operator sees and what the
 * hook acts on: one line per folder, an exit code that blocks when any folder
 * went unproved, and nothing in the declaration ever read by a shell.
 * @module tests/integration/controls-part-argv-runner
 */
import { type SpawnSyncReturns } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT } from "../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  buildFMixed,
  type ControlAuditFixture,
  runControlAuditGit,
} from "../helpers/control-audit-fixtures.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

const RUNNER_SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../all/copy-overwrite/scripts/lisa-run-gates.mjs"
);

const NODE = process.execPath;
/** One of the checks the commit hook proves on its own unless told otherwise. */
const GATE = "code-style";
const COMMIT = "commit";

/** The file a part's program leaves behind to say it ran, and where. */
const RECEIVED = "received.json";

/** Records the arguments the program was given and the folder it started in. */
const RECORD =
  "require('node:fs').writeFileSync('received.json', " +
  "JSON.stringify({ args: process.argv.slice(1), cwd: process.cwd() }))";

/** A program name nothing on this machine answers to. */
const MISSING_PROGRAM = "lisa-no-such-program-4986";

/** Text a shell would act on, and that no part's command may ever run. */
const SHELL_SYNTAX = ["; touch pwned", "$(touch pwned)", "`touch pwned`"];

/** How the failing part's program prints a measured failure. */
const FAILURE_SHAPE = "lint problems found";

/** One part of a gate, as the project declares it. */
interface DeclaredPart {
  readonly scope: string;
  readonly command: unknown;
  readonly proof?: { readonly failure_shape: readonly string[] };
}

/** A fixture repository and one run of the gate runner in it. */
interface RunnerRun {
  readonly fixture: ControlAuditFixture;
  readonly child: SpawnSyncReturns<string>;
  /** The gate ids the runner told the hook it proved. */
  readonly proved: string[];
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build a two-folder repository declaring one gate with the given parts.
 * @param parts - The gate's parts
 * @returns The repository, and where the runner should write what it proved
 */
function declaring(parts: readonly DeclaredPart[]): {
  fixture: ControlAuditFixture;
  coverage: string;
} {
  const config = { gates: { [GATE]: { [COMMIT]: "required", parts } } };
  const fixture = buildFMixed({
    extraFiles: { ".lisa.config.json": `${JSON.stringify(config, null, 2)}\n` },
  });
  const scratch = mkdtempSync(path.join(tmpdir(), "lisa-part-runner-"));
  cleanups.push(fixture.cleanup, () =>
    rmSync(scratch, { force: true, recursive: true })
  );
  return { coverage: path.join(scratch, "coverage"), fixture };
}

/**
 * Run the shipped gate runner at commit, the way the commit hook does.
 * @param repoPath - The repository root
 * @param coverage - The file the runner writes the gates it proved to
 * @returns The finished run and the gates it reported as proved
 */
function runAtCommit(
  repoPath: string,
  coverage: string
): Pick<RunnerRun, "child" | "proved"> {
  const child = boundedSpawnSync({
    label: "lisa-run-gates.mjs --moment=commit on a gate with parts",
    command: NODE,
    args: [RUNNER_SCRIPT, `--moment=${COMMIT}`, `--coverage=${coverage}`],
    cwd: repoPath,
  });
  const proved = existsSync(coverage)
    ? readFileSync(coverage, "utf8").split("\n").filter(Boolean)
    : [];
  return { child, proved };
}

/**
 * Declare one gate with the given parts in a fresh repository and run the
 * gate runner there.
 * @param parts - The gate's parts
 * @param prepare - Changes to make to the repository before the run
 * @returns The repository and the finished run
 */
function runWithParts(
  parts: readonly DeclaredPart[],
  prepare: (fixture: ControlAuditFixture) => void = () => {}
): RunnerRun {
  const { coverage, fixture } = declaring(parts);
  prepare(fixture);
  return { fixture, ...runAtCommit(fixture.repoPath, coverage) };
}

/**
 * What a part's program recorded, read back from its folder.
 * @param fixture - The repository
 * @param scope - The part's folder
 * @returns The arguments it was given and the folder it started in
 */
function received(
  fixture: ControlAuditFixture,
  scope: string
): { args: string[]; cwd: string } {
  return JSON.parse(
    readFileSync(path.join(fixture.repoPath, scope, RECEIVED), "utf8")
  ) as { args: string[]; cwd: string };
}

/**
 * Every file the run left in the repository that git does not track.
 * @param fixture - The repository
 * @returns Repository-relative paths
 */
function leftBehind(fixture: ControlAuditFixture): string[] {
  return runControlAuditGit(fixture.repoPath, [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ])
    .split("\n")
    .filter(Boolean)
    .map(line => line.slice(3));
}

describe.skipIf(process.platform === "win32")(
  "the gate runner on a gate with parts",
  () => {
    it("starts each part in its own folder and reports each on its own line", () => {
      const { child, fixture, proved } = runWithParts([
        { scope: "api", command: [NODE, "-e", RECORD, "api-argument"] },
        { scope: "web", command: [NODE, "-e", RECORD, "web-argument"] },
      ]);

      expect(child.status).toBe(EXIT.PROVED);
      expect(received(fixture, "api")).toEqual({
        args: ["api-argument"],
        cwd: path.join(fixture.repoPath, "api"),
      });
      expect(received(fixture, "web")).toEqual({
        args: ["web-argument"],
        cwd: path.join(fixture.repoPath, "web"),
      });
      expect(child.stdout).toMatch(/PASSED\s+required\s+code-style in api /u);
      expect(child.stdout).toMatch(/PASSED\s+required\s+code-style in web /u);
      expect(child.stdout).toContain("2 proved");
      // Both folders passed, so the hook's own style check may stand down.
      expect(proved).toEqual([GATE]);
    });

    it("hands shell syntax to the program as text and runs none of it", () => {
      const { child, fixture } = runWithParts([
        { scope: "api", command: [NODE, "-e", RECORD, ...SHELL_SYNTAX] },
      ]);

      expect(child.status).toBe(EXIT.PROVED);
      expect(received(fixture, "api").args).toEqual(SHELL_SYNTAX);
      // The one file the program itself wrote, and nothing named `pwned`.
      expect(leftBehind(fixture)).toEqual([`api/${RECEIVED}`]);
    });

    it("blocks when one folder fails, and says which", () => {
      const { child, proved } = runWithParts([
        { scope: "api", command: [NODE, "-e", "process.exit(0)"] },
        {
          scope: "web",
          command: [
            NODE,
            "-e",
            `console.log(${JSON.stringify(FAILURE_SHAPE)}); process.exit(1)`,
          ],
          proof: { failure_shape: [FAILURE_SHAPE] },
        },
      ]);

      expect(child.status).toBe(EXIT.BLOCKED);
      expect(child.stdout).toMatch(/PASSED\s+required\s+code-style in api /u);
      expect(child.stdout).toContain(
        "required gate FAILED: code-style in web — "
      );
      expect(child.stdout).not.toContain("FAILED: code-style in api");
      // One folder failed, so the hook's own style check still runs.
      expect(proved).toEqual([]);
    });

    it("blocks on a program that is not installed, and names it", () => {
      const { child } = runWithParts([
        { scope: "api", command: [MISSING_PROGRAM, "check"] },
      ]);

      expect(child.status).toBe(EXIT.BLOCKED);
      expect(child.stdout).toContain("gate NOT PROVED: code-style in api");
      expect(child.stdout).toContain(`"${MISSING_PROGRAM}" was not found`);
      expect(child.stdout).not.toContain("PASSED");
    });

    it("blocks on a folder that is a link out of the repository, and starts nothing there", () => {
      const outside = mkdtempSync(path.join(tmpdir(), "lisa-part-outside-"));
      cleanups.push(() => rmSync(outside, { force: true, recursive: true }));

      const { child } = runWithParts(
        [{ scope: "elsewhere", command: [NODE, "-e", RECORD] }],
        fixture =>
          symlinkSync(outside, path.join(fixture.repoPath, "elsewhere"), "dir")
      );

      expect(child.status).toBe(EXIT.BLOCKED);
      expect(child.stdout).toContain("leads outside this repository");
      expect(existsSync(path.join(outside, RECEIVED))).toBe(false);
    });

    it.each([";", "|", "&&", "`"])(
      "refuses to run a command written as one string holding %s",
      separator => {
        const { child, fixture } = runWithParts([
          { scope: "api", command: `true ${separator} touch pwned` },
        ]);

        expect(child.status).toBe(EXIT.BLOCKED);
        expect(child.stderr).toContain("the gate configuration is INVALID");
        expect(child.stderr).toContain("never through a shell");
        expect(leftBehind(fixture)).toEqual([]);
      }
    );
  }
);
