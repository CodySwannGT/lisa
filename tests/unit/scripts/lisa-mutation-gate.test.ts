/**
 * The diff-only mutation gate Lisa ships — and, since this change, runs on
 * itself.
 *
 * Two properties are load-bearing here and neither is about Stryker.
 *
 * **Eligibility comes from the project's own config.** The filter this replaces
 * was `startsWith("src/") || startsWith("lib/")` plus a `.ts`/`.tsx` extension
 * test. It agreed with the two `stryker.conf.json` templates Lisa ships and with
 * nothing else — including Lisa, whose mutate targets are `.mjs` guard scripts
 * under `all/copy-overwrite/scripts/`. Zero of them survive that filter, so
 * adopting the shipped gate here would have installed a control that selects no
 * file, generates no mutant and exits 0 forever.
 *
 * **Empty must not read as passing.** A diff-only gate that mutates nothing
 * produces the same exit code as one that mutated plenty and killed everything.
 * The tests below pin the three empty shapes apart from each other and from a
 * real run: a branch that legitimately touched no mutate target (exit 0, said so
 * loudly), a config that selects nothing in the whole repository (exit 1,
 * because that gate is inert rather than satisfied), and a run that reached
 * Stryker (exit code is Stryker's).
 * @module tests/unit/scripts/lisa-mutation-gate
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FALLBACK_MUTATE,
  OUTCOMES,
  STRYKER_DEFAULT_DRY_RUN_TIMEOUT_MINUTES,
  STRYKER_DEFAULT_TIMEOUT_MS,
  WHOLE_LIST_FLAG,
  classifyStrykerFailure,
  compileMutatePatterns,
  countMutateTargetsInRepo,
  envFlag,
  globToRegExp,
  isMutateTarget,
  isStrykerParseable,
  normalizePath,
  parseChangedLineRanges,
  readGate,
  resolveDiffBase,
  resolveMutateDeclaration,
  resolveTimeoutBudgets,
  runGate,
  selectChangedTargets,
  stripMutationRange,
  uninstrumentableGuards,
} from "../../../typescript/copy-overwrite/scripts/lisa-mutation.mjs";
import {
  boundedExecFileSync,
  boundedSpawnSync,
} from "../../helpers/io-latency-budget.js";

/** The Stryker config file name this gate reads its `mutate` list from. */
const STRYKER_CONF = "stryker.conf.json";

/** The project-owned switch file. */
const GATE_FILE = "mutation.gate.json";

/** The branch every scenario builds its diff on. */
const TOPIC = "topic";

/** A one-glob mutate list, used wherever the patterns are not the subject. */
const SRC_TS = "src/**/*.ts";

/** A `.mjs` guard outside `src/` — the shape the old filter could not select. */
const GUARD_MJS = "scripts/lisa-gates.mjs";

/** A committed switch that turns the gate on against `main`. */
const ENABLED_GATE = '{"enabled":true,"since":"main"}';

/** The mutate target every end-to-end scenario changes. */
const GUARD_TS = "src/guard.ts";

/** The one changed line in the standard guard fixture. */
const GUARD_RANGE = `${GUARD_TS}:1-1`;

/** Commit message for the step that widens a fixture enough to window it. */
const WIDEN = "widen source";

/** A four-line fixture body, wide enough for a line window to mean something. */
const FOUR_LINES = "one\ntwo\nthree\nfour\n";

/** The same fixture with only its second line edited. */
const FOUR_LINES_EDITED = "one\ntwo changed\nthree\nfour\n";

/** Body for a second source file added on a topic branch. */
const SRC_B = "export const b = 2;\n";

/** A path whose comma must stay literal outside brace alternation. */
const COMMA_PATH = "src/a,b.ts";

/** Stryker's own wording when a completed run scored under the break floor. */
const BREAK_LINE =
  "ERROR Final mutation score 12.34 under breaking threshold 32, " +
  "setting exit code to 1 (failure).";

/** Where a stand-in records the argv it was handed. */
const ARGV_RECORD = "stryker-argv.txt";

/** A file no mutate list selects — the empty-diff control's subject. */
const DOC = "docs/notes.md";

/**
 * A shell guard — the shape no mutation tool in this toolchain can reach.
 *
 * Not merely unselected. Stryker's instrumenter is per-language and has no
 * shell parser, so this file is outside the gate however `mutate` is written.
 */
const GUARD_SH = "scripts/block-something.sh";

/** A shell path used where only the extension is the subject. */
const ANY_SH = "scripts/guard.sh";

/** Why a Stryker stand-in recording no argv is the assertion, not an aside. */
const NO_STRYKER = "Stryker must not have run";

/** Stryker's wording when the un-mutated run blows its wall-clock budget. */
const DRY_RUN_TIMEOUT_LINE = "ERROR DryRunExecutor Initial test run timed out!";

/**
 * A clear-text score table, as `ClearTextScoreTable` actually draws one.
 *
 * Transcribed rather than paraphrased. The column order, the separators and the
 * padding are the format the gate has to read, and a hand-written
 * approximation of them would pass a parser that the real thing defeats.
 * @param killed - Mutants an assertion caught
 * @param timedOut - Mutants the per-mutant clock decided
 * @param survived - Mutants nothing caught
 * @returns The whole table, as Stryker prints it
 */
const scoreTable = (
  killed: number,
  timedOut: number,
  survived: number
): string => {
  const detected = killed + timedOut;
  const total = detected + survived;
  const pct = ((detected / total) * 100).toFixed(2);
  return [
    "-----------|------------------|----------|-----------|------------|----------|----------|",
    "           | % Mutation score |          |           |            |          |          |",
    "File       |  total | covered | # killed | # timeout | # survived | # no cov | # errors |",
    "-----------|--------|---------|----------|-----------|------------|----------|----------|",
    `All files  |  ${pct} |   ${pct} |     ${killed} |       ${timedOut} |       ${survived} |     0 |      0 |`,
    "-----------|--------|---------|----------|-----------|------------|----------|----------|",
  ].join("\n");
};

/**
 * A run whose floor is cleared ONLY because timeouts were credited.
 *
 * 20 killed, 20 timed out, 60 survived: Stryker reports 40.00 and exits 0
 * against a break threshold of 32. Without crediting the timeouts it is 20.00,
 * which is under it. This transcript is the whole of
 * CodySwannGT/lisa#2989 in one artefact.
 */
const INFLATED_TABLE = scoreTable(20, 20, 60);

/** The same shape, with nothing decided by the clock. */
const HONEST_TABLE = scoreTable(40, 0, 60);

/** Lisa's real mutate list, as committed. Not a paraphrase of it. */
const LISA_MUTATE = [
  "all/copy-overwrite/scripts/lisa-destructive-guard.mjs",
  "all/copy-overwrite/scripts/lisa-gates.mjs",
  "plugins/src/base/hooks/threshold-ratchet-compare.mjs",
];

/** The mutate list every TypeScript-stack consumer gets from Lisa. */
const CONSUMER_MUTATE = [
  SRC_TS,
  "src/**/*.tsx",
  "!src/**/*.spec.ts",
  "!src/**/*.spec.tsx",
  "!src/**/*.test.ts",
  "!src/**/*.test.tsx",
  "!src/**/*.d.ts",
  "!src/**/*.stories.tsx",
];

/**
 * Git, with the calling process's repository-local variables removed.
 *
 * A hook or a nested agent run exports `GIT_DIR`/`GIT_INDEX_FILE`, and a
 * temporary repository created under those points its objects back at the real
 * checkout.
 * @param cwd - Working directory for the command
 * @param args - Git arguments
 * @returns Trimmed stdout
 */
const git = (cwd: string, args: readonly string[]): string => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );
  return boundedExecFileSync({
    label: `git ${args[0] ?? ""}`,
    command: "git",
    args,
    cwd,
    env: { ...env, GIT_CONFIG_NOSYSTEM: "1", HOME: cwd },
  }).trim();
};

/**
 * Write a file, creating parents.
 * @param root - Repository root
 * @param rel - Repository-relative path
 * @param body - Contents
 */
const write = (root: string, rel: string, body: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};

/**
 * Commit everything currently in the tree.
 * @param root - Repository root
 * @param message - Commit message
 */
const commit = (root: string, message: string): void => {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "--no-verify", "-m", message]);
};

/** A throwaway repository with `main` as its base branch. */
const newRepo = (): string => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "lisa-mutation-gate-"))
  );
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "gate@example.invalid"]);
  git(root, ["config", "user.name", "Gate Test"]);
  return root;
};

/**
 * Install a stand-in for the Stryker binary that records how it was called.
 *
 * The gate's job is to decide WHAT to mutate and to pass the verdict through;
 * whether Stryker itself can go red is proved by the real runs in
 * `tests/integration/mutation-gate-*`. A stand-in makes the wiring assertions
 * exact — the argv is read back byte for byte — and keeps a unit suite from
 * launching a second mutation run inside the first.
 * @param root - Repository root
 * @param exitCode - Status the stand-in should exit with
 */
const fakeStryker = (root: string, exitCode: number): void => {
  writeStandIn(root, exitCode, "");
};

/**
 * The gate's own entry point, run the way the CLI runs it.
 *
 * A real path to the real module: driving the shipped entry point is what makes
 * {@link fakeStrykerPrinting}'s isolation true rather than asserted, because the
 * child that inherits the pipe is the same program the hook runs.
 */
const GATE_ENTRY = fileURLToPath(
  new URL(
    "../../../typescript/copy-overwrite/scripts/lisa-mutation.mjs",
    import.meta.url
  )
);

/** One captured gate run: its status, and everything both streams carried. */
interface CapturedGateRun {
  /** Exit code the gate returned. */
  readonly code: number;
  /** stdout and stderr, the gate's own and its child's, concatenated. */
  readonly output: string;
}

/** Drives a printing stand-in, and is the only way to reach one. */
type DriveGate = (argv?: readonly string[]) => CapturedGateRun;

/**
 * Write the stand-in Stryker binary the gate will find and run.
 * @param root - Repository root
 * @param exitCode - Status the stand-in should exit with
 * @param transcript - Lines the stand-in prints, or "" for a silent one
 */
const writeStandIn = (
  root: string,
  exitCode: number,
  transcript: string
): void => {
  const bin = path.join(root, "node_modules", ".bin");
  fs.mkdirSync(bin, { recursive: true });
  const printed =
    transcript === "" ? "" : `cat <<'TRANSCRIPT'\n${transcript}\nTRANSCRIPT\n`;
  fs.writeFileSync(
    path.join(bin, "stryker"),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${path.join(root, ARGV_RECORD)}"\n` +
      `printf '%s' "\${MUTATION_SCOPE-<unset>}" > "${path.join(root, "stryker-scope.txt")}"\n` +
      `${printed}exit ${exitCode}\n`
  );
  fs.chmodSync(path.join(bin, "stryker"), 0o755);
};

/**
 * A stand-in that prints a Stryker transcript, and the only way to drive it.
 *
 * ## Why this returns a runner instead of returning nothing
 *
 * CodySwannGT/lisa#3878. The gate streams Stryker's output while keeping a copy
 * to diagnose from — `{ child; } 2>&1 | tee "$log"` — so a stand-in's every
 * line goes to the log AND to whatever file descriptor the gate inherited.
 * Driven in-process by `runGate`, that descriptor is this worker's own stdout,
 * and the console spy these cases assert through never sees it: the gate's
 * `console.log` is captured, the CHILD's bytes go straight past it into the
 * push transcript.
 *
 * What landed there was `ERROR Final mutation score 12.34 under breaking
 * threshold 32, setting exit code to 1 (failure).` — byte-identical to a real
 * Stryker break, because the fidelity is the point of the fixture. Three
 * readers in a row took it for a verdict about their own branch.
 *
 * So the transcript and the runner arrive together. A case that installs a
 * printing stand-in gets back the only thing that can drive it, and that thing
 * runs the gate in a child whose stdout and stderr are pipes this test owns.
 * The bytes cannot reach a shared stream because nothing connects them to one
 * — not because anyone remembered to mark them.
 * @param root - Repository root
 * @param exitCode - Status the stand-in should exit with
 * @param transcript - Lines the stand-in prints on stdout
 * @returns The runner that drives this stand-in with its output captured
 */
const fakeStrykerPrinting = (
  root: string,
  exitCode: number,
  transcript: string
): DriveGate => {
  writeStandIn(root, exitCode, transcript);
  return (argv: readonly string[] = []) => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
    );
    const outcome = boundedSpawnSync({
      label: "lisa-mutation gate",
      command: process.execPath,
      args: [GATE_ENTRY, ...argv],
      cwd: root,
      env: { ...env, GIT_CONFIG_NOSYSTEM: "1", HOME: root },
    });
    return {
      code: outcome.status ?? 1,
      output: `${outcome.stdout}${outcome.stderr}`,
    };
  };
};

/**
 * Install a stand-in for Stryker that never finishes.
 *
 * The gate's child deadline is the only thing between a hung Stryker and a push
 * that hangs forever, so it is driven against a child that really does hang
 * rather than against a mock of one.
 * @param root - Repository root
 * @param seconds - How long the stand-in would run, unbounded
 */
const fakeStrykerHanging = (root: string, seconds: number): void => {
  const bin = path.join(root, "node_modules", ".bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, "stryker"),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${path.join(root, ARGV_RECORD)}"\n` +
      `echo starting\nsleep ${seconds}\n`
  );
  fs.chmodSync(path.join(bin, "stryker"), 0o755);
};

/**
 * A pid that names no process.
 *
 * "Some large number" is not safe — the kernel hands out pids from a bounded
 * space, so it could be live. This runs a process to completion and takes its
 * pid: the one pid known to have belonged to something that is now gone.
 * @returns A pid whose process has exited
 */
const deadPid = (): number =>
  Number(
    boundedExecFileSync({
      label: "a process that exits immediately",
      command: process.execPath,
      args: ["-e", "process.stdout.write(String(process.pid))"],
    }).trim()
  );

/** How the stand-in was invoked, or null when it never ran. */
const strykerArgv = (root: string): string[] | null => {
  const recorded = path.join(root, ARGV_RECORD);
  if (!fs.existsSync(recorded)) return null;
  return fs.readFileSync(recorded, "utf8").trim().split("\n");
};

/** A run-scoped sandbox path, as the gate builds one. */
const RUN_SANDBOX = /^\.stryker-tmp\/run-\d+-\d+$/u;

/**
 * Assert the whole argv the gate handed Stryker.
 *
 * Still exact — the leading arguments are compared byte for byte — but the
 * sandbox path carries a pid and a timestamp, so it is matched by shape. That
 * it is present at all is the assertion: without `--tempDirName` every run in a
 * project shares one sandbox, which is what makes reclaiming a leftover
 * dangerous (CodySwannGT/lisa#2995).
 * @param root - Repository root
 * @param leading - The arguments before `--tempDirName`
 */
const expectStrykerArgv = (root: string, leading: readonly string[]): void => {
  const argv = strykerArgv(root) ?? [];
  expect(argv.slice(0, leading.length)).toEqual([...leading]);
  expect(argv[leading.length]).toBe("--tempDirName");
  expect(argv[leading.length + 1]).toMatch(RUN_SANDBOX);
  expect(argv).toHaveLength(leading.length + 2);
};

/** The `MUTATION_SCOPE` the stand-in saw, or null when it never ran. */
const strykerScope = (root: string): string | null => {
  const recorded = path.join(root, "stryker-scope.txt");
  if (!fs.existsSync(recorded)) return null;
  return fs.readFileSync(recorded, "utf8");
};

describe("path normalization", () => {
  it("uses POSIX separators", () => {
    expect(normalizePath("src\\core\\a.ts")).toBe("src/core/a.ts");
  });

  it("drops a leading ./", () => {
    expect(normalizePath("./src/a.ts")).toBe("src/a.ts");
  });

  it("leaves an ordinary path alone", () => {
    expect(normalizePath("src/a.ts")).toBe("src/a.ts");
  });
});

describe("mutation-range suffixes", () => {
  it("strips a line range", () => {
    expect(stripMutationRange("src/a.ts:1-10")).toBe("src/a.ts");
  });

  it("strips a line:column range", () => {
    expect(stripMutationRange("src/a.ts:1:5-2:10")).toBe("src/a.ts");
  });

  it("leaves a plain path alone", () => {
    expect(stripMutationRange("src/a.ts")).toBe("src/a.ts");
  });

  it("leaves a colon that is not a range alone", () => {
    expect(stripMutationRange("src/a:b.ts")).toBe("src/a:b.ts");
  });
});

describe("changed-line range parsing", () => {
  it("merges adjacent new-side hunks and drops deletion-only hunks", () => {
    const patch = [
      "@@ -4 +4,2 @@",
      "+first",
      "+second",
      "@@ -6 +6 @@",
      "+third",
      "@@ -10,2 +11,0 @@",
      "-gone",
    ].join("\n");

    expect(parseChangedLineRanges(patch)).toEqual([{ start: 4, end: 6 }]);
  });

  it("returns no current range for a pure deletion", () => {
    expect(parseChangedLineRanges("@@ -2 +1,0 @@\n-gone")).toEqual([]);
  });
});

describe("glob compilation", () => {
  it("matches a literal path against itself", () => {
    expect(globToRegExp("a/b.mjs").test("a/b.mjs")).toBe(true);
  });

  it("does not let a dot behave as a wildcard", () => {
    expect(globToRegExp("a/b.mjs").test("a/bXmjs")).toBe(false);
  });

  it("keeps * inside one segment", () => {
    expect(globToRegExp("src/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/deep/a.ts")).toBe(false);
  });

  it("lets ** cross segments", () => {
    expect(globToRegExp(SRC_TS).test("src/a/b/c.ts")).toBe(true);
  });

  it("lets **/ match no segment at all", () => {
    // `**/*.spec.ts` has to exclude `a.spec.ts` at the root, or the shipped
    // negations silently stop excluding top-level specs.
    expect(globToRegExp("**/*.spec.ts").test("a.spec.ts")).toBe(true);
  });

  it("keeps ? to a single character within a segment", () => {
    expect(globToRegExp("src/?.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/ab.ts").test("src/a.ts")).toBe(false);
    expect(globToRegExp("src/?.ts").test("src/a/.ts")).toBe(false);
  });

  it("expands brace alternation", () => {
    const rule = globToRegExp("{src,lib}/a.ts");
    expect(rule.test("src/a.ts")).toBe(true);
    expect(rule.test("lib/a.ts")).toBe(true);
    expect(rule.test("app/a.ts")).toBe(false);
  });

  it("treats a comma outside braces as a literal", () => {
    expect(globToRegExp(COMMA_PATH).test(COMMA_PATH)).toBe(true);
    expect(globToRegExp(COMMA_PATH).test("src/a.ts")).toBe(false);
  });

  it("anchors both ends", () => {
    expect(globToRegExp("src/a.ts").test("vendor/src/a.ts")).toBe(false);
    expect(globToRegExp("src/a.ts").test("src/a.ts.bak")).toBe(false);
  });

  it("reports an unclosed brace instead of throwing a RegExp SyntaxError", () => {
    expect(() => globToRegExp("src/{a,b/**/*.ts")).toThrow(/unclosed "\{"/);
  });
});

describe("mutate-pattern selection", () => {
  it("selects Lisa's own .mjs guard scripts", () => {
    // The whole point of the change. Under the filter this replaces —
    // src/ or lib/, .ts or .tsx — every one of these is rejected and Lisa's
    // gate mutates nothing.
    const patterns = compileMutatePatterns(LISA_MUTATE);
    for (const guard of LISA_MUTATE) {
      expect(isMutateTarget(guard, patterns), guard).toBe(true);
    }
  });

  it("rejects a file Lisa does not list, however source-like", () => {
    const patterns = compileMutatePatterns(LISA_MUTATE);
    expect(isMutateTarget("src/core/lisa.ts", patterns)).toBe(false);
    expect(
      isMutateTarget(
        "all/copy-overwrite/scripts/lisa-postinstall.mjs",
        patterns
      )
    ).toBe(false);
  });

  it("honours a consumer's include patterns", () => {
    const patterns = compileMutatePatterns(CONSUMER_MUTATE);
    expect(isMutateTarget("src/a/b.ts", patterns)).toBe(true);
    expect(isMutateTarget("src/a/b.tsx", patterns)).toBe(true);
  });

  it("honours a consumer's negations", () => {
    const patterns = compileMutatePatterns(CONSUMER_MUTATE);
    for (const excluded of [
      "src/a.spec.ts",
      "src/a.test.tsx",
      "src/a.d.ts",
      "src/Button.stories.tsx",
    ]) {
      expect(isMutateTarget(excluded, patterns), excluded).toBe(false);
    }
  });

  it("stops mutating a path the consumer's config does not name", () => {
    // `--mutate` REPLACES the configured patterns, so the old hardcoded filter
    // handed Stryker `lib/` files that the project's own config excluded.
    const patterns = compileMutatePatterns(CONSUMER_MUTATE);
    expect(isMutateTarget("lib/a.ts", patterns)).toBe(false);
  });

  it("requires an include, not merely the absence of an exclude", () => {
    const patterns = compileMutatePatterns(["!src/**/*.spec.ts"]);
    expect(isMutateTarget("src/a.ts", patterns)).toBe(false);
  });

  it("reproduces the old hardcoded filter as the fallback", () => {
    const patterns = compileMutatePatterns([...FALLBACK_MUTATE]);
    expect(isMutateTarget("src/a.ts", patterns)).toBe(true);
    expect(isMutateTarget("lib/a.tsx", patterns)).toBe(true);
    expect(isMutateTarget("src/a.spec.ts", patterns)).toBe(false);
    expect(isMutateTarget("src/a.d.ts", patterns)).toBe(false);
    expect(isMutateTarget("scripts/a.mjs", patterns)).toBe(false);
  });
});

describe("languages the instrumenter cannot reach", () => {
  it("names a shell script as unreachable by any mutation tool here", () => {
    expect(uninstrumentableGuards([ANY_SH])).toEqual([ANY_SH]);
  });

  it("covers the shell family, not only .sh", () => {
    expect(uninstrumentableGuards(["a.bash", "b.zsh", "c.ksh"])).toEqual([
      "a.bash",
      "b.zsh",
      "c.ksh",
    ]);
  });

  it("recognises extensionless Husky hooks as shell guards", () => {
    expect(uninstrumentableGuards([".husky/pre-push"])).toEqual([
      ".husky/pre-push",
    ]);
    expect(uninstrumentableGuards([".husky/README.md"])).toEqual([]);
  });

  it("leaves documentation and config out of it", () => {
    // The narrow set is the point. Answering the general question here would
    // tell a docs-only branch its guards are unmeasured, which is both false
    // and the fastest way to teach a reader to ignore the marker.
    expect(
      uninstrumentableGuards(["README.md", "tsconfig.json", "ci.yml"])
    ).toEqual([]);
  });

  it("leaves a guard Stryker can instrument out of it", () => {
    expect(uninstrumentableGuards([GUARD_MJS])).toEqual([]);
  });

  it("reads Stryker's parser registry for the mutate-list question", () => {
    expect(isStrykerParseable(GUARD_MJS)).toBe(true);
    expect(isStrykerParseable("src/guard.ts")).toBe(true);
    expect(isStrykerParseable("src/Component.vue")).toBe(true);
    expect(isStrykerParseable("src/legacy.cjsx")).toBe(false);
    expect(isStrykerParseable(ANY_SH)).toBe(false);
    // A markdown file is unparseable too, and that is correct for THIS
    // question: naming it in `mutate` would crash the run exactly as a .sh
    // does. Only the diff report needs the narrower set.
    expect(isStrykerParseable("wiki/notes.md")).toBe(false);
  });
});

describe("mutate declaration provenance", () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "lisa-mutation-conf-"))
    );
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("reads mutate from stryker.conf.json", () => {
    write(root, STRYKER_CONF, JSON.stringify({ mutate: ["guards/*"] }));
    expect(resolveMutateDeclaration(root)).toEqual({
      mutate: ["guards/*"],
      source: STRYKER_CONF,
    });
  });

  it("falls back and says so when the config declares no mutate", () => {
    write(root, STRYKER_CONF, JSON.stringify({ testRunner: "vitest" }));
    const declaration = resolveMutateDeclaration(root);
    expect(declaration.mutate).toEqual([...FALLBACK_MUTATE]);
    expect(declaration.source).toContain('declares no "mutate"');
  });

  it("falls back and says so when the config will not parse", () => {
    write(root, STRYKER_CONF, "{ not json");
    const declaration = resolveMutateDeclaration(root);
    expect(declaration.mutate).toEqual([...FALLBACK_MUTATE]);
    expect(declaration.source).toContain("could not be parsed");
  });

  it("names a JavaScript config it cannot evaluate rather than pretending", () => {
    write(root, "stryker.conf.mjs", "export default {};");
    const declaration = resolveMutateDeclaration(root);
    expect(declaration.mutate).toEqual([...FALLBACK_MUTATE]);
    expect(declaration.source).toContain("stryker.conf.mjs");
    expect(declaration.source).toContain("JavaScript");
  });

  it("reports the absent case as the absent case", () => {
    const declaration = resolveMutateDeclaration(root);
    expect(declaration.mutate).toEqual([...FALLBACK_MUTATE]);
    expect(declaration.source).toContain("no Stryker config found");
  });

  it("prefers stryker.conf.json over the other JSON spellings", () => {
    write(root, STRYKER_CONF, JSON.stringify({ mutate: ["first/*"] }));
    write(
      root,
      "stryker.config.json",
      JSON.stringify({ mutate: ["second/*"] })
    );
    expect(resolveMutateDeclaration(root).mutate).toEqual(["first/*"]);
  });
});

describe("the gate switch", () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "lisa-mutation-switch-"))
    );
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("defaults to disabled when the file is absent", () => {
    expect(readGate(root)).toEqual({ enabled: false, since: "main" });
  });

  it("reads the committed switch", () => {
    write(root, GATE_FILE, '{"enabled":true,"since":"develop"}');
    expect(readGate(root)).toEqual({ enabled: true, since: "develop" });
  });

  it("fails safe on a malformed switch", () => {
    write(root, GATE_FILE, "{oops");
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(readGate(root)).toEqual({ enabled: false, since: "main" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("fails safe on valid JSON that is not a gate", () => {
    // `null` and `[]` parse cleanly and have no `.enabled`. Returned as-is,
    // the caller reads a property off them and dies with a TypeError naming
    // neither the file nor the reason.
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const body of ["null", "[1,2]", '"enabled"']) {
      write(root, GATE_FILE, body);
      expect(readGate(root), body).toEqual({ enabled: false, since: "main" });
    }
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});

describe("environment overrides", () => {
  afterEach(() => {
    delete process.env.LISA_MUTATION_ENV_PROBE;
  });

  it("is undefined when unset, so a config value can win", () => {
    expect(envFlag("LISA_MUTATION_ENV_PROBE")).toBeUndefined();
  });

  it("accepts true and 1", () => {
    process.env.LISA_MUTATION_ENV_PROBE = "true";
    expect(envFlag("LISA_MUTATION_ENV_PROBE")).toBe(true);
    process.env.LISA_MUTATION_ENV_PROBE = "1";
    expect(envFlag("LISA_MUTATION_ENV_PROBE")).toBe(true);
  });

  it("treats anything else as false rather than unset", () => {
    process.env.LISA_MUTATION_ENV_PROBE = "false";
    expect(envFlag("LISA_MUTATION_ENV_PROBE")).toBe(false);
    process.env.LISA_MUTATION_ENV_PROBE = "yes";
    expect(envFlag("LISA_MUTATION_ENV_PROBE")).toBe(false);
  });

  it("reads a set-but-empty value as unset, not as an explicit false", () => {
    // What GitHub Actions produces when an unset workflow input is mapped
    // into `env:` — `MUTATION_ENABLED: ${{ inputs.mutation }}` on a caller
    // that passes nothing sets the variable to "". The declaration is the
    // caller's and the emptiness is the harness's, so reading it as a
    // deliberate `false` turns the harness's silence into an override that
    // beats a project whose `mutation.gate.json` says `enabled: true`. The
    // gate then stands down, and nothing anywhere says it was asked to.
    process.env.LISA_MUTATION_ENV_PROBE = "";
    expect(envFlag("LISA_MUTATION_ENV_PROBE")).toBeUndefined();
  });

  it("reads a whitespace-only value as unset for the same reason", () => {
    process.env.LISA_MUTATION_ENV_PROBE = "   ";
    expect(envFlag("LISA_MUTATION_ENV_PROBE")).toBeUndefined();
  });

  it("still lets a deliberate false disable a gate the config enabled", () => {
    // The fallback must not swallow the override it exists to preserve:
    // `false` is typeable, so an operator who means it can still say it.
    process.env.LISA_MUTATION_ENV_PROBE = "false";
    expect(envFlag("LISA_MUTATION_ENV_PROBE")).toBe(false);
  });
});

describe("diff scoping against a real repository", () => {
  let root: string;

  beforeEach(() => {
    root = newRepo();
    write(root, "src/a.ts", "export const a = 1;\n");
    write(root, "README.md", "base\n");
    commit(root, "base");
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("resolves a merge-base against the local branch name", () => {
    git(root, ["checkout", "-q", "-b", TOPIC]);
    write(root, "src/b.ts", SRC_B);
    commit(root, TOPIC);
    expect(resolveDiffBase(root, "main")).toHaveLength(40);
  });

  it("returns nothing when the ref does not exist", () => {
    expect(resolveDiffBase(root, "no-such-ref")).toBe("");
  });

  it("counts changed files and selects only the mutate targets", () => {
    git(root, ["checkout", "-q", "-b", TOPIC]);
    write(root, "src/b.ts", SRC_B);
    write(root, "README.md", "changed\n");
    commit(root, TOPIC);
    const patterns = compileMutatePatterns([SRC_TS]);
    const scope = selectChangedTargets(
      root,
      resolveDiffBase(root, "main"),
      patterns
    );
    expect(scope.changed).toBe(2);
    expect(scope.selectedFiles).toBe(1);
    expect(scope.selected).toEqual(["src/b.ts:1-1"]);
    expect(scope.noCurrentLines).toEqual([]);
  });

  it("scopes an existing file to its changed new-side line", () => {
    write(root, "src/a.ts", FOUR_LINES);
    commit(root, WIDEN);
    git(root, ["checkout", "-q", "-b", TOPIC]);
    write(root, "src/a.ts", FOUR_LINES_EDITED);
    commit(root, TOPIC);

    const scope = selectChangedTargets(
      root,
      resolveDiffBase(root, "main"),
      compileMutatePatterns([SRC_TS])
    );
    expect(scope.selectedFiles).toBe(1);
    expect(scope.selected).toEqual(["src/a.ts:2-2"]);
    expect(scope.noCurrentLines).toEqual([]);
  });

  it("windows on the working tree Stryker mutates, not on committed state", () => {
    write(root, "src/a.ts", FOUR_LINES);
    commit(root, WIDEN);
    git(root, ["checkout", "-q", "-b", TOPIC]);
    write(root, "src/a.ts", FOUR_LINES_EDITED);
    commit(root, TOPIC);
    // An uncommitted insertion ABOVE the change. Stryker reads the working
    // tree, where "two changed" now sits on line 5; a window derived from
    // `base...HEAD` still calls it line 2, which in the working tree is a
    // comment. The run then mutates lines nobody touched and the score is
    // reported as a verdict about the change — a confident answer to a
    // question that was never asked.
    write(
      root,
      "src/a.ts",
      "// c1\n// c2\n// c3\none\ntwo changed\nthree\nfour\n"
    );

    const scope = selectChangedTargets(
      root,
      resolveDiffBase(root, "main"),
      compileMutatePatterns([SRC_TS])
    );
    expect(scope.selected).toEqual(["src/a.ts:1-3", "src/a.ts:5-5"]);
  });

  it("selects a mutate target whose only change is uncommitted", () => {
    git(root, ["checkout", "-q", "-b", TOPIC]);
    write(root, "src/a.ts", "export const a = 2;\n");

    const scope = selectChangedTargets(
      root,
      resolveDiffBase(root, "main"),
      compileMutatePatterns([SRC_TS])
    );
    // Committed state says this branch changed nothing, so the gate used to
    // print "0 mutate targets" and exit 0 while Stryker, pointed at the same
    // tree, had a changed target in front of it. That empty is the false green
    // this whole file exists to refuse.
    expect(scope.changed).toBe(1);
    expect(scope.selectedFiles).toBe(1);
    expect(scope.selected).toEqual(["src/a.ts:1-1"]);
  });

  it("prefers the remote-tracking ref over a stale local branch of the same name", () => {
    // #3889 read `gate.since || "main"` and concluded the gate diffs against
    // the LOCAL `main`, so a stale local branch would drag in everyone else's
    // files. It does not: `origin/<ref>` is probed first and only falls back to
    // the local name. Pinned here so the claim is settled by measurement rather
    // than by reading one line, and so the preference cannot be dropped
    // silently later.
    const stale = git(root, ["rev-parse", "HEAD"]);
    write(root, "src/a.ts", "export const a = 1;\nexport const b = 1;\n");
    commit(root, "advance the integration branch");
    const advanced = git(root, ["rev-parse", "HEAD"]);

    git(root, ["checkout", "-q", "-b", TOPIC]);
    git(root, ["update-ref", "refs/remotes/origin/main", advanced]);
    git(root, ["branch", "-f", "main", stale]);
    write(root, "src/b.ts", SRC_B);
    commit(root, TOPIC);

    expect(git(root, ["merge-base", "main", "HEAD"])).toBe(stale);
    expect(resolveDiffBase(root, "main")).toBe(advanced);
  });

  it("names a mutate target whose diff contains only deleted lines", () => {
    write(root, "src/a.ts", "one\ntwo\nthree\n");
    commit(root, WIDEN);
    git(root, ["checkout", "-q", "-b", TOPIC]);
    write(root, "src/a.ts", "one\nthree\n");
    commit(root, TOPIC);

    const scope = selectChangedTargets(
      root,
      resolveDiffBase(root, "main"),
      compileMutatePatterns([SRC_TS])
    );
    expect(scope.selectedFiles).toBe(1);
    expect(scope.selected).toEqual([]);
    expect(scope.noCurrentLines).toEqual(["src/a.ts"]);
  });

  it("drops a selected file that no longer exists in the working tree", () => {
    git(root, ["checkout", "-q", "-b", TOPIC]);
    write(root, "src/b.ts", SRC_B);
    commit(root, TOPIC);
    fs.rmSync(path.join(root, "src/b.ts"));
    const scope = selectChangedTargets(
      root,
      resolveDiffBase(root, "main"),
      compileMutatePatterns([SRC_TS])
    );
    expect(scope.selected).toEqual([]);
  });

  it("keeps a deleted shell guard in the uninstrumentable diff", () => {
    write(root, GUARD_SH, "#!/bin/sh\nexit 0\n");
    commit(root, "seed shell guard");
    git(root, ["checkout", "-q", "-b", TOPIC]);
    fs.rmSync(path.join(root, GUARD_SH));
    git(root, ["add", "--all"]);
    git(root, ["commit", "-q", "-m", "delete shell guard"]);

    const scope = selectChangedTargets(
      root,
      resolveDiffBase(root, "main"),
      compileMutatePatterns([SRC_TS])
    );
    expect(scope.changed).toBe(1);
    expect(scope.selected).toEqual([]);
    expect(scope.uninstrumentable).toEqual([GUARD_SH]);
  });

  it("counts the repository's own mutate targets", () => {
    expect(
      countMutateTargetsInRepo(root, compileMutatePatterns([SRC_TS]))
    ).toBe(1);
  });

  it("reports zero when the patterns match nothing tracked", () => {
    expect(
      countMutateTargetsInRepo(root, compileMutatePatterns(["app/**/*.ts"]))
    ).toBe(0);
  });
});

describe("the gate end to end", () => {
  let root: string;
  let logged: string[];
  const savedEnv = { ...process.env };

  beforeEach(() => {
    root = newRepo();
    logged = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.join(" "));
    });
    delete process.env.MUTATION_ENABLED;
    delete process.env.MUTATION_SINCE;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
    process.env.MUTATION_ENABLED = savedEnv.MUTATION_ENABLED;
    process.env.MUTATION_SINCE = savedEnv.MUTATION_SINCE;
    if (savedEnv.MUTATION_ENABLED === undefined)
      delete process.env.MUTATION_ENABLED;
    if (savedEnv.MUTATION_SINCE === undefined)
      delete process.env.MUTATION_SINCE;
  });

  /**
   * Everything the gate printed, as one string.
   * @returns Combined output
   */
  const output = (): string => logged.join("\n");

  /**
   * A repository with a base commit and a topic branch changing `changed`.
   * @param mutate - The `mutate` array to commit into stryker.conf.json
   * @param changed - Repository-relative paths the topic branch modifies
   */
  /**
   * A Stryker config that declares both a mutate list and a break threshold.
   *
   * `scenario` writes one without `thresholds`, which is right for every case
   * that is about selection. A case about the accounting needs a floor for the
   * recomputed score to be judged against — and it must be the fixture's own,
   * never Lisa's, so nothing here can be satisfied by a number this repository
   * happens to have committed.
   * @param mutate - The `mutate` array
   * @param breakAt - `thresholds.break`
   * @returns The config, as JSON
   */
  const thresholded = (mutate: readonly string[], breakAt: number): string =>
    JSON.stringify({ mutate: [...mutate], thresholds: { break: breakAt } });

  const scenario = (
    mutate: readonly string[],
    changed: readonly string[]
  ): void => {
    write(root, STRYKER_CONF, JSON.stringify({ mutate: [...mutate] }));
    write(root, GATE_FILE, ENABLED_GATE);
    write(root, GUARD_TS, "export const guard = 1;\n");
    write(root, DOC, "base\n");
    commit(root, "base");
    git(root, ["checkout", "-q", "-b", TOPIC]);
    for (const file of changed) write(root, file, `touched ${file}\n`);
    commit(root, TOPIC);
  };

  it("self-skips when the project has not opted in", () => {
    write(root, GATE_FILE, '{"enabled":false,"since":"main"}');
    write(root, "README.md", "x\n");
    commit(root, "base");
    fakeStryker(root, 1);

    expect(runGate(root)).toBe(0);
    expect(strykerArgv(root)).toBeNull();
    expect(output()).toBe(
      '⚪ mutation-gate: disabled — mutation.gate.json says "enabled": false. Skipping.\n' +
        '   Flip "enabled": true (and tune thresholds.break in stryker.conf.json) to turn it on.'
    );
  });

  it("returns a named invalid-pattern outcome for malformed mutate config", () => {
    write(root, GATE_FILE, '{"enabled":true,"since":"main"}');
    write(root, STRYKER_CONF, JSON.stringify({ mutate: ["src/{a,b/**/*.ts"] }));
    write(root, SRC_TS, "export const value = 1;\n");
    commit(root, "invalid mutate config");

    expect(runGate(root)).toBe(1);
    expect(output()).toContain(OUTCOMES.invalidMutatePattern);
    expect(output()).not.toContain("SyntaxError");
  });

  it("hands Stryker exactly the changed line ranges in mutate targets", () => {
    scenario([SRC_TS], [GUARD_TS, DOC]);
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(0);
    expectStrykerArgv(root, ["run", "--mutate", GUARD_RANGE]);
    expect(output()).toBe(
      "🧬 mutation-gate: scoped-run — Stryker on 1 changed line range(s) in 1 of 2 changed file(s), " +
        "selected by stryker.conf.json:\n" +
        "   • src/guard.ts:1-1\n" +
        // The stand-in prints no clear-text table, so the timed-out share of
        // this run was not measured — and the gate says that rather than
        // reporting a score it cannot account for. Pinned in full, because the
        // silence it replaces is the defect: a run that credits an unmeasured
        // bucket looks exactly like one that measured it at zero.
        "⚠️  mutation-gate: timeout-share-unmeasured\n" +
        "   No `All files` row was found in Stryker's output, so the timed-out share of\n" +
        "   this score was NOT measured. That is not a claim it was zero: Stryker scores\n" +
        "   a timed-out mutant as KILLED, so an unmeasured share is an unknown amount of\n" +
        "   this score decided by the clock.\n" +
        '   Add "clear-text" to `reporters` in your Stryker config to measure it, or set\n' +
        "   MUTATION_CAPTURE=0 to say out loud that this run is not being accounted for."
    );
  });

  it("tells Stryker's environment what the run was scoped to", () => {
    // `MUTATION_SCOPE` is what lets a test-runner config narrow its own suite
    // list to the guards actually being mutated — the dry run is otherwise the
    // one cost a diff-scoped run cannot shrink. Documented and unproven is how
    // a contract quietly stops holding, so it is asserted where it is set.
    scenario([SRC_TS], [GUARD_TS, DOC]);
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(0);
    expect(strykerScope(root)).toBe(GUARD_RANGE);
  });

  it("joins several selected files the way --mutate parses them", () => {
    // One selected file hides the separator entirely: `join(",")` and
    // `join("")` produce the same string. Two do not, and `--mutate` is a
    // comma-separated list, so the separator is a real part of the contract.
    scenario([SRC_TS], [GUARD_TS, "src/second.ts", DOC]);
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(0);
    expectStrykerArgv(root, [
      "run",
      "--mutate",
      `${GUARD_RANGE},src/second.ts:1-1`,
    ]);
    expect(strykerScope(root)).toBe(`${GUARD_RANGE},src/second.ts:1-1`);
  });

  it("reclaims a killed run's sandbox before starting, and says it did", () => {
    // A killed run skips `cleanTempDir` entirely and leaves a full second copy
    // of the tree behind — 72 MB, measured. The reclaim happens at the START of
    // the next run, while the sweeper owns what it is about to write, because
    // an after-the-fact cleanup cannot run in the case that creates the mess.
    //
    // It is reported rather than done in silence: a gate that quietly deletes
    // a directory it did not create in this run is indistinguishable from one
    // that deleted something it should not have.
    scenario([SRC_TS], [GUARD_TS]);
    const abandoned = `run-${deadPid()}-1700000000000`;
    write(root, `.stryker-tmp/${abandoned}/copy-of-the-tree.txt`, "x");
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(0);
    expect(output()).toContain(OUTCOMES.sandboxReclaimed);
    expect(output()).toContain(abandoned);
    expect(
      fs.existsSync(path.join(root, ".stryker-tmp", abandoned)),
      "the abandoned sandbox must be gone before Stryker starts"
    ).toBe(false);
  });

  it("leaves a live run's sandbox alone, and stays quiet about it", () => {
    // The control for the case above, and the trap it exists to avoid: a sweep
    // that took this directory would delete a concurrent run's working
    // directory out from under it (CodySwannGT/lisa#2961).
    scenario([SRC_TS], [GUARD_TS]);
    const live = `run-${process.pid}-1700000000000`;
    write(root, `.stryker-tmp/${live}/copy-of-the-tree.txt`, "x");
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(0);
    expect(output()).not.toContain(OUTCOMES.sandboxReclaimed);
    expect(fs.existsSync(path.join(root, ".stryker-tmp", live))).toBe(true);
  });

  it("kills a hung Stryker at its own deadline, and calls it a kill", () => {
    // The gate's child carried no deadline at all: in CI that is bounded by the
    // job timeout, in a git hook by nothing. A run killed here measured
    // NOTHING, so it must not arrive as a score — which is what the hook above
    // used to call it.
    scenario([SRC_TS], [GUARD_TS]);
    fakeStrykerHanging(root, 45);
    vi.stubEnv("MUTATION_CHILD_DEADLINE_MS", "800");

    const startedAt = Date.now();
    const code = runGate(root);

    expect(code).not.toBe(0);
    expect(
      Date.now() - startedAt,
      "the deadline has to bound the run, not merely describe it"
    ).toBeLessThan(30_000);
    expect(output()).toContain(OUTCOMES.childDeadline);
    expect(output()).toContain("800ms");
    expect(output()).not.toContain(OUTCOMES.scoreBelowBreak);
    expect(output()).not.toContain(OUTCOMES.runFailed);
  });

  it("fails the gate when Stryker fails it", () => {
    // The gate's verdict IS Stryker's verdict. A wrapper that swallowed a
    // non-zero status would be green forever, which is the whole failure class
    // this gate exists to detect, relocated into the gate.
    scenario([SRC_TS], [GUARD_TS]);
    fakeStryker(root, 1);

    expect(runGate(root)).toBe(1);
  });

  it("fails a run Stryker passed only because it credited timeouts", () => {
    // THE BITE for CodySwannGT/lisa#2989. Stryker exits 0 on this run: it
    // scores each of the 20 timed-out mutants as KILLED, reaching 40.00
    // against a break threshold of 32. Nothing demonstrably caught them, and
    // which mutants time out is a property of how busy the box was — so this
    // run passes on a slow machine and fails on a fast one, which is backwards.
    //
    // Before this change the gate returned Stryker's 0 straight through.
    scenario([SRC_TS], [GUARD_TS]);
    write(root, STRYKER_CONF, thresholded([SRC_TS], 32));
    const driveGate = fakeStrykerPrinting(root, 0, INFLATED_TABLE);

    const run = driveGate();
    expect(run.code).toBe(1);
    expect(run.output).toContain(OUTCOMES.inflatedByTimeouts);
    expect(run.output).toContain("20.00 against a break threshold of 32");
  });

  it("passes the same run when nothing was decided by the clock", () => {
    // The control. Same 40 detected, same 60 survived, same floor — the only
    // difference is which bucket the detection came from. Without this, the
    // case above would be satisfied by a gate that failed every run.
    scenario([SRC_TS], [GUARD_TS]);
    write(root, STRYKER_CONF, thresholded([SRC_TS], 32));
    const driveGate = fakeStrykerPrinting(root, 0, HONEST_TABLE);

    const run = driveGate();
    expect(run.code).toBe(0);
    expect(run.output).toContain(OUTCOMES.timeoutAccounting);
    expect(run.output).not.toContain(OUTCOMES.inflatedByTimeouts);
  });

  it("reports the timeout accounting on a run it lets through", () => {
    scenario([SRC_TS], [GUARD_TS]);
    write(root, STRYKER_CONF, thresholded([SRC_TS], 10));
    const driveGate = fakeStrykerPrinting(root, 0, INFLATED_TABLE);

    const run = driveGate();
    expect(run.code).toBe(0);
    // Both numbers, so a reader can tell how much of the score is load-dependent
    // without going and doing the arithmetic themselves.
    expect(run.output).toContain("20 of 40 detected");
    expect(run.output).toContain("40.00");
    expect(run.output).toContain("20.00");
  });

  it("adds the honest recomputation to a failure that produced a score", () => {
    // A run under the floor is under it by MORE than Stryker said, and the
    // reader is told both. The classification still comes first: what failed is
    // still Stryker's verdict, and this is the accounting beneath it.
    scenario([SRC_TS], [GUARD_TS]);
    write(root, STRYKER_CONF, thresholded([SRC_TS], 32));
    const driveGate = fakeStrykerPrinting(
      root,
      1,
      `${INFLATED_TABLE}\n${BREAK_LINE}`
    );

    const run = driveGate();
    expect(run.code).toBe(1);
    expect(run.output).toContain(OUTCOMES.scoreBelowBreak);
    expect(run.output).toContain(OUTCOMES.timeoutAccounting);
  });

  it("stays quiet about an unmeasured share on a failure that scored nothing", () => {
    // A dry run killed by the clock computed no score, so there is nothing to
    // account for. The unmeasured warning on top of it would be noise over a
    // failure that has already explained itself.
    scenario([SRC_TS], [GUARD_TS]);
    const driveGate = fakeStrykerPrinting(root, 1, DRY_RUN_TIMEOUT_LINE);

    const run = driveGate();
    expect(run.code).toBe(1);
    expect(run.output).toContain(OUTCOMES.dryRunTimeout);
    expect(run.output).not.toContain(OUTCOMES.timeoutUnmeasured);
  });

  it("mutates the whole list under --all, with no --mutate override", () => {
    // `--mutate` REPLACES the configured patterns, so passing one at all would
    // narrow the whole-list run to whatever was passed. The absence of the flag
    // IS the whole-list scope.
    scenario([SRC_TS], [DOC]);
    const driveGate = fakeStrykerPrinting(root, 0, HONEST_TABLE);

    const run = driveGate([WHOLE_LIST_FLAG]);
    expect(run.code).toBe(0);
    expectStrykerArgv(root, ["run"]);
    expect(run.output).toContain(OUTCOMES.wholeList);
    // The diff is irrelevant under --all: this branch changed no mutate target
    // at all, and the run still happened.
    expect(run.output).not.toContain(OUTCOMES.nothingToMutate);
  });

  it("accounts for a --all run the same way it accounts for a scoped one", () => {
    // The reason --all goes through this gate rather than invoking Stryker
    // directly: the whole-list run is the one big enough for the timeout bucket
    // to be worth anything, and it used to bypass the accounting entirely.
    scenario([SRC_TS], [DOC]);
    write(root, STRYKER_CONF, thresholded([SRC_TS], 32));
    const driveGate = fakeStrykerPrinting(root, 0, INFLATED_TABLE);

    const run = driveGate([WHOLE_LIST_FLAG]);
    expect(run.code).toBe(1);
    expect(run.output).toContain(OUTCOMES.inflatedByTimeouts);
  });

  it("still runs the diff when no --all is passed", () => {
    // The default has to stay the diff-only gate. A flag read as "present
    // unless proven absent" would put a whole-list run on every push.
    scenario([SRC_TS], [GUARD_TS]);
    const driveGate = fakeStrykerPrinting(root, 0, HONEST_TABLE);

    expect(driveGate([]).code).toBe(0);
    expectStrykerArgv(root, ["run", "--mutate", GUARD_RANGE]);
  });

  it("selects a .mjs guard outside src/, which the old filter could not", () => {
    write(root, GUARD_MJS, "export const a = 1;\n");
    commit(root, "seed");
    scenario([GUARD_MJS], [GUARD_MJS]);
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(0);
    expectStrykerArgv(root, ["run", "--mutate", `${GUARD_MJS}:1-1`]);
  });

  it("reports nothing-to-mutate distinguishably, and never starts Stryker", () => {
    // The control this whole change turns on. A branch that touched no mutate
    // target exits 0 — the same code a real passing run exits with — so the
    // ONLY thing separating them is what is printed.
    scenario([SRC_TS], [DOC]);
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(0);
    expect(strykerArgv(root), NO_STRYKER).toBeNull();
    expect(output()).not.toContain(OUTCOMES.scoped);
    // Pinned whole, not by fragment. The exit code carries no information
    // here — this text IS the control, so every line of it is the assertion.
    expect(output()).toBe(
      "⚪ mutation-gate: nothing-to-mutate\n" +
        "   1 file(s) changed vs main; 0 of them are mutate targets\n" +
        "   under the patterns from stryker.conf.json.\n" +
        "   NO mutant was generated and NO score was computed. Nothing was measured,\n" +
        "   so nothing passed — do not read this as evidence about your tests."
    );
  });

  it("names a mutate target whose only changed line was deleted", () => {
    write(root, STRYKER_CONF, JSON.stringify({ mutate: [SRC_TS] }));
    write(root, GATE_FILE, ENABLED_GATE);
    write(root, GUARD_TS, "keep\ngone\n");
    commit(root, "base");
    git(root, ["checkout", "-q", "-b", TOPIC]);
    write(root, GUARD_TS, "keep\n");
    commit(root, TOPIC);
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(0);
    expect(strykerArgv(root), NO_STRYKER).toBeNull();
    expect(output()).toBe(
      "⚪ mutation-gate: no-current-lines-to-mutate\n" +
        "   1 mutate-target file(s) changed vs main, but their diff\n" +
        "   contains only deletions or a rename with no changed current lines:\n" +
        "   • src/guard.ts\n" +
        "   Stryker can place mutants only on current lines. NO mutant was generated\n" +
        "   and NO score was computed; this is not a measured pass."
    );
  });

  it("separates a shell-guard change from a change it simply did not select", () => {
    // The defect this splits apart. Both branches exit 0 and neither starts
    // Stryker, so the marker is the ONLY thing carrying the difference — and
    // the difference is the whole claim. `nothing-to-mutate` says no guard
    // this gate watches was touched. This says a guard WAS touched and the
    // toolchain cannot see it, which is the opposite fact wearing the same
    // grey line.
    scenario([SRC_TS], [GUARD_SH]);
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(0);
    expect(strykerArgv(root), NO_STRYKER).toBeNull();
    expect(output()).not.toContain(OUTCOMES.nothingToMutate);
    expect(output()).toContain(OUTCOMES.uninstrumentableLanguage);
    expect(output()).toContain(GUARD_SH);
    expect(output()).toContain("NO mutant COULD be generated");
    expect(output()).toContain("driving test");
  });

  it("keeps calling a change it merely did not select nothing-to-mutate", () => {
    // The negative control for the case above. Without it, a marker that fired
    // on every empty diff would pass that test while carrying no information
    // at all — the exact shape of guard this file exists to refuse.
    scenario([SRC_TS], [DOC, "src/notes.md"]);
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(0);
    expect(output()).toContain(OUTCOMES.nothingToMutate);
    expect(output()).not.toContain(OUTCOMES.uninstrumentableLanguage);
  });

  it("still mutates a selected target on a branch that also touched shell", () => {
    // A shell file in the diff must not shadow real work. The uninstrumentable
    // report is for the case where it is ALL there was; a branch with a live
    // mutate target still gets measured.
    scenario([SRC_TS], [GUARD_TS, GUARD_SH]);
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(0);
    expect(strykerArgv(root)).toContain(GUARD_RANGE);
    expect(output()).toContain(OUTCOMES.uninstrumentableLanguage);
    expect(output()).toContain(GUARD_SH);
    expect(output()).toContain("covers only the selected targets");
  });

  it("refuses a mutate list naming a file Stryker has no parser for", () => {
    // Measured, not assumed: Stryker answers a `.sh` in `mutate` with
    // "Unable to parse …. No parser registered for .sh!" and aborts
    // instrumentation, so one such entry destroys every other guard's score.
    // Widening `mutate` is the intuitive fix for the shell gap and it is the
    // one edit that must never land; refusing it here is what makes that
    // executable rather than a note in a decision record.
    scenario(["**/*.sh"], [GUARD_SH]);
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(1);
    expect(strykerArgv(root), NO_STRYKER).toBeNull();
    expect(output()).toContain(OUTCOMES.uninstrumentableTarget);
    expect(output()).toContain(GUARD_SH);
    expect(output()).toContain("No parser registered for");
    expect(output()).not.toContain(OUTCOMES.inertConfig);
  });

  it("fails when the mutate config selects nothing in the repository", () => {
    // Distinguishing this from the case above is what makes the case above
    // safe to exit 0 on. A gate whose patterns match no tracked file is not
    // satisfied — it is switched on and wired to nothing.
    scenario(["app/**/*.ts"], [DOC]);
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(1);
    expect(output()).not.toContain(OUTCOMES.nothingToMutate);
    expect(strykerArgv(root)).toBeNull();
    expect(output()).toBe(
      "❌ mutation-gate: inert-mutate-config\n" +
        "   The mutate patterns from stryker.conf.json select NO tracked file\n" +
        "   in this repository, so this gate can never generate a mutant and would\n" +
        "   report success on every run forever. That is not a pass — it is a gate\n" +
        "   that is switched on and wired to nothing.\n" +
        "   Fix the `mutate` patterns in your Stryker config, or turn the gate off."
    );
  });

  it("refuses a selected path Stryker's --mutate cannot represent", () => {
    // One comma-separated argument means a comma in a filename reaches Stryker
    // as two paths that do not exist: it mutates neither, finds nothing, and
    // exits 0. Silent green, arriving through a filename.
    scenario([SRC_TS], [COMMA_PATH]);
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(1);
    expect(strykerArgv(root)).toBeNull();
    expect(output()).toContain(OUTCOMES.unrepresentablePath);
    expect(output()).toContain(COMMA_PATH);
  });

  it("skips rather than mutating everything when no base resolves", () => {
    scenario([SRC_TS], [GUARD_TS]);
    write(root, GATE_FILE, '{"enabled":true,"since":"nonexistent"}');
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(0);
    expect(strykerArgv(root)).toBeNull();
    expect(output()).toBe(
      '⚪ mutation-gate: no-diff-base — no merge-base against "nonexistent" (shallow clone or\n' +
        "   unknown ref). Skipping rather than mutating the whole repository.\n" +
        "   Nothing was measured; this is not a mutation score."
    );
  });

  it("lets MUTATION_ENABLED turn a disabled gate on", () => {
    scenario([SRC_TS], [GUARD_TS]);
    write(root, GATE_FILE, '{"enabled":false,"since":"main"}');
    fakeStryker(root, 0);
    process.env.MUTATION_ENABLED = "true";

    expect(runGate(root)).toBe(0);
    expectStrykerArgv(root, ["run", "--mutate", GUARD_RANGE]);
  });

  it("lets MUTATION_SINCE choose the base CI diffs against", () => {
    scenario([SRC_TS], [GUARD_TS]);
    git(root, ["branch", "release", "main"]);
    fakeStryker(root, 0);
    process.env.MUTATION_SINCE = "release";

    expect(runGate(root)).toBe(0);
    expectStrykerArgv(root, ["run", "--mutate", GUARD_RANGE]);
  });

  it("reports a dry run that ran out of clock as a timeout, not a score", () => {
    // The whole issue, end to end. Before this, the gate returned Stryker's
    // bare 1 and the pre-push hook had to guess what it meant — which it did,
    // out loud, as a mutation score, for a run that computed no score at all.
    scenario([SRC_TS], [GUARD_TS]);
    write(
      root,
      STRYKER_CONF,
      JSON.stringify({ mutate: [SRC_TS], dryRunTimeoutMinutes: 20 })
    );
    const driveGate = fakeStrykerPrinting(
      root,
      1,
      `INFO DryRunExecutor Starting initial test run\n${DRY_RUN_TIMEOUT_LINE}`
    );

    const run = driveGate();
    expect(run.code).toBe(1);
    expect(run.output).toContain(OUTCOMES.dryRunTimeout);
    expect(run.output).toContain("20 minute(s)");
    expect(run.output).not.toContain(OUTCOMES.scoreBelowBreak);
  });

  it("still reports a real score failure as a score failure", () => {
    // The other side of the same control. Softening the timeout case is only
    // safe if the case it was masking still lands.
    scenario([SRC_TS], [GUARD_TS]);
    const driveGate = fakeStrykerPrinting(root, 1, BREAK_LINE);

    const run = driveGate();
    expect(run.code).toBe(1);
    expect(run.output).toContain(OUTCOMES.scoreBelowBreak);
    expect(run.output).toContain("12.34");
    expect(run.output).not.toContain(OUTCOMES.dryRunTimeout);
    // AC3: a real verdict names the ranges it scored. A fixture transcript
    // never scoped a change, so it cannot produce this half however faithfully
    // it reproduces the vendor's wording.
    expect(run.output).toContain("Scored 1 changed line range(s)");
    expect(run.output).toContain(GUARD_RANGE);
  });
});

describe("a fixture verdict cannot reach a shared stream", () => {
  /** This file's own source, which is the subject of the guard below. */
  const source = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");

  /**
   * Every `it(...)` body in this file, split on the case opener.
   * @returns One entry per case, its own source
   */
  const cases = (): string[] => source.split(/\n {2}it\(/u).slice(1);

  it("drives every printing stand-in through the captured runner", () => {
    // THE ENFORCEMENT for CodySwannGT/lisa#3878, and the reason the fix is not
    // a marker on a string. The gate tees its child's output to the descriptor
    // it inherited, so a printing stand-in driven by an in-process `runGate`
    // writes Stryker's exact wording onto this worker's real stdout — past the
    // console spy, into the push transcript, indistinguishable from a verdict
    // about the reader's own branch. Three readers took it for one.
    //
    // A case can only fail this by reaching for `runGate` after asking for a
    // transcript, which is the exact move that reintroduces the defect. Naming
    // it here means the next person is stopped by a test rather than by a
    // reviewer who happens to remember.
    const offenders = cases().filter(
      body => body.includes("fakeStrykerPrinting(") && /\brunGate\(/u.test(body)
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the silent stand-in silent, so it has no transcript to leak", () => {
    // The other half of the invariant. `fakeStryker` cannot print, so the cases
    // that still drive the gate in-process have nothing to put on the stream —
    // which is what makes converting only the printing cases sufficient rather
    // than merely convenient.
    expect(source).toContain(
      "const fakeStryker = (root: string, exitCode: number): void => {"
    );
  });

  it("still feeds the parser the vendor's exact wording", () => {
    // The fixture's purpose has to survive its isolation: a stand-in that no
    // longer matches what Stryker prints would be a worse defect than the one
    // this ticket is about. Byte-exact, asserted against the literal rather
    // than against the constant, so editing the constant cannot quietly move
    // what "exact" means.
    expect(BREAK_LINE).toBe(
      "ERROR Final mutation score 12.34 under breaking threshold 32, " +
        "setting exit code to 1 (failure)."
    );
    expect(
      classifyStrykerFailure(BREAK_LINE, {
        timeoutMS: 5000,
        dryRunTimeoutMinutes: 5,
        inherited: [],
      }).outcome
    ).toBe(OUTCOMES.scoreBelowBreak);
  });
});

describe("a real verdict names what it scored", () => {
  /** Budgets where the budgets are not the subject. */
  const budgets = {
    timeoutMS: 5000,
    dryRunTimeoutMinutes: 5,
    inherited: [] as string[],
  };

  it("lists the changed line ranges a scoped run measured", () => {
    // AC3. The discriminator that survives a wording edit: a real verdict can
    // name the ranges it scored, and a stand-in transcript cannot, because a
    // stand-in never scoped a change. A reader's question stops being "does
    // this look real?" and becomes "does this name MY files?".
    const message = classifyStrykerFailure(BREAK_LINE, budgets, [
      "src/a.ts:1-3",
      "src/b.ts:5-5",
    ]).message;
    expect(message).toContain(
      "Scored 2 changed line range(s) from THIS change"
    );
    expect(message).toContain("• src/a.ts:1-3");
    expect(message).toContain("• src/b.ts:5-5");
  });

  it("says so plainly when the run scoped no diff at all", () => {
    // `--all` scores the whole mutate list, so there are no change-derived
    // ranges to name. Saying that is still naming the subject; printing
    // nothing would leave the verdict as anonymous as the fixture.
    expect(classifyStrykerFailure(BREAK_LINE, budgets, null).message).toContain(
      "Scored: every pattern in the project's mutate list (--all), not a diff."
    );
  });

  it("names nothing rather than inventing a subject it was not given", () => {
    // The direct classifier call has no scope, and guessing one would be the
    // same lie in the other direction. Reachable only from a caller that is
    // not the gate: the gate always knows what it scoped.
    expect(classifyStrykerFailure(BREAK_LINE, budgets).message).not.toContain(
      "Scored"
    );
  });

  it("leaves a timeout verdict alone, which measured no score to attribute", () => {
    // The control. A dry run killed by the clock produced no score, so there is
    // nothing for a subject line to be about, and adding one would suggest the
    // run reached the change.
    expect(
      classifyStrykerFailure(DRY_RUN_TIMEOUT_LINE, budgets, ["src/a.ts:1-1"])
        .message
    ).not.toContain("Scored");
  });
});

describe("timeout budgets", () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "lisa-mutation-budgets-"))
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reads both budgets from the project's config", () => {
    write(
      root,
      STRYKER_CONF,
      JSON.stringify({ timeoutMS: 60000, dryRunTimeoutMinutes: 20 })
    );

    expect(resolveTimeoutBudgets(root)).toEqual({
      timeoutMS: 60000,
      dryRunTimeoutMinutes: 20,
      inherited: [],
    });
  });

  it("falls back to Stryker's own numbers and says which they were", () => {
    // The half that matters. A budget the project wrote down is something an
    // operator can go and change; a budget that arrived by omission is
    // Stryker's opinion about a machine it has never seen, and the failure it
    // produces is unactionable until somebody is told that is what happened.
    write(root, STRYKER_CONF, JSON.stringify({ mutate: [SRC_TS] }));

    expect(resolveTimeoutBudgets(root)).toEqual({
      timeoutMS: STRYKER_DEFAULT_TIMEOUT_MS,
      dryRunTimeoutMinutes: STRYKER_DEFAULT_DRY_RUN_TIMEOUT_MINUTES,
      inherited: ["timeoutMS", "dryRunTimeoutMinutes"],
    });
  });

  it("treats a partial declaration as partly inherited", () => {
    write(root, STRYKER_CONF, JSON.stringify({ dryRunTimeoutMinutes: 20 }));

    const budgets = resolveTimeoutBudgets(root);
    expect(budgets.dryRunTimeoutMinutes).toBe(20);
    expect(budgets.inherited).toEqual(["timeoutMS"]);
  });

  it("ignores a value that is not a usable budget", () => {
    // `0` disables nothing in Stryker — it is simply not a budget, and taking
    // it literally would print "exceeded its budget of 0 minutes".
    write(
      root,
      STRYKER_CONF,
      JSON.stringify({ timeoutMS: "60000", dryRunTimeoutMinutes: 0 })
    );

    expect(resolveTimeoutBudgets(root).inherited).toEqual([
      "timeoutMS",
      "dryRunTimeoutMinutes",
    ]);
  });

  it("inherits everything when there is no config at all", () => {
    expect(resolveTimeoutBudgets(root).inherited).toEqual([
      "timeoutMS",
      "dryRunTimeoutMinutes",
    ]);
  });
});

describe("why Stryker failed", () => {
  /** Budgets a project declared for itself. */
  const declared = {
    timeoutMS: 60000,
    dryRunTimeoutMinutes: 20,
    inherited: [] as string[],
  };

  /** Budgets nobody chose. */
  const inheritedBudgets = {
    timeoutMS: STRYKER_DEFAULT_TIMEOUT_MS,
    dryRunTimeoutMinutes: STRYKER_DEFAULT_DRY_RUN_TIMEOUT_MINUTES,
    inherited: ["timeoutMS", "dryRunTimeoutMinutes"],
  };

  it("calls a dry-run timeout a timeout, and names the budget", () => {
    // The defect in one assertion. This transcript used to reach an operator as
    // "mutation score below threshold" — false twice over, since no score was
    // computed and no test is weak.
    const verdict = classifyStrykerFailure(
      "18:13:12 INFO DryRunExecutor Starting initial test run\n" +
        "18:18:19 ERROR DryRunExecutor Initial test run timed out!\n",
      declared
    );

    expect(verdict.outcome).toBe(OUTCOMES.dryRunTimeout);
    expect(verdict.message).toContain("20 minute(s)");
    expect(verdict.message).toContain("NO score was computed");
    expect(verdict.message).toContain("This is a TIMEOUT, not");
    expect(verdict.outcome).not.toBe(OUTCOMES.scoreBelowBreak);
  });

  it("says so when the budget that killed the run was nobody's choice", () => {
    const verdict = classifyStrykerFailure(
      DRY_RUN_TIMEOUT_LINE,
      inheritedBudgets
    );

    expect(verdict.message).toContain("5 minute(s)");
    expect(verdict.message).toContain("Stryker's own default");
    expect(verdict.message).toContain("dryRunTimeoutMinutes");
  });

  it("calls a completed run under the break threshold what it is", () => {
    const verdict = classifyStrykerFailure(BREAK_LINE, declared);

    expect(verdict.outcome).toBe(OUTCOMES.scoreBelowBreak);
    expect(verdict.message).toContain("12.34");
    expect(verdict.message).toContain("32");
    expect(verdict.message).toContain("IS a verdict about your tests");
  });

  it("says how much of a failing score the clock decided", () => {
    const verdict = classifyStrykerFailure(
      [
        "Mutation testing 50% (elapsed: 1m, remaining: 1m) 20/40 tested " +
          "(1 survived, 3 timed out)",
        "Mutation testing 100% (elapsed: 2m, remaining: 0m) 40/40 tested " +
          "(2 survived, 7 timed out)",
        BREAK_LINE,
      ].join("\n"),
      declared
    );

    // The last tally, not the first: the count only settles when the run does.
    expect(verdict.message).toContain("7 mutant(s)");
    expect(verdict.message).toContain("60000ms");
    expect(verdict.message).toContain("scores a timed-out mutant as KILLED");
  });

  it("claims nothing about the tests when it recognises nothing", () => {
    const verdict = classifyStrykerFailure(
      "ERROR Could not resolve the vitest config\nnpm ERR! exit 1\n",
      declared
    );

    expect(verdict.outcome).toBe(OUTCOMES.runFailed);
    expect(verdict.message).toContain("does NOT claim your tests are");
    expect(verdict.message).toContain("Could not resolve the vitest config");
  });

  it("refuses to guess when nothing could be captured", () => {
    const verdict = classifyStrykerFailure(null, inheritedBudgets);

    expect(verdict.outcome).toBe(OUTCOMES.runFailed);
    expect(verdict.message).toContain("could not be captured");
    expect(verdict.message).toContain("dryRunTimeoutMinutes=5");
    expect(verdict.message).toContain("timeoutMS=5000");
    expect(verdict.message).toContain(
      "Nothing here claims your mutation score"
    );
  });
});
