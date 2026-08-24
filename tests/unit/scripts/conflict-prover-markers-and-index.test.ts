/**
 * The conflict-residue prover's two blind spots (#2958).
 *
 * Both were confirmed against the pre-fix source on real repositories rather
 * than on synthetic strings, which matters here more than usual: this prover
 * reads bytes off disk, so a fixture that never resembles what git actually
 * writes is easy to satisfy and proves nothing.
 *
 * **Marker length.** The matchers were `$`-anchored at exactly seven
 * characters. Git's `conflict-marker-size` attribute makes a real merge write
 * longer ones, and a real merge under `* conflict-marker-size=32` produced a
 * live, unresolved conflict in the working tree that the prover reported as
 * `✓ no leftover conflict markers in 4 tracked files`, exit 0.
 *
 * **The index.** The prover listed paths with `git ls-files` and then read
 * WORKING-TREE bytes, so the two could disagree. Measured, both exit 0 on the
 * pre-fix source:
 *
 * - a complete conflict block staged in the index with a clean unstaged
 *   resolution on disk;
 * - a tracked file absent from the working tree, which the prover COUNTED in
 *   `scanned` and silently skipped — a clean report over a file nobody read.
 *
 * Marker literals are built from `repeat` rather than written out, so this file
 * is not flagged by the gate it tests.
 * @module tests/unit/scripts/conflict-prover-markers-and-index
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";

import { findConflictBlocks } from "../../../all/copy-overwrite/scripts/check-conflict-markers.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils";
import { resolveGit } from "../../support/git-executable.js";

const SCRIPT = path.resolve(
  "all/copy-overwrite/scripts/check-conflict-markers.mjs"
);
const GIT = resolveGit();

/** Git's default marker width, and the one the matchers used to hard-code. */
const DEFAULT_MARKER = 7;

/** A non-default width, set through the `conflict-marker-size` attribute. */
const WIDE_MARKER = 32;

/**
 * One conflict marker line of a given width.
 * @param char - `<`, `=` or `>`
 * @param width - How many characters the marker runs for
 * @param label - Trailing branch label, as git writes on the open and close
 * @returns The marker line.
 */
const marker = (char: string, width: number, label = ""): string =>
  `${char.repeat(width)}${label === "" ? "" : ` ${label}`}`;

/**
 * A complete conflict block, each marker at its own width.
 * @param widths - Widths for the opening, separator and closing markers
 * @returns The block's lines, joined.
 */
const block = (
  widths: { open: number; separator: number; close: number } = {
    close: DEFAULT_MARKER,
    open: DEFAULT_MARKER,
    separator: DEFAULT_MARKER,
  }
): string =>
  [
    marker("<", widths.open, "HEAD"),
    "ours",
    marker("=", widths.separator),
    "theirs",
    marker(">", widths.close, "feature"),
  ].join("\n");

/** A tracked file with no markers, so a repository is never empty. */
const SEED = "seed.txt";

/** Contents for {@link SEED}. */
const SEED_TEXT = "clean\n";

/** A file whose INDEX copy carries the block and whose disk copy does not. */
const STAGED = "staged.txt";

/** A tracked file the working tree does not have, as a sparse checkout leaves it. */
const HIDDEN = "hidden.txt";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/**
 * Run a git command in `cwd`, tolerating a non-zero exit.
 *
 * A conflicting `git merge` exits 1 by design, and that is the state under
 * test, so the helper must not treat it as an error.
 * @param cwd - Repository directory
 * @param args - Arguments to git
 * @returns Nothing; failures are the caller's business to assert on.
 */
function git(cwd: string, ...args: readonly string[]): void {
  try {
    boundedExecFileSync({
      label: `git ${args[0] ?? ""}`,
      command: GIT,
      args,
      cwd,
      env: cleanGitEnv(process.env),
      stdio: "ignore",
    });
  } catch {
    // Conflicting merges and intentional failures both land here.
  }
}

/**
 * Create an initialised repository with the given files committed.
 * @param files - Relative path to contents
 * @returns The repository root.
 */
function repo(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-2958-"));
  roots.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  for (const [relative, content] of Object.entries(files)) {
    writeFileSync(path.join(root, relative), content, "utf8");
  }
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "seed");
  return root;
}

/**
 * Run the prover and capture its exit code and stdout.
 * @param root - Repository to scan
 * @param extra - Additional CLI arguments
 * @returns The exit code and stdout text.
 */
function prove(
  root: string,
  ...extra: readonly string[]
): { code: number; stdout: string } {
  try {
    return {
      code: 0,
      stdout: boundedExecFileSync({
        label: "check-conflict-markers.mjs",
        command: process.execPath,
        args: [SCRIPT, "--root", root, ...extra],
      }),
    };
  } catch (error) {
    const failure = error as { exitCode?: number; stdout?: string };
    return {
      code: typeof failure.exitCode === "number" ? failure.exitCode : -1,
      stdout: failure.stdout ?? "",
    };
  }
}

describe("findConflictBlocks: marker width", () => {
  it("reports a block whose markers are all wider than seven", () => {
    expect(
      findConflictBlocks(
        block({
          close: WIDE_MARKER,
          open: WIDE_MARKER,
          separator: WIDE_MARKER,
        })
      )
    ).toEqual([{ endLine: 5, separatorLine: 3, startLine: 1 }]);
  });

  it("requires the separator to be as wide as the opening marker", () => {
    // The width is what ties the three lines into one block. Without it a
    // document that happens to carry a long rule of `=` between two quoted
    // markers becomes a finding, and this gate's first rule is that a gate
    // which fires on files it should not read is its own outage.
    expect(
      findConflictBlocks(
        block({
          close: WIDE_MARKER,
          open: WIDE_MARKER,
          separator: DEFAULT_MARKER,
        })
      )
    ).toEqual([]);
  });

  it("requires the terminator to be as wide as the opening marker", () => {
    expect(
      findConflictBlocks(
        block({
          close: DEFAULT_MARKER,
          open: WIDE_MARKER,
          separator: WIDE_MARKER,
        })
      )
    ).toEqual([]);
  });

  it("still reports the ordinary seven-character block", () => {
    expect(findConflictBlocks(block())).toEqual([
      { endLine: 5, separatorLine: 3, startLine: 1 },
    ]);
  });
});

describe("check-conflict-markers: a real merge with a non-default marker size", () => {
  it("reports a conflict git wrote with 32-character markers", () => {
    // The whole point of running a real merge rather than writing the markers
    // by hand: it proves git emits this shape, so the gap is reachable without
    // anyone hand-crafting a file.
    const root = repo({
      ".gitattributes": `* conflict-marker-size=${String(WIDE_MARKER)}\n`,
      "f.txt": "base\n",
    });
    git(root, "checkout", "-q", "-b", "feature");
    writeFileSync(path.join(root, "f.txt"), "theirs\n", "utf8");
    git(root, "commit", "-q", "-am", "theirs");
    git(root, "checkout", "-q", "-");
    writeFileSync(path.join(root, "f.txt"), "ours\n", "utf8");
    git(root, "commit", "-q", "-am", "ours");
    git(root, "merge", "-q", "feature");

    const { code, stdout } = prove(root);

    expect(
      code,
      "a live unresolved conflict in the working tree read as a clean scan"
    ).toBe(1);
    expect(stdout).toContain("f.txt");
  });

  it("counts an unmerged path once, not once per stage", () => {
    // Only reachable once detection works, which is why it surfaced here.
    // `git ls-files` emits an unmerged path once per stage — three times for an
    // ordinary content conflict — so this two-file repository listed four
    // entries and the gate reported "3 of 4 tracked files carry leftover
    // conflict markers" about ONE conflicted file. A count an operator cannot
    // trust is the same defect as a verdict they cannot trust.
    const root = repo({
      ".gitattributes": `* conflict-marker-size=${String(WIDE_MARKER)}\n`,
      "f.txt": "base\n",
    });
    git(root, "checkout", "-q", "-b", "feature");
    writeFileSync(path.join(root, "f.txt"), "theirs\n", "utf8");
    git(root, "commit", "-q", "-am", "theirs");
    git(root, "checkout", "-q", "-");
    writeFileSync(path.join(root, "f.txt"), "ours\n", "utf8");
    git(root, "commit", "-q", "-am", "ours");
    git(root, "merge", "-q", "feature");

    const report = JSON.parse(prove(root, "--json").stdout) as {
      summary: { clean: number; conflicted: number; scanned: number };
      results: readonly { file: string }[];
    };

    expect(report.summary).toEqual({ clean: 1, conflicted: 1, scanned: 2 });
    expect(report.results.map(entry => entry.file)).toEqual(["f.txt"]);
  });
});

describe("check-conflict-markers: the index, not just the working tree", () => {
  it("reads the index when the working tree carries an unstaged resolution", () => {
    const root = repo({ [SEED]: SEED_TEXT });
    const staged = path.join(root, STAGED);
    writeFileSync(staged, `${block()}\n`, "utf8");
    git(root, "add", STAGED);
    // Resolved on disk and never staged: what a push would carry still has the
    // conflict in it, and the working tree says otherwise.
    writeFileSync(staged, "resolved\n", "utf8");

    const { code, stdout } = prove(root);

    expect(code).toBe(1);
    expect(stdout).toContain(STAGED);
  });

  it("reads the indexed blob for a tracked file absent from the working tree", () => {
    // `skip-worktree` is how a sparse checkout omits a tracked file, and the
    // pre-fix prover COUNTED this file in `scanned` and skipped reading it —
    // a clean report over a file nobody looked at, which is worse than a loud
    // failure and is the failure mode this whole gate exists to end.
    const root = repo({
      [HIDDEN]: `${block()}\n`,
      [SEED]: SEED_TEXT,
    });
    git(root, "update-index", "--skip-worktree", HIDDEN);
    rmSync(path.join(root, HIDDEN), { force: true });

    const { code, stdout } = prove(root);

    expect(code).toBe(1);
    expect(stdout).toContain(HIDDEN);
  });

  it("keeps the clean verdict and the scanned count when tree and index agree", () => {
    // The fast path. Every file matches its index, so nothing should be read
    // out of git at all, and the report must be the one it always was.
    const root = repo({ "a.md": "fine\n", "b.md": "also fine\n" });

    const { code, stdout } = prove(root, "--json");
    const report = JSON.parse(stdout) as {
      summary: { clean: number; conflicted: number; scanned: number };
    };

    expect(code).toBe(0);
    expect(report.summary).toEqual({ clean: 2, conflicted: 0, scanned: 2 });
  });

  it("still skips a binary blob that differs from the working tree", () => {
    // The binary safeguard has to survive the new read path, or the gate starts
    // decoding blobs as text and reporting whatever byte sequences it finds.
    const root = repo({ [SEED]: SEED_TEXT });
    const blob = path.join(root, "blob.bin");
    writeFileSync(blob, Buffer.from([0x00, 0x01, 0x00, 0x02]));
    git(root, "add", "blob.bin");
    writeFileSync(blob, Buffer.from([0x01, 0x02]));

    expect(prove(root).code).toBe(0);
  });
});
