/**
 * The discard remedy this guard prints must RUN as printed.
 *
 * `parity-safety-net.sh` refuses an operation that would throw away
 * uncommitted work and then offers two alternatives: preserve the work, or —
 * when the dirt belongs to a concurrent agent and the reader has judged none of
 * it theirs — return the tree to HEAD keeping a patch file as the record. They
 * are ALTERNATIVES: a reader in the second situation runs the second block and
 * never types the first.
 *
 * The second block referenced `"$patch"` and never assigned it. `git diff
 * --binary HEAD > "$patch"` then writes to a file named by the empty string and
 * the shell errors on the redirect, so the remedy fails on its second line, and
 * it fails in the one situation where the reader is already blocked, already
 * holding somebody's uncommitted work, and reading the guard's own words as
 * authoritative. Advice that does not work costs more than no advice: the next
 * refusal from the same guard gets argued with rather than followed.
 *
 * ## Why this suite EXECUTES the block instead of reading it
 *
 * A static assertion that the text contains `mktemp` is satisfied by the
 * BROKEN version too — the first block contains one, and both blocks live in
 * the same rendered guidance. Only running the second block on its own, in a
 * shell that never saw the first, distinguishes a self-contained remedy from
 * one that silently inherits a variable. So each case extracts the block from
 * what the hook actually printed to stderr, runs it in a disposable repository,
 * and asserts on the tree afterwards.
 *
 * `set -u` is deliberate. Without it an unset `$patch` expands to the empty
 * string and the failure surfaces as an obscure redirect error; with it the
 * shell names the unbound variable, which is the same defect stated plainly.
 * @module tests/unit/hooks/parity-safety-net-discard-remedy-executability
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

/** Every shipped spelling of the guard. All of them print this remedy. */
const SHIPPED_COPIES: readonly string[] = [
  "plugins/src/base/hooks/parity-safety-net.sh",
  "plugins/lisa/hooks/parity-safety-net.sh",
  "plugins/lisa-agy/hooks/parity-safety-net.sh",
  "plugins/lisa-cursor/hooks/parity-safety-net.sh",
  "plugins/lisa-copilot/hooks/parity-safety-net.sh",
  "all/copy-overwrite/scripts/lisa-hooks/parity-safety-net.sh",
].map(relative => path.resolve(relative));

const GIT = resolveGit();

/** The refusal whose guidance carries both blocks. */
const DISCARDING_COMMAND = "git checkout -- src/index.ts";

/** The last line of the discard block, and the only one unique to it. */
const DISCARD_TAIL = "git apply -R";

/** Committed content, and what the working tree is dirtied to. */
const COMMITTED = "committed\n";
const DIRTIED = "dirtied by a sibling agent\n";
const TRACKED = "tracked.txt";
const UNTRACKED = "untracked.txt";

/** Prefix for the TMPDIR each remedy run writes its patch file into. */
const TEMP_PREFIX = "lisa-discard-tmp-";

const created: string[] = [];

afterAll(() => {
  for (const dir of created) rmSync(dir, { force: true, recursive: true });
});

/**
 * A disposable directory this suite owns.
 * @param prefix - Name prefix for the temporary directory.
 * @returns The directory path.
 */
const scratch = (prefix: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
};

/**
 * What the guard printed when it refused the discarding command.
 * @param hook - Which shipped copy of the guard to ask.
 * @returns The refusal text.
 */
const refusal = (hook: string): string =>
  boundedSpawnSync({
    label: "parity-safety-net.sh",
    command: "/bin/bash",
    args: [hook],
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: DISCARDING_COMMAND },
      cwd: process.cwd(),
    }),
    env: process.env,
  }).stderr ?? "";

/**
 * The discard block, as printed.
 *
 * Located from its last line and walked BACKWARDS over the contiguous indented
 * lines above it, so the extraction depends on the code rather than on the
 * prose around it. Keying on a sentence would make this suite fail on a reflow
 * that changed nothing, and — worse — pass on a rewording that dropped the
 * assignment.
 * @param text - The rendered refusal.
 * @returns The block, one statement per line.
 */
const discardBlock = (text: string): string => {
  const lines = text.split("\n");
  const end = lines.findIndex(line => line.trim().startsWith(DISCARD_TAIL));
  if (end === -1) return "";
  let start = end;
  while (start > 0 && /^ {2,}\S/.test(lines[start - 1] ?? "")) start -= 1;
  return lines
    .slice(start, end + 1)
    .map(line => line.trim())
    .join("\n");
};

/**
 * A repository with one committed file, dirtied by "somebody else".
 * @returns The repository root.
 */
const dirtyRepo = (): string => {
  const root = scratch("lisa-discard-remedy-");
  const env = cleanGitEnv(process.env, {
    GIT_AUTHOR_EMAIL: "a@b.c",
    GIT_AUTHOR_NAME: "A",
    GIT_COMMITTER_EMAIL: "a@b.c",
    GIT_COMMITTER_NAME: "A",
  });
  const git = (...args: string[]): void => {
    boundedSpawnSync({
      label: `git ${args[0]}`,
      command: GIT,
      args: ["-C", root, ...args],
      env,
    });
  };
  git("init", "-q", "-b", "main");
  writeFileSync(path.join(root, TRACKED), COMMITTED, "utf-8");
  git("add", TRACKED);
  git("commit", "-q", "-m", "chore: seed");
  // Dirty in both index and worktree, which is the state the block's own
  // `git reset` exists to flatten.
  writeFileSync(path.join(root, TRACKED), DIRTIED, "utf-8");
  git("add", TRACKED);
  writeFileSync(path.join(root, UNTRACKED), "mine\n", "utf-8");
  return root;
};

/**
 * Run the extracted block in a repository, with nothing pre-defined.
 * @param block - The shell text to run.
 * @param root - The repository to run it in.
 * @param temp - The TMPDIR the block should write its patch into.
 * @returns The shell exit status and stderr.
 */
const runBlock = (
  block: string,
  root: string,
  temp: string
): { status: number | null; stderr: string } => {
  const result = boundedSpawnSync({
    label: "discard remedy",
    command: "/bin/bash",
    args: ["-u", "-c", block],
    cwd: root,
    env: cleanGitEnv(process.env, { TMPDIR: temp }),
  });
  return { status: result.status, stderr: result.stderr ?? "" };
};

/**
 * The porcelain status of a repository.
 * @param root - The repository root.
 * @returns `git status --porcelain` output.
 */
const status = (root: string): string =>
  boundedSpawnSync({
    label: "git status",
    command: GIT,
    args: ["-C", root, "status", "--porcelain"],
    env: cleanGitEnv(process.env, {}),
  }).stdout;

describe("parity-safety-net: the discard remedy runs as printed", () => {
  it("is extracted at all, so the cases below are not vacuous", () => {
    const block = discardBlock(refusal(SHIPPED_COPIES[0]!));

    expect(block).toContain("git reset");
    expect(block).toContain("git diff --binary HEAD");
    expect(block).toContain(DISCARD_TAIL);
  });

  it("defines the patch file it writes to, rather than inheriting it", () => {
    // The static half. It cannot stand alone — the first block also assigns
    // `patch`, so a reader of the whole guidance would see one either way —
    // but paired with the execution cases below it names the specific line.
    expect(discardBlock(refusal(SHIPPED_COPIES[0]!))).toContain("patch=");
  });

  it.each(SHIPPED_COPIES)("%s returns the tree to HEAD", copy => {
    const root = dirtyRepo();
    const temp = scratch(TEMP_PREFIX);

    const { status: exit, stderr } = runBlock(
      discardBlock(refusal(copy)),
      root,
      temp
    );

    expect(stderr).not.toContain("unbound variable");
    expect(exit).toBe(0);
    expect(readFileSync(path.join(root, TRACKED), "utf-8")).toBe(COMMITTED);
  });

  it("leaves the patch file as the record of what it discarded", () => {
    const root = dirtyRepo();
    const temp = scratch(TEMP_PREFIX);

    runBlock(discardBlock(refusal(SHIPPED_COPIES[0]!)), root, temp);

    const patches = readdirSync(temp).filter(name =>
      name.startsWith("lisa-preserve-")
    );
    expect(patches).toHaveLength(1);
    expect(readFileSync(path.join(temp, patches[0]!), "utf-8")).toContain(
      DIRTIED.trim()
    );
  });

  it("leaves untracked files alone, exactly as its own prose says", () => {
    const root = dirtyRepo();
    const temp = scratch(TEMP_PREFIX);

    runBlock(discardBlock(refusal(SHIPPED_COPIES[0]!)), root, temp);

    expect(existsSync(path.join(root, UNTRACKED))).toBe(true);
    // The tracked file is restored, so the only thing left dirty is the file
    // the remedy promised not to touch.
    expect(status(root).trim()).toBe(`?? ${UNTRACKED}`);
  });
});
