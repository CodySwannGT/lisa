/**
 * A refusal that names a remedy must name one that RUNS and that WORKS.
 *
 * `parity-safety-net-preserve-remedy.test.ts` already pins what the refusal
 * SAYS: that it offers a per-worktree alternative and never recommends the
 * shared stash. This suite is its executable half — it takes the commands the
 * refusal actually printed, runs them against real git fixtures, and checks
 * they do what the refusal claims. It is a separate file because the cost
 * profile is different: that suite is a fast text sweep, this one forks a hook
 * and drives throwaway repositories.
 *
 * ## Why an executable half was needed (issue #3696)
 *
 * #3722 gave the discard guards a remedy. Every assertion on it was a presence
 * assertion, and three defects fit through the gap, all of them found by
 * running the text rather than reading it:
 *
 * 1. **It preserved but never recovered.** The remedy taught how to save the
 *    work and restore it later and stopped there, so an agent that followed it
 *    exactly and successfully was returned to the identical refusal — the tree
 *    was still dirty. Half a path is a detour.
 * 2. **It did not run as printed.** `[-- <path>]` is optional-argument
 *    notation, and bash expands `[...]` as a glob: the line failed with
 *    `bash: path: No such file or directory` and wrote no patch at all.
 * 3. **`mktemp` was silently a no-op.** BSD/macOS mktemp substitutes only
 *    TRAILING `X`s, so `lisa-preserve-XXXXXX.patch` came back as that literal
 *    string — one fixed filename that successive preserves overwrite, in the
 *    exact place the guard's comment claims uniqueness.
 *
 * Defect 3 is the instructive one. The shipped suite asserted the substring
 * `"mktemp"` appears in the remedy, which is true of a template that never
 * substitutes. **It measured that the word was present, not that the mechanism
 * worked** — so the assertion below compares the produced filename against the
 * template instead.
 *
 * ## What keeps these assertions honest
 *
 * Every command executed here is EXTRACTED from what the hook printed at
 * runtime, never transcribed into this file. A remedy that is reworded, or
 * quietly emptied, changes what these tests run; a copy pinned here would not.
 * `extractCommands` hard-fails when it finds nothing, so an extraction that
 * silently matches zero lines cannot masquerade as a passing suite.
 *
 * The suite also pins both DIRECTIONS of the reset guard — refused on a dirty
 * tree, permitted on a clean one — because an assertion that only ever sees
 * one verdict is satisfied by a guard that always returns it.
 *
 * ## Every child here is bounded, and most were removed
 *
 * A suite that shells out to git in throwaway repositories is the canonical
 * shape that hangs, and `spawnSync` blocks the worker's event loop so vitest's
 * per-case budget cannot fire for it (#2906, #2940). So the only child starts
 * left are the ones that genuinely need a program — git, and the bash that runs
 * the remedy — and each goes through {@link boundedSpawnSync}, which pairs the
 * deadline with a kill that names itself. The `mkdir`, `cat` and `rm` children
 * an earlier draft of this file used are gone entirely, replaced by direct `fs`
 * calls: the cheapest way to bound a child is not to start one.
 *
 * One form throughout, deliberately. A file with two spellings teaches the next
 * editor to copy whichever line is nearest, and the weaker one spreads.
 * @module tests/unit/hooks/parity-safety-net-dirty-recovery
 */
import type { SpawnSyncReturns } from "node:child_process";
import {
  existsSync,
  mkdirSync,
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
import { cleanGitEnv, GIT_BIN } from "../../support/git-executable.js";

/** The BUILT hook, which is what consumers receive. */
const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");

const EXIT_BLOCKED = 2;

/** The shell the remedy is executed in, at a fixed location like the hook. */
const BASH = "/bin/bash";

/** The one tracked file every fixture commits, then dirties. */
const TRACKED = "tracked.txt";

/** The operation under test: a return to HEAD with no acknowledgement at all. */
const BLIND_RESET = "git reset --hard HEAD";

/** Scratch root for every fixture repository this suite builds. */
const SCRATCH = mkdtempSync(path.join(tmpdir(), "lisa-3696-"));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/** One classification: the hook's exit status and what it told the reader. */
interface Verdict {
  readonly status: number | null;
  readonly stderr: string;
}

/**
 * Classify one proposed command, from a given working directory.
 *
 * The directory matters: the reset guard consults `git status --porcelain` in
 * the hook's own cwd, so the same command is refused or permitted depending on
 * which tree the hook is asked from.
 * @param command The proposed shell command.
 * @param cwd The working directory the hook should run in.
 * @returns The hook's exit status and refusal text.
 */
const classify = (command: string, cwd: string): Verdict => {
  const outcome = boundedSpawnSync({
    label: "parity-safety-net.sh",
    command: BASH,
    args: [HOOK_PATH],
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd }),
    env: process.env,
    cwd,
  });

  return { status: outcome.status, stderr: outcome.stderr ?? "" };
};

/**
 * Run bash on a script, bounded, without asserting its exit status.
 * @param script The shell to run.
 * @param cwd Where to run it.
 * @param tmp Value for the child's TMPDIR, which the remedy writes into.
 * @returns The completed child.
 */
const runScript = (
  script: string,
  cwd: string,
  tmp: string
): SpawnSyncReturns<string> =>
  boundedSpawnSync({
    label: "remedy script",
    command: BASH,
    args: ["-c", script],
    cwd,
    env: { ...cleanGitEnv(), TMPDIR: `${tmp}/` },
  });

/**
 * Run the remedy and assert it succeeded.
 *
 * The status check is deliberate rather than incidental. An earlier draft used
 * `execFileSync`, which THREW on a non-zero exit, so "the remedy runs" was
 * asserted only as a side effect of the helper's error behaviour. Naming it
 * makes it a claim the suite states.
 * @param script The shell the refusal printed.
 * @param cwd The fixture to run it in.
 * @param tmp Value for the child's TMPDIR.
 */
const runRemedy = (script: string, cwd: string, tmp: string): void => {
  const outcome = runScript(script, cwd, tmp);
  expect(
    outcome.status,
    `the printed remedy exited ${String(outcome.status)}: ${outcome.stderr}`
  ).toBe(0);
};

/**
 * A git runner bound to one fixture repository.
 *
 * `cleanGitEnv()`, because a fixture otherwise inherits `GIT_*` from the
 * checkout this suite runs inside — which would quietly point these commands
 * back at the repository under test instead of the throwaway one.
 * @param dir The fixture repository to run inside.
 * @returns A function that runs git there and returns the completed child.
 */
const gitIn =
  (dir: string) =>
  (...args: readonly string[]): SpawnSyncReturns<string> =>
    boundedSpawnSync({
      label: `git ${args[0] ?? ""}`,
      command: GIT_BIN,
      args,
      cwd: dir,
      env: cleanGitEnv(),
    });

/**
 * The same, asserting the command succeeded.
 *
 * Fixture setup that half-worked produces a test failure pointing at the
 * assertion rather than at the setup, so failures are named where they happen.
 * @param dir The fixture repository to run inside.
 * @returns A function that runs git there and returns its stdout, trimmed.
 */
const gitOk =
  (dir: string) =>
  (...args: readonly string[]): string => {
    const outcome = gitIn(dir)(...args);
    expect(
      outcome.status,
      `fixture setup failed: git ${args.join(" ")} — ${outcome.stderr}`
    ).toBe(0);
    return (outcome.stdout ?? "").trim();
  };

/**
 * Build a throwaway repository, outside the repo under test.
 * @param name A directory name for this fixture.
 * @returns The fixture's absolute path, with one commit on `main`.
 */
const newRepo = (name: string): string => {
  const dir = path.join(SCRATCH, name);
  const git = gitOk(dir);

  mkdirSync(dir, { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "fixture");
  writeFileSync(path.join(dir, TRACKED), "committed\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");

  return dir;
};

/**
 * Dirty a fixture the way a concurrent agent would: content this operator did
 * not author, plus an untracked file.
 * @param dir The fixture repository.
 */
const dirtyWithForeignWork = (dir: string): void => {
  writeFileSync(path.join(dir, TRACKED), "a sibling agent edit\n");
  writeFileSync(path.join(dir, "untracked.txt"), "a sibling agent new file\n");
};

/**
 * Read a fixture's porcelain status.
 * @param dir The fixture repository.
 * @param includeUntracked Whether untracked files count.
 * @returns The porcelain output, trimmed.
 */
const status = (dir: string, includeUntracked = true): string =>
  gitOk(dir)(
    "status",
    "--porcelain",
    ...(includeUntracked ? [] : ["--untracked-files=no"])
  );

/**
 * Pull the runnable command lines out of a rendered refusal.
 *
 * The remedy is printed as indented command lines among prose. Taking them from
 * the hook's own output is what stops this suite from drifting away from what
 * the guard really says — the alternative, a copy pinned in this file, keeps
 * passing after the shipped text has changed underneath it.
 * @param stderr The refusal text the hook printed.
 * @returns Every indented line that reads as a shell command.
 * @throws If the refusal contained no command lines at all.
 */
const extractCommands = (stderr: string): readonly string[] => {
  const commands = stderr
    .split("\n")
    .filter(line => /^ {2,}\S/u.test(line))
    .map(line => line.trim())
    .filter(line => line.startsWith("git ") || line.startsWith("patch="));

  if (commands.length === 0) {
    throw new Error(
      "CONTROL INVALID: the refusal printed no runnable command lines, so " +
        "every assertion built on them would pass vacuously."
    );
  }

  return commands;
};

describe("the dirty-tree refusal names a remedy that runs", () => {
  it("refuses a blind hard reset on a dirty tree but permits it on a clean one", () => {
    const clean = newRepo("both-directions-clean");
    const dirty = newRepo("both-directions-dirty");
    dirtyWithForeignWork(dirty);

    // Both directions, because a guard that always refused would satisfy the
    // first assertion alone -- and so would a broken cwd, which is the more
    // likely failure of a suite like this one.
    expect(classify(BLIND_RESET, dirty).status).toBe(EXIT_BLOCKED);
    expect(classify(BLIND_RESET, clean).status).toBe(0);
  });

  it("prints commands that every guard in the same file permits", () => {
    const dirty = newRepo("self-consistent");
    dirtyWithForeignWork(dirty);

    const refusal = classify(BLIND_RESET, dirty);
    expect(refusal.status).toBe(EXIT_BLOCKED);

    // A remedy another guard blocks is the bug this ticket exists to fix, so
    // each printed line is put back through the guard that printed it.
    for (const command of extractCommands(refusal.stderr)) {
      expect(
        classify(command, dirty).status,
        `the refusal printed a command its own guard refuses: ${command}`
      ).toBe(0);
    }
  });

  it("names a sequence that actually returns the tree to HEAD", () => {
    const dirty = newRepo("returns-to-head");
    dirtyWithForeignWork(dirty);

    const refusal = classify(BLIND_RESET, dirty);
    const script = extractCommands(refusal.stderr).join("\n");

    const patches = path.join(SCRATCH, "patch-out");
    mkdirSync(patches, { recursive: true });
    runRemedy(script, dirty, patches);

    // Tracked content is back at HEAD. Untracked files deliberately survive --
    // that is `git reset --hard` semantics too, so it is not a regression
    // against the operation the remedy stands in for.
    expect(status(dirty, false)).toBe("");
    expect(status(dirty)).toBe("?? untracked.txt");

    // And the discarded work went somewhere recoverable that is not the shared
    // stash stack.
    const written = readdirSync(patches);
    expect(written).toHaveLength(1);
    const patch = path.join(patches, written[0] ?? "");
    const check = gitIn(dirty)("apply", "--check", patch);
    expect(
      check.status,
      `the preserved patch does not re-apply: ${check.stderr}`
    ).toBe(0);
  });

  it("recovers the tree the ticket was filed from: a conflicted index", () => {
    // The reported state was a stash pop that landed conflicted, leaving
    // unmerged entries. The fixture owns its stash stack, so this reproduces
    // the state without touching anyone else's; it is the state under test,
    // never a recommended technique.
    const dir = newRepo("conflicted-index");
    const git = gitOk(dir);
    writeFileSync(path.join(dir, TRACKED), "stashed\n");
    git("stash", "push", "-q", "-m", "fixture");
    writeFileSync(path.join(dir, TRACKED), "divergent\n");
    git("commit", "-q", "-a", "-m", "divergent");

    // A conflicted pop exits non-zero. That IS the fixture, so its status is
    // deliberately not asserted -- but the unmerged state it exists to produce
    // is, on the next line, because a pop that merged cleanly would leave this
    // case testing the ordinary dirty tree the previous case already covers.
    gitIn(dir)("stash", "pop");
    expect(
      gitOk(dir)("ls-files", "-u"),
      "fixture did not reach the unmerged state it exists to reproduce"
    ).not.toBe("");

    const refusal = classify(BLIND_RESET, dir);
    runRemedy(extractCommands(refusal.stderr).join("\n"), dir, SCRATCH);

    expect(status(dir)).toBe("");
  });
});

describe("the preserve step produces a unique filename", () => {
  it("substitutes the mktemp template instead of returning it verbatim", () => {
    const dirty = newRepo("mktemp-substitutes");
    dirtyWithForeignWork(dirty);

    const refusal = classify(BLIND_RESET, dirty);
    const template = extractCommands(refusal.stderr).find(line =>
      line.includes("mktemp")
    );
    expect(template, "the refusal named no mktemp step to check").toBeDefined();

    const out = path.join(SCRATCH, "mktemp-out");
    mkdirSync(out, { recursive: true });
    runRemedy(
      `${template ?? ""}\ngit diff --binary HEAD > "$patch"`,
      dirty,
      out
    );

    const [produced] = readdirSync(out);
    expect(produced).toBeDefined();

    // The defect: BSD mktemp leaves a template whose `X`s are not trailing
    // exactly as written, so the "unique" name is one fixed string. Asserting
    // that the word `mktemp` appears -- which is what shipped -- cannot see
    // this. Asserting the OUTPUT differs from the TEMPLATE can.
    expect(produced).not.toContain("XXXXXX");
  });

  it("returns a different filename on every call", () => {
    const dirty = newRepo("mktemp-unique");
    dirtyWithForeignWork(dirty);

    const refusal = classify(BLIND_RESET, dirty);
    const template = extractCommands(refusal.stderr).find(line =>
      line.includes("mktemp")
    );

    const out = path.join(SCRATCH, "mktemp-twice");
    mkdirSync(out, { recursive: true });
    for (const _ of [0, 1]) {
      runRemedy(`${template ?? ""}\n: > "$patch"`, dirty, out);
    }

    // Two preserves in one TMPDIR must not silently overwrite one another --
    // the whole claim of the preserve step is that the work survives.
    expect(readdirSync(out)).toHaveLength(2);
  });
});

describe("the guidance body stays valid shell in every shipped copy", () => {
  /** Every shipped spelling of the same guard. All of them govern somewhere. */
  const SHIPPED_COPIES: readonly string[] = [
    "plugins/src/base/hooks/parity-safety-net.sh",
    "plugins/lisa/hooks/parity-safety-net.sh",
    "plugins/lisa-agy/hooks/parity-safety-net.sh",
    "plugins/lisa-cursor/hooks/parity-safety-net.sh",
    "plugins/lisa-copilot/hooks/parity-safety-net.sh",
    "all/copy-overwrite/scripts/lisa-hooks/parity-safety-net.sh",
  ];

  /** How many copies must exist. Raise this deliberately when one is added. */
  const EXPECTED_COPIES = 6;

  // `it.each([])` registers ZERO tests and reports green, so a list that went
  // empty -- a rename, a bad edit -- would leave this whole describe block
  // passing over nothing while claiming to guard the file it just stopped
  // reading. Pin the count and prove every path resolves to a real file BEFORE
  // any per-copy assertion is trusted.
  it("covers every shipped copy, and each one exists", () => {
    expect(SHIPPED_COPIES).toHaveLength(EXPECTED_COPIES);
    for (const copy of SHIPPED_COPIES) {
      expect(
        existsSync(path.resolve(copy)),
        `missing shipped copy: ${copy}`
      ).toBe(true);
    }
  });

  // The guidance constants are quoted heredocs nested inside `$( )`, and bash
  // tracks quote state through the body while scanning for the closing paren.
  // A single apostrophe in the prose -- "the agent's TMPDIR" -- therefore
  // poisons the parse from there onward and the whole file stops being valid
  // shell, with the error reported hundreds of lines away in untouched code.
  // That happened while writing this ticket, and it presents as the guard
  // WORKING: every guard then fails closed. Proven to bite by poisoning one
  // copy and watching only that copy go red, while the content assertion below
  // stayed green over the same broken file -- which is why both exist.
  it.each(SHIPPED_COPIES)("%s parses as valid bash", copy => {
    const parsed = boundedSpawnSync({
      label: `bash -n ${copy}`,
      command: BASH,
      args: ["-n", path.resolve(copy)],
    });
    expect(parsed.status, `${copy} is not valid bash: ${parsed.stderr}`).toBe(
      0
    );
  });

  it.each(SHIPPED_COPIES)("%s carries the recovery sequence", copy => {
    const text = readFileSync(path.resolve(copy), "utf8");

    // Assert on what the copies SHIP, not merely that they discuss it: the
    // rationale comment above the constant names these same commands, so a
    // whole-file substring search would pass on a copy whose guidance body was
    // empty. Slice to the heredoc body first.
    const body = text.split("PRESERVE_GUIDANCE=")[1]?.split("\nEOF\n")[0] ?? "";
    expect(body, `no PRESERVE_GUIDANCE body found in ${copy}`).not.toBe("");
    expect(body).toContain("git apply -R");
    expect(body).toContain("mktemp");
    expect(body).not.toContain("XXXXXX.patch");
  });
});

describe("every guard that discards uncommitted work names the remedy", () => {
  // Guards 5 and 6 called block() with no guidance argument before #3696, so
  // they refused and named nothing. The operator who reached for `git restore`
  // to CLEAN a tree is the one who filed this ticket.
  const DISCARDING: readonly (readonly [string, string])[] = [
    ["a hard reset", BLIND_RESET],
    ["a path-scoped checkout", "git checkout -- src/index.ts"],
    ["a forced switch", "git switch --discard-changes main"],
    [
      "a worktree restore",
      "git restore --source=HEAD --staged --worktree -- .",
    ],
  ];

  it.each(DISCARDING)(
    "%s names a runnable recovery sequence",
    (_label, command) => {
      const dirty = newRepo(
        `names-remedy-${command.replaceAll(/\W/gu, "-").slice(0, 40)}`
      );
      dirtyWithForeignWork(dirty);

      const refusal = classify(command, dirty);
      expect(refusal.status).toBe(EXIT_BLOCKED);

      const commands = extractCommands(refusal.stderr);
      expect(commands.some(line => line.includes("git apply -R"))).toBe(true);
      expect(commands.some(line => line.includes("mktemp"))).toBe(true);
    }
  );
});
