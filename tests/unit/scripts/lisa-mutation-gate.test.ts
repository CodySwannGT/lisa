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
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FALLBACK_MUTATE,
  OUTCOMES,
  compileMutatePatterns,
  countMutateTargetsInRepo,
  envFlag,
  globToRegExp,
  isMutateTarget,
  normalizePath,
  readGate,
  resolveDiffBase,
  resolveMutateDeclaration,
  runGate,
  selectChangedTargets,
  stripMutationRange,
} from "../../../typescript/copy-overwrite/scripts/lisa-mutation.mjs";

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

/** Body for a second source file added on a topic branch. */
const SRC_B = "export const b = 2;\n";

/** A path whose comma must stay literal outside brace alternation. */
const COMMA_PATH = "src/a,b.ts";

/** A file no mutate list selects — the empty-diff control's subject. */
const DOC = "docs/notes.md";

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
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
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
  const bin = path.join(root, "node_modules", ".bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, "stryker"),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${path.join(root, "stryker-argv.txt")}"\n` +
      `printf '%s' "\${MUTATION_SCOPE-<unset>}" > "${path.join(root, "stryker-scope.txt")}"\n` +
      `exit ${exitCode}\n`
  );
  fs.chmodSync(path.join(bin, "stryker"), 0o755);
};

/** How the stand-in was invoked, or null when it never ran. */
const strykerArgv = (root: string): string[] | null => {
  const recorded = path.join(root, "stryker-argv.txt");
  if (!fs.existsSync(recorded)) return null;
  return fs.readFileSync(recorded, "utf8").trim().split("\n");
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
    expect(scope.selected).toEqual(["src/b.ts"]);
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

  it("hands Stryker exactly the changed mutate targets", () => {
    scenario([SRC_TS], [GUARD_TS, DOC]);
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(0);
    expect(strykerArgv(root)).toEqual(["run", "--mutate", GUARD_TS]);
    expect(output()).toBe(
      "🧬 mutation-gate: scoped-run — Stryker on 1 of 2 changed file(s), " +
        "selected by stryker.conf.json:\n" +
        "   • src/guard.ts"
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
    expect(strykerScope(root)).toBe(GUARD_TS);
  });

  it("joins several selected files the way --mutate parses them", () => {
    // One selected file hides the separator entirely: `join(",")` and
    // `join("")` produce the same string. Two do not, and `--mutate` is a
    // comma-separated list, so the separator is a real part of the contract.
    scenario([SRC_TS], [GUARD_TS, "src/second.ts", DOC]);
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(0);
    expect(strykerArgv(root)).toEqual([
      "run",
      "--mutate",
      `${GUARD_TS},src/second.ts`,
    ]);
    expect(strykerScope(root)).toBe(`${GUARD_TS},src/second.ts`);
  });

  it("fails the gate when Stryker fails it", () => {
    // The gate's verdict IS Stryker's verdict. A wrapper that swallowed a
    // non-zero status would be green forever, which is the whole failure class
    // this gate exists to detect, relocated into the gate.
    scenario([SRC_TS], [GUARD_TS]);
    fakeStryker(root, 1);

    expect(runGate(root)).toBe(1);
  });

  it("selects a .mjs guard outside src/, which the old filter could not", () => {
    write(root, GUARD_MJS, "export const a = 1;\n");
    commit(root, "seed");
    scenario([GUARD_MJS], [GUARD_MJS]);
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(0);
    expect(strykerArgv(root)).toEqual(["run", "--mutate", GUARD_MJS]);
  });

  it("reports nothing-to-mutate distinguishably, and never starts Stryker", () => {
    // The control this whole change turns on. A branch that touched no mutate
    // target exits 0 — the same code a real passing run exits with — so the
    // ONLY thing separating them is what is printed.
    scenario([SRC_TS], [DOC]);
    fakeStryker(root, 0);

    expect(runGate(root)).toBe(0);
    expect(strykerArgv(root), "Stryker must not have run").toBeNull();
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
    expect(strykerArgv(root)).toEqual(["run", "--mutate", GUARD_TS]);
  });

  it("lets MUTATION_SINCE choose the base CI diffs against", () => {
    scenario([SRC_TS], [GUARD_TS]);
    git(root, ["branch", "release", "main"]);
    fakeStryker(root, 0);
    process.env.MUTATION_SINCE = "release";

    expect(runGate(root)).toBe(0);
    expect(strykerArgv(root)).toEqual(["run", "--mutate", GUARD_TS]);
  });
});
