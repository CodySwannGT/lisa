/**
 * Unit tests for all/copy-overwrite/scripts/check-conflict-markers.mjs (#2552).
 *
 * The headline case is PR #2548: six generated parity `SKILL.md` files were
 * committed with literal `<<<<<<< HEAD` conflict blocks and passed every gate,
 * because the parity gate greps for a pin *value* (which sat inside the
 * conflict block), the test suite never parses skill markdown, and the
 * generated-vs-source comparison passed since both sides were broken the same
 * way. This script is the gate that reads the bytes.
 *
 * Detection deliberately requires the COMPLETE ordered marker triple. A lone
 * `<<<<<<<` line is left alone because prose that documents a merge conflict is
 * legitimate content — a gate that fires on files it should not read is its own
 * outage. Marker literals below are built as quoted strings so this very test
 * file is not flagged by the gate it tests.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/scripts/check-conflict-markers
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
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import {
  findConflictBlocks,
  parseArgs,
} from "../../../all/copy-overwrite/scripts/check-conflict-markers.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils";
import { resolveGit } from "../../support/git-executable.js";

const SCRIPT = path.resolve(
  "all/copy-overwrite/scripts/check-conflict-markers.mjs"
);
const GIT = resolveGit();
const ADD_ALL = ["add", "-A"] as const;

const START = "<<<<<<< HEAD";
const BASE = "||||||| merged common ancestor";
const SEP = "=======";
const END = ">>>>>>> feature-branch";

/** The exact #2548 shape: a conflicted blockquote inside a parity SKILL.md. */
const SKILL_WITH_MARKERS = [
  "---",
  "name: lisa-parity-safety-net-rules",
  "synced-from: safety-net@cc-marketplace@2.0.4",
  "---",
  "",
  "> **2.0.4 review.**",
  START,
  "> hash the sorted (path, content) manifest of every rule-bearing directory.",
  SEP,
  "> Upstream 2.0.3-2.0.4 changed three things.",
  END,
  "",
].join("\n");

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/**
 * Create a temporary git repository with `files` written and committed.
 *
 * @param files - relative path to file contents.
 * @returns The absolute repository root.
 */
function tempRepo(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-2552-"));
  const env = cleanGitEnv(process.env);
  const entries = Object.entries(files);
  const git = (...args: readonly string[]): void => {
    boundedExecFileSync({
      label: `git ${args[0] ?? ""}`,
      command: GIT,
      args,
      cwd: root,
      env,
      stdio: "ignore",
    });
  };
  roots.push(root);
  for (const [relative, content] of entries) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  if (entries.length > 0) {
    git(...ADD_ALL);
    git("commit", "-q", "-m", "seed");
  }
  return root;
}

/**
 * Run the CLI and capture its exit code plus combined output.
 *
 * @param args - CLI arguments after the script path.
 * @param cwd - Working directory to run from (defaults to this process's).
 * @returns The exit code and stdout text.
 */
function run(
  args: readonly string[],
  cwd?: string
): { code: number; stdout: string } {
  try {
    const stdout = boundedExecFileSync({
      label: "check-conflict-markers.mjs",
      command: process.execPath,
      args: [SCRIPT, ...args],
      cwd,
    });
    return { code: 0, stdout };
  } catch (error) {
    const e = error as { exitCode?: number; stdout?: string };
    return {
      code: typeof e.exitCode === "number" ? e.exitCode : -1,
      stdout: e.stdout ?? "",
    };
  }
}

describe("findConflictBlocks", () => {
  it("finds a complete git conflict block and reports 1-based line numbers", () => {
    const content = ["alpha", START, "ours", SEP, "theirs", END, "omega"].join(
      "\n"
    );
    expect(findConflictBlocks(content)).toEqual([
      { endLine: 6, separatorLine: 4, startLine: 2 },
    ]);
  });

  it("accepts the diff3 base marker between the start and the separator", () => {
    const content = [START, "ours", BASE, "base", SEP, "theirs", END].join(
      "\n"
    );
    expect(findConflictBlocks(content)).toEqual([
      { endLine: 7, separatorLine: 5, startLine: 1 },
    ]);
  });

  it("finds every block in a file, not just the first", () => {
    const block = [START, "ours", SEP, "theirs", END];
    expect(
      findConflictBlocks([...block, "between", ...block].join("\n"))
    ).toHaveLength(2);
  });

  it("ignores a lone start marker with no separator or terminator", () => {
    expect(
      findConflictBlocks([START, "ours", "no end here"].join("\n"))
    ).toEqual([]);
  });

  it("ignores a lone terminator with no opening marker", () => {
    expect(findConflictBlocks(["text", SEP, END].join("\n"))).toEqual([]);
  });

  it("ignores a markdown setext heading underline of seven equals", () => {
    expect(findConflictBlocks(["Heading", SEP, "body"].join("\n"))).toEqual([]);
  });

  it("ignores markers that are not at the start of a line", () => {
    const content = [`  ${START}`, `  ${SEP}`, `  ${END}`].join("\n");
    expect(findConflictBlocks(content)).toEqual([]);
  });

  it("ignores markers of one width around a separator of another", () => {
    // Renamed with the matchers (CodySwannGT/lisa#2958). It used to read
    // "ignores a run of more than seven angle brackets", and it passed because
    // seven was hard-coded — which also meant the 32-character markers git
    // writes under `conflict-marker-size` were ignored, live and unresolved.
    //
    // The case still passes and now for the reason that was always the real
    // one: eight-character markers around a SEVEN-character separator are not
    // one block, because git writes a single width per block. Keeping it is
    // what stops the widening from turning a document that quotes a marker and
    // later rules a line of `=` into a finding.
    const content = ["<<<<<<<<", "ours", SEP, "theirs", ">>>>>>>>"].join("\n");
    expect(findConflictBlocks(content)).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    const content = [START, "ours", SEP, "theirs", END].join("\r\n");
    expect(findConflictBlocks(content)).toHaveLength(1);
  });

  it("returns nothing for clean content", () => {
    expect(findConflictBlocks("nothing to see here\n")).toEqual([]);
  });
});

describe("check-conflict-markers CLI", () => {
  it("exits 0 for a clean tracked tree", () => {
    const root = tempRepo({ "README.md": "# clean\n" });
    expect(run(["--root", root]).code).toBe(0);
  });

  it("catches the #2548 shape: markers inside a generated parity SKILL.md", () => {
    const skill = "plugins/lisa/skills/lisa-parity-safety-net-rules/SKILL.md";
    const root = tempRepo({ [skill]: SKILL_WITH_MARKERS });
    const { code, stdout } = run(["--root", root]);
    expect(code).toBe(1);
    expect(stdout).toContain(skill);
    expect(stdout).toContain("line 7");
  });

  it("reports every offending file in the machine-readable report", () => {
    const root = tempRepo({
      "a.md": [START, "x", SEP, "y", END].join("\n"),
      "b.md": [START, "x", SEP, "y", END].join("\n"),
      "clean.md": "fine\n",
    });
    const { code, stdout } = run(["--root", root, "--json"]);
    expect(code).toBe(1);
    const report = JSON.parse(stdout) as {
      summary: { conflicted: number; scanned: number };
      results: readonly { file: string }[];
    };
    expect(report.summary.conflicted).toBe(2);
    expect(
      report.results.map(r => r.file).sort((a, b) => a.localeCompare(b))
    ).toEqual(["a.md", "b.md"]);
  });

  it("ignores untracked files so a scratch file cannot block a push", () => {
    const root = tempRepo({ "README.md": "# clean\n" });
    writeFileSync(
      path.join(root, "scratch.md"),
      [START, "x", SEP, "y", END].join("\n"),
      "utf8"
    );
    expect(run(["--root", root]).code).toBe(0);
  });

  it("skips binary files instead of decoding them as text", () => {
    const root = tempRepo({ "README.md": "# clean\n" });
    writeFileSync(
      path.join(root, "blob.bin"),
      Buffer.from([0x00, 0x01, 0x00, 0x02])
    );
    const env = cleanGitEnv(process.env);
    boundedExecFileSync({
      label: "git add -A",
      command: GIT,
      args: ADD_ALL,
      cwd: root,
      env,
      stdio: "ignore",
    });
    boundedExecFileSync({
      label: "git commit",
      command: GIT,
      args: ["commit", "-q", "-m", "blob"],
      cwd: root,
      env,
      stdio: "ignore",
    });
    expect(run(["--root", root]).code).toBe(0);
  });

  it("exits 2 on an unknown flag", () => {
    expect(run(["--bogus"]).code).toBe(2);
  });

  it("exits 2 when a flag is missing its value", () => {
    expect(run(["--root"]).code).toBe(2);
    expect(() => parseArgs(["--root"])).toThrowError("--root requires a value");
  });

  it("exits 2 when --root is not a directory", () => {
    expect(run(["--root", path.join(tmpdir(), "lisa-2552-absent")]).code).toBe(
      2
    );
  });

  it("exits 2 when --root is not a git repository", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-2552-nogit-"));
    roots.push(root);
    expect(run(["--root", root]).code).toBe(2);
  });
});

describe("the default root is the working directory", () => {
  // Load-bearing, not stylistic. This file is a copy-overwrite template: Lisa
  // holds it at `all/copy-overwrite/scripts/`, installs it at `scripts/` in a
  // consumer, and ships it inside the package under `node_modules/`. A default
  // derived from the file's own location resolves to a DIFFERENT directory on
  // each of those, and the failure is silent in the worst direction — running
  // `git ls-files` inside a subdirectory SUCCEEDS and lists only what is under
  // it, so the gate would report a clean scan of forty files having never
  // looked at the project. There is no flag to forget here, which is the point.
  it("finds markers in the directory it was run from, with no --root", () => {
    const root = tempRepo({ "notes.md": SKILL_WITH_MARKERS });
    const { code, stdout } = run([], root);
    expect(code).toBe(1);
    expect(stdout).toContain("notes.md");
  });

  it("does not read the directory the script itself lives in", () => {
    // The pre-move default was `<script dir>/..`. Against a clean fixture repo
    // that resolved outside it entirely, so this asserts the scan is scoped to
    // the fixture: its own file count, not Lisa's several thousand.
    const root = tempRepo({ "README.md": "# clean\n" });
    const { code, stdout } = run(["--json"], root);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).root).toBe(realpathSync(root));
  });
});

describe("the Lisa repository itself is marker-free", () => {
  it("exits 0 against the real tracked tree", () => {
    expect(run([]).code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #3888: a guard that reports OK when its comparison had no subject.
//
// The cwd-anchored default (above) closes the case where the enumeration is
// scoped to a SUBDIRECTORY. It never closed the case where the enumeration
// returns NOTHING. `git ls-files` inside a repository with no tracked paths
// succeeds and prints nothing, so the scan loop ran zero times and the gate
// printed `✓ no leftover conflict markers in 0 tracked files`, exit 0 — the
// count was in hand and nothing read it. `conflict-residue` is a REQUIRED push
// gate, so that green is a merge-governing statement about bytes nobody read.
//
// Bite: against the pre-fix source this case fails on the first assertion with
// `expected 0 to be 2`, which is the whole defect in one line.
// ---------------------------------------------------------------------------
describe("zero tracked files is an operational failure, not a clean scan", () => {
  it("exits 2 rather than reporting a clean scan of nothing", () => {
    const root = tempRepo({});

    const { code, stdout } = run(["--root", root]);

    expect(code).toBe(2);
    expect(stdout).not.toContain("no leftover conflict markers");
  });

  it("says so in --json mode too, rather than emitting a zero-scan report", () => {
    const root = tempRepo({});

    const { code, stdout } = run(["--root", root, "--json"]);

    expect(code).toBe(2);
    expect(stdout).toBe("");
  });

  it("still passes a repository that tracks exactly one clean file", () => {
    // The complement, so the refusal above is proven to key on ZERO rather
    // than on "few" — a guard that refused any small scan would be a different
    // and much louder defect.
    const root = tempRepo({ "README.md": "# clean\n" });

    expect(run(["--root", root]).code).toBe(0);
  });
});
