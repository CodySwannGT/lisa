/**
 * Regression tests for CodySwannGT/lisa#5099 — the fence that has to hold now
 * that a change recording a threshold exception can land.
 *
 * Accepting an entry-only change removes the one local barrier the ratchet
 * had, so each test here is a way round the fence that the acceptance would
 * otherwise have opened:
 *   - commit the entry, then commit the weakening, with nothing merged
 *   - name your own branch a deploy branch so its entry counts as merged
 *   - leave `strict` in one change and record the exception in the next
 *   - record the entry where the ratchet never reads it
 *   - have the check say "recorded" about a change it refused
 *   - forge a line of the check's output from inside a reason
 *
 * threshold-ratchet-exception-only.test.ts holds the acceptance itself. The
 * compare and families modules are imported statically for the mutation gate,
 * as that file explains.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  compareFile,
  describeUnmergedCover,
  settleAddedExceptions,
  splitMergedEntries,
} from "../../../plugins/src/base/hooks/threshold-ratchet-compare.mjs";
import {
  classifyAllowEntry,
  humanGateModeOf,
  humanGateModeOfText,
  reasonInWords,
} from "../../../plugins/src/base/hooks/threshold-ratchet-families.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

/** Absolute git path, so the fixture does not resolve a command off `PATH`. */
const GIT = resolveGit();

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const HOOKS_REL = "plugins/src/base/hooks";
const ENTRY = "threshold-ratchet.mjs";
const RATCHET_MODULES = [
  "threshold-ratchet-families.mjs",
  "threshold-ratchet-compare.mjs",
];
const ESLINT_FILE = "eslint.thresholds.json";
const LISA_CONFIG = ".lisa.config.json";
const NESTED_CONFIG = "packages/a/.lisa.config.json";
const ACCESS_ONLY = "access-only";
const STRICT = "strict";
const MODE_KEY = "humanGate.mode";
const LEFT_STRICT = 'humanGate.mode stops being "strict"';
const REASON =
  "Six bundled languages; resolved when translations load on demand.";
const RECORDED = "new exception recorded";
const MERGE_FIRST = "Merge this entry in a change of its own first";
const NOT_MERGED = "is recorded on this branch but is not on";
const LEGACY_REFUSAL = "Exceptions are a human decision";
const SCOPE = `thresholdRatchet.allow entry ${ESLINT_FILE} → maxWarnings (key-scoped)`;
const ORIGIN_MAIN = "refs/remotes/origin/main";
const REMOTE_MAIN = "origin/main";
const UPDATE_REF = "update-ref";
const ORIGIN_HEAD = "refs/remotes/origin/HEAD";
const STRICT_CONFIG = JSON.stringify({ humanGate: { mode: STRICT } });

/** A fixed clock for the pure functions: noon UTC on 2026-06-15. */
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const NEXT_WEEK = "2026-06-22";

/** An allow entry as a repository would write it. */
interface AllowEntry {
  readonly file: string;
  readonly key: string;
  readonly reason?: unknown;
  readonly until?: unknown;
}

/**
 * A sound, key-scoped entry for the eslint ceiling.
 * @param overrides - Fields to replace
 * @returns The entry
 */
function entry(overrides: Partial<AllowEntry> = {}): AllowEntry {
  return {
    file: ESLINT_FILE,
    key: "maxWarnings",
    reason: REASON,
    until: NEXT_WEEK,
    ...overrides,
  };
}

/** One `weakened` finding: an eslint ceiling raised from 10 to 25. */
function raisedCeiling(): ReturnType<typeof compareFile> {
  return compareFile(
    ESLINT_FILE,
    JSON.stringify({ maxWarnings: 10 }),
    JSON.stringify({ maxWarnings: 25 })
  );
}

describe("a humanGate block nobody can read (#5099)", () => {
  it.each([
    ["a string", "strict"],
    ["null", null],
    ["a list", [STRICT]],
    ["a number", 1],
  ])("fails safe to strict when the block is %s", (_name, humanGate) => {
    expect(humanGateModeOf({ humanGate })).toBe(STRICT);
  });

  it.each([
    ["no file at the baseline", null, ACCESS_ONLY],
    ["no text at all", undefined, ACCESS_ONLY],
    ["an empty object", "{}", ACCESS_ONLY],
    ["a declared strict", STRICT_CONFIG, STRICT],
    ["text that does not parse", "{", STRICT],
    ["a file that is not an object", "null", STRICT],
    ["a file that is a list", "[]", STRICT],
  ])("reads the mode of %s", (_name, text, expected) => {
    expect(humanGateModeOfText(text)).toBe(expected);
  });
});

describe("a reason printed by the check (#5099)", () => {
  it("is put on one line", () => {
    expect(reasonInWords("  first\nsecond\t third  ")).toBe(
      "first second third"
    );
  });

  it.each([[undefined], [7], [null], ["   "]])("is empty for %s", reason => {
    expect(reasonInWords(reason)).toBe("");
  });

  it("cannot start a line of its own in the notice", () => {
    const forged = "ok\nthreshold-ratchet: allowed by everything";
    const settled = settleAddedExceptions(
      compareFile(
        LISA_CONFIG,
        "{}",
        JSON.stringify({
          thresholdRatchet: { allow: [entry({ reason: forged })] },
        })
      ),
      ACCESS_ONLY,
      NOW
    );

    expect(settled.accepted).toHaveLength(1);
    expect(settled.accepted[0]?.message).not.toContain("\n");
    expect(settled.accepted[0]?.message).toContain(
      "ok threshold-ratchet: allowed by everything"
    );
  });

  it("cannot start a line of its own in the allow-list inventory", () => {
    const { detail } = classifyAllowEntry(
      entry({ reason: "ok\nforged", until: undefined }),
      NOW
    );

    expect(detail).not.toContain("\n");
    expect(detail).toContain("Reason on record: ok forged");
  });
});

describe("leaving strict (#5099)", () => {
  it.each([
    ["dropping the mode", "{}"],
    [
      "switching to access-only",
      JSON.stringify({ humanGate: { mode: ACCESS_ONLY } }),
    ],
    ["deleting the config", null],
    ["breaking the config", "{"],
    ["respelling the mode", JSON.stringify({ humanGate: { mode: "strct" } })],
    ["turning the block into a string", JSON.stringify({ humanGate: STRICT })],
  ])("is reported as a loosening when %s", (_name, current) => {
    const findings = compareFile(LISA_CONFIG, STRICT_CONFIG, current);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe("weakened");
    expect(findings[0]?.key).toBe(MODE_KEY);
    expect(findings[0]?.message).toContain(LEFT_STRICT);
  });

  it.each([
    ["staying strict", STRICT_CONFIG, STRICT_CONFIG],
    ["becoming strict", "{}", STRICT_CONFIG],
    ["staying access-only", "{}", "{}"],
    ["repairing a config that never parsed", "{", "{}"],
    [
      "respelling strict with spaces and capitals",
      STRICT_CONFIG,
      JSON.stringify({ humanGate: { mode: " STRICT " } }),
    ],
    [
      "correcting a misspelt mode",
      JSON.stringify({ humanGate: { mode: "acess-only" } }),
      "{}",
    ],
    [
      "removing a block that was null",
      JSON.stringify({ humanGate: null }),
      "{}",
    ],
    [
      "repairing a block that was a list",
      JSON.stringify({ humanGate: [] }),
      JSON.stringify({ humanGate: {} }),
    ],
  ])("is not reported for %s", (_name, base, current) => {
    expect(compareFile(LISA_CONFIG, base, current)).toEqual([]);
  });

  it("is not reported for a config that is not the root one", () => {
    expect(compareFile(NESTED_CONFIG, STRICT_CONFIG, "{}")).toEqual([]);
  });
});

describe("an entry outside the root config (#5099)", () => {
  it("is refused, because the ratchet never reads it there", () => {
    const settled = settleAddedExceptions(
      compareFile(
        NESTED_CONFIG,
        "{}",
        JSON.stringify({ thresholdRatchet: { allow: [entry()] } })
      ),
      ACCESS_ONLY,
      NOW
    );

    expect(settled.accepted).toEqual([]);
    expect(settled.refused).toHaveLength(1);
    expect(settled.refused[0]?.message).toContain(
      `is written in ${NESTED_CONFIG}`
    );
    expect(settled.refused[0]?.message).toContain(
      `Record it in the root ${LISA_CONFIG} instead`
    );
  });
});

describe("splitMergedEntries (#5099)", () => {
  it("keeps an entry a protected branch holds and withholds the rest", () => {
    const merged = entry();
    const local = entry({ key: "maxComplexity" });

    expect(splitMergedEntries([merged, local], [[], [entry()]])).toEqual({
      merged: [merged],
      unmerged: [local],
    });
  });

  it.each([
    ["a later until", { until: "2099-01-01" }],
    ["a different reason", { reason: "Another reason." }],
    ["a wider key", { key: "*" }],
    ["another file", { file: "vitest.thresholds.json" }],
    ["no until where the merged one has one", { until: undefined }],
  ])(
    "does not take an entry with %s for the merged one",
    (_name, overrides) => {
      const edited = entry(overrides);

      expect(splitMergedEntries([edited], [[entry()]])).toEqual({
        merged: [],
        unmerged: [edited],
      });
    }
  );

  it("withholds everything when no protected branch holds an entry", () => {
    expect(splitMergedEntries([entry()], [[], []]).unmerged).toEqual([entry()]);
    expect(splitMergedEntries([], [[entry()]])).toEqual({
      merged: [],
      unmerged: [],
    });
  });
});

describe("describeUnmergedCover (#5099)", () => {
  it("says which refused finding an unmerged entry would have covered", () => {
    const lines = describeUnmergedCover(
      raisedCeiling(),
      [entry()],
      [REMOTE_MAIN, "origin/dev"]
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(SCOPE);
    expect(lines[0]).toContain(`${NOT_MERGED} origin/main or origin/dev`);
    expect(lines[0]).toContain('run "git fetch" and try again');
    expect(lines[0]).toContain("Only the remote named origin is consulted");
    expect(lines[0]).toContain('"git remote set-head origin --auto"');
  });

  it("speaks for a file-wide entry too", () => {
    expect(
      describeUnmergedCover(
        raisedCeiling(),
        [entry({ key: "*" })],
        [REMOTE_MAIN]
      )
    ).toHaveLength(1);
  });

  it("stays silent about an entry that covers nothing refused", () => {
    expect(
      describeUnmergedCover(
        raisedCeiling(),
        [entry({ key: "maxComplexity" })],
        [REMOTE_MAIN]
      )
    ).toEqual([]);
    expect(describeUnmergedCover([], [entry()], [REMOTE_MAIN])).toEqual([]);
  });
});

/** Fixture repositories created by the CLI tests, removed after each one. */
const fixtures: string[] = [];

afterEach(() => {
  fixtures.splice(0).forEach(dir => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

/**
 * Run git in a repository, throwing on failure so a broken fixture cannot
 * masquerade as a passing test.
 * @param cwd - Repository directory
 * @param args - Git arguments
 */
function git(cwd: string, ...args: readonly string[]): void {
  const result = boundedSpawnSync({
    label: `git ${args[0] ?? ""}`,
    command: GIT,
    args: ["-c", "user.email=t@t", "-c", "user.name=t", ...args],
    cwd,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  }
}

/**
 * Serialize a `.lisa.config.json`.
 * @param allow - Allow entries to record
 * @param extra - Other top-level keys
 * @returns The file's text
 */
function configText(
  allow: readonly object[],
  extra: Readonly<Record<string, unknown>> = {}
): string {
  return `${JSON.stringify({ ...extra, thresholdRatchet: { allow } }, undefined, 2)}\n`;
}

/**
 * Write a file in a fixture repository, creating its folder.
 * @param dir - Repository directory
 * @param name - File name, relative to the repository
 * @param text - File text
 */
function write(dir: string, name: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), text, "utf-8");
}

/**
 * Set the eslint ceiling in a fixture repository.
 * @param dir - Repository directory
 * @param maxWarnings - The ceiling
 */
function ceiling(dir: string, maxWarnings: number): void {
  write(dir, ESLINT_FILE, `${JSON.stringify({ maxWarnings })}\n`);
}

/**
 * Create a repository whose `main` holds the baseline: an eslint ceiling of 10
 * warnings and the given config.
 * @param config - Text of the baseline `.lisa.config.json`
 * @returns Absolute path to the repository
 */
function baselineRepo(config: string = configText([])): string {
  // realpath, because the script only runs main() when argv[1] resolves to its
  // own module URL, and on macOS os.tmpdir() is a symlink.
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "lisa-ratchet-fence-"))
  );
  fixtures.push(dir);
  git(dir, "init", "-q", "-b", "main");
  for (const module of [ENTRY, ...RATCHET_MODULES]) {
    fs.copyFileSync(
      path.join(REPO_ROOT, HOOKS_REL, module),
      path.join(dir, module)
    );
  }
  write(dir, LISA_CONFIG, config);
  ceiling(dir, 10);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "baseline");
  return dir;
}

/**
 * Make the repository look as it does after a fetch: `origin/main` at the
 * given commit and `origin/HEAD` naming it as the remote's default branch.
 * @param dir - Repository directory
 * @param commit - Commit `origin/main` points at
 */
function remoteMainAt(dir: string, commit: string): void {
  git(dir, UPDATE_REF, ORIGIN_MAIN, commit);
  git(dir, "symbolic-ref", ORIGIN_HEAD, ORIGIN_MAIN);
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
 * The entry the CLI fixtures record: sound, and live whenever the suite runs.
 * @param overrides - Fields to replace
 * @returns The entry
 */
function liveEntry(overrides: Partial<AllowEntry> = {}): AllowEntry {
  return entry({ until: aDayStillAhead(), ...overrides });
}

/** What one run of the ratchet produced. */
interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run the ratchet in a fixture repository.
 * @param dir - Repository directory
 * @param args - Mode arguments
 * @param input - Text for stdin (hook mode)
 * @returns Exit status and both streams
 */
function ratchet(dir: string, args: readonly string[], input?: string): Run {
  const result = boundedSpawnSync({
    label: `the threshold ratchet ${args.join(" ")}`,
    command: process.execPath,
    args: [path.join(dir, ENTRY), ...args],
    cwd: dir,
    ...(input === undefined ? {} : { input }),
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

/**
 * Commit the entry on a topic branch, then stage the raised ceiling.
 * @param dir - Repository directory
 * @param config - The config text carrying the entry
 */
function recordThenStageWeakening(dir: string, config: string): void {
  git(dir, "checkout", "-qb", "topic");
  write(dir, LISA_CONFIG, config);
  git(dir, "commit", "-qam", "record the exception");
  ceiling(dir, 25);
  git(dir, "add", "-A");
}

describe("an exception that is committed but not merged (#5099)", () => {
  it("exempts nothing at commit until a protected branch holds it", () => {
    const dir = baselineRepo();
    remoteMainAt(dir, "HEAD");
    recordThenStageWeakening(dir, configText([liveEntry()]));

    const before = ratchet(dir, ["--staged"]);
    remoteMainAt(dir, "HEAD");
    const after = ratchet(dir, ["--staged"]);

    expect(before.status).toBe(1);
    expect(before.stderr).toContain("maxWarnings");
    expect(before.stderr).toContain(SCOPE);
    expect(before.stderr).toContain(`${NOT_MERGED} origin/main`);
    expect(before.stderr).toContain('run "git fetch" and try again');
    expect(before.stdout).not.toContain("allowed by");
    expect(after.status).toBe(0);
    expect(after.stdout).toContain(`allowed by ${SCOPE}`);
  });

  it("exempts nothing at edit either", () => {
    const dir = baselineRepo();
    remoteMainAt(dir, "HEAD");
    recordThenStageWeakening(dir, configText([liveEntry()]));

    const result = ratchet(
      dir,
      ["--hook"],
      JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: path.join(dir, ESLINT_FILE) },
      })
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`${NOT_MERGED} origin/main`);
  });

  it("counts an entry held by a deploy branch the default branch declares", () => {
    const chain = { deploy: { branches: { dev: "dev", production: "main" } } };
    const dir = baselineRepo(configText([], chain));
    remoteMainAt(dir, "HEAD");
    recordThenStageWeakening(dir, configText([liveEntry()], chain));
    git(dir, UPDATE_REF, "refs/remotes/origin/dev", "HEAD");

    const result = ratchet(dir, ["--staged"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`allowed by ${SCOPE}`);
  });

  it("does not let a branch name itself a deploy branch", () => {
    const dir = baselineRepo();
    remoteMainAt(dir, "HEAD");
    recordThenStageWeakening(
      dir,
      configText([liveEntry()], { deploy: { branches: { dev: "topic" } } })
    );
    git(dir, UPDATE_REF, "refs/remotes/origin/topic", "HEAD");

    const result = ratchet(dir, ["--staged"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${NOT_MERGED} origin/main`);
    expect(result.stderr).not.toContain("origin/topic");
  });

  it("falls back to the chain at HEAD when the remote names no default", () => {
    const chain = { deploy: { branches: { dev: "dev" } } };
    const dir = baselineRepo(configText([], chain));
    git(dir, UPDATE_REF, "refs/remotes/origin/dev", "HEAD");
    recordThenStageWeakening(dir, configText([liveEntry()], chain));

    const result = ratchet(dir, ["--staged"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${NOT_MERGED} origin/dev`);
  });

  it("finds the default branch by name when the remote never said which it is", () => {
    const dir = baselineRepo(
      configText([], { deploy: { branches: { production: "main" } } })
    );
    git(dir, UPDATE_REF, ORIGIN_MAIN, "HEAD");
    // The commit that records the entry also deletes deploy.branches. Read
    // from HEAD, that would leave no protected branch and switch the fence off.
    recordThenStageWeakening(dir, configText([liveEntry()]));

    const result = ratchet(dir, ["--staged"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${NOT_MERGED} origin/main`);
  });

  it("is not fooled by a local branch named like a remote one", () => {
    const dir = baselineRepo();
    remoteMainAt(dir, "HEAD");
    recordThenStageWeakening(dir, configText([liveEntry()]));
    git(dir, "branch", "origin/main", "HEAD");

    const result = ratchet(dir, ["--staged"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${NOT_MERGED} origin/main`);
  });

  it("honours HEAD's entry where there is no remote to wait for", () => {
    const dir = baselineRepo();
    recordThenStageWeakening(dir, configText([liveEntry()]));

    const result = ratchet(dir, ["--staged"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`allowed by ${SCOPE}`);
    expect(result.stdout).not.toContain("hookSpecificOutput");
  });

  it("refuses both commits together in a pull request", () => {
    const dir = baselineRepo();
    recordThenStageWeakening(dir, configText([liveEntry()]));
    git(dir, "commit", "-qm", "raise the ceiling");

    const result = ratchet(dir, ["--base", "main"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(MERGE_FIRST);
  });
});

describe("what the check says about a change it refuses (#5099)", () => {
  it("does not call an entry recorded beside one it refused", () => {
    const dir = baselineRepo();
    write(
      dir,
      LISA_CONFIG,
      configText([
        liveEntry(),
        liveEntry({ key: "maxComplexity", until: undefined }),
      ])
    );
    git(dir, "add", "-A");

    const result = ratchet(dir, ["--staged"]);

    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain(RECORDED);
    expect(result.stderr).toContain("maxComplexity");
  });

  it("refuses a new entry beside a weakening an older entry already allows", () => {
    const dir = baselineRepo(configText([liveEntry()]));
    write(
      dir,
      LISA_CONFIG,
      configText([liveEntry(), liveEntry({ key: "maxComplexity" })])
    );
    ceiling(dir, 25);
    git(dir, "add", "-A");

    const result = ratchet(dir, ["--staged"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(MERGE_FIRST);
    expect(result.stderr).toContain("maxComplexity");
    expect(result.stdout).not.toContain(RECORDED);
  });

  it("refuses an entry written in a nested config", () => {
    const dir = baselineRepo();
    write(dir, NESTED_CONFIG, "{}\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "a nested config");
    write(dir, NESTED_CONFIG, configText([liveEntry()]));
    git(dir, "add", "-A");

    const result = ratchet(dir, ["--staged"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `Record it in the root ${LISA_CONFIG} instead`
    );
  });

  it("answers a passing edit in plain text when nothing was recorded", () => {
    const dir = baselineRepo(configText([liveEntry()]));
    ceiling(dir, 25);

    const result = ratchet(
      dir,
      ["--hook"],
      JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: path.join(dir, ESLINT_FILE) },
      })
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`threshold-ratchet: allowed by ${SCOPE}`);
    expect(result.stdout).not.toContain("hookSpecificOutput");
  });
});

describe("a strict repository (#5099)", () => {
  const strict = { humanGate: { mode: STRICT } };

  it("refuses the change that only leaves strict", () => {
    const dir = baselineRepo(configText([], strict));
    write(dir, LISA_CONFIG, configText([]));
    git(dir, "add", "-A");

    const result = ratchet(dir, ["--staged"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(LEFT_STRICT);
  });

  it("lets a promotion carry a mode change that already landed upstream", () => {
    const chain = { deploy: { branches: { dev: "dev", production: "main" } } };
    const dir = baselineRepo(configText([], { ...strict, ...chain }));
    git(dir, "checkout", "-qb", "dev");
    write(dir, LISA_CONFIG, configText([], chain));
    git(dir, "commit", "-qam", "leave strict, approved on dev");

    const promotion = ratchet(dir, ["--base", "main", "--head", "dev"]);
    const ordinary = ratchet(dir, ["--base", "main"]);

    expect(promotion.status).toBe(0);
    expect(promotion.stdout).toContain("carried forward by this promotion");
    expect(promotion.stdout).toContain(MODE_KEY);
    expect(ordinary.status).toBe(1);
    expect(ordinary.stderr).toContain(LEFT_STRICT);
  });

  it("reads the mode from the base in a pull request", () => {
    const dir = baselineRepo(configText([], strict));
    git(dir, "checkout", "-qb", "topic");
    write(
      dir,
      LISA_CONFIG,
      configText([liveEntry()], { humanGate: { mode: ACCESS_ONLY } })
    );
    git(dir, "commit", "-qam", "relax the mode and record the exception");

    const result = ratchet(dir, ["--base", "main"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(LEGACY_REFUSAL);
    expect(result.stdout).not.toContain(RECORDED);
  });
});
