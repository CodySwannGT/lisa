/**
 * Tests for the lint-staged preflight — the guard that proves every tool
 * lint-staged is about to run can actually be started.
 *
 * The defect it exists for is narrow and counter-intuitive: lint-staged fails
 * CLOSED on an ordinary non-zero exit and on a missing executable, and fails
 * OPEN on a present-but-unrunnable one, printing `[FAILED] spawn ENOEXEC` and
 * returning 0. So the ENOEXEC case is the one that has to be pinned by name —
 * a suite that only covered the missing-executable case would have passed
 * against the very behaviour that let a scan report nothing and block nothing.
 *
 * Behaviour is exercised through the real CLI rather than the exported helpers,
 * because the thing under test is an exit code.
 */
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { trackedHookCopies } from "../../helpers/hook-roster.js";

import {
  configPathFrom,
  executableOf,
  invokedAsScript,
  tasksOf,
} from "../../../all/copy-overwrite/scripts/lisa-lint-staged-preflight.mjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(
  REPO_ROOT,
  "all/copy-overwrite/scripts/lisa-lint-staged-preflight.mjs"
);

/** The config filename the hooks name and lint-staged reads. */
const CONFIG = ".lintstagedrc.json";

/** CLI arguments pointing the preflight at that config. */
const CONFIG_ARGS = ["--config", CONFIG] as const;

/**
 * Hooks that must be found by the walk below, whatever else it finds.
 *
 * Derived from what git tracks, so a copy added later raises this floor by
 * itself instead of waiting for someone to remember it
 * (CodySwannGT/lisa#2847).
 */
const KNOWN_HOOKS = [...trackedHookCopies("pre-commit")];

/** Directory names the hook walk never descends into. */
const UNWALKED = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  "plans",
  "projects",
]);

/**
 * Run the preflight CLI and collect its exit code and combined output.
 * @param cwd - Directory to run in.
 * @param args - Arguments after the script path.
 * @returns Exit code and merged stdout/stderr.
 */
const runPreflight = (
  cwd: string,
  args: readonly string[]
): Promise<{ code: number; output: string }> =>
  new Promise(resolve => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd });
    let output = "";
    child.stdout.on("data", chunk => {
      output += String(chunk);
    });
    child.stderr.on("data", chunk => {
      output += String(chunk);
    });
    child.on("close", code => resolve({ code: code ?? -1, output }));
  });

/**
 * A throwaway project directory carrying a lint-staged config.
 * @param config - Contents to write as `.lintstagedrc.json`.
 * @returns Absolute path to the directory.
 */
const fixture = (config: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-preflight-"));
  mkdirSync(path.join(dir, "node_modules", ".bin"), { recursive: true });
  writeFileSync(path.join(dir, CONFIG), config);
  return dir;
};

/**
 * Put an executable-bit-set file in the fixture's local bin directory.
 * @param dir - Fixture directory.
 * @param name - Executable name.
 * @param contents - File contents, shebang included or deliberately not.
 * @returns void
 */
const installBin = (dir: string, name: string, contents: string): void => {
  const target = path.join(dir, "node_modules", ".bin", name);
  writeFileSync(target, contents);
  chmodSync(target, 0o755);
};

/**
 * Whether an ENOEXEC spawn failure is even reachable on this platform.
 *
 * It is not universal, and assuming it was cost two CI-red cycles. POSIX says
 * `execvp` retries with `/bin/sh` when `execve` returns ENOEXEC, and glibc
 * implements exactly that — so on Linux a present-but-unrunnable file SPAWNS
 * (the shell takes it, then exits 126 or 127) and no `error` event ever
 * arrives. macOS does not take that path, so ENOEXEC surfaces.
 *
 * Measured, after a first fixture and a "portable" ELF replacement both failed
 * the same way on Ubuntu: `expected +0 to be 1`, because the probe found
 * nothing wrong. The file's CONTENT is irrelevant on Linux; the fallback is
 * unconditional.
 *
 * Consequence worth stating plainly: the fail-open this guard exists for is
 * **platform-specific**. It is still worth guarding, because pre-commit hooks
 * run on developer machines, but the ENOEXEC assertion cannot be made on CI.
 */
const ENOEXEC_IS_REACHABLE = process.platform !== "linux";

/**
 * Installs a tool that cannot be spawned on ANY platform.
 *
 * Present, but without the executable bit: `execvp` fails with EACCES, and the
 * `/bin/sh` retry applies only to ENOEXEC — so this raises an `error` event
 * everywhere, which is the signal the probe watches for. This is what keeps
 * the guard's core behaviour pinned on CI rather than only on a developer's
 * machine.
 * @param dir - Fixture project root
 * @param name - Bin name to install
 */
const installUnspawnableBin = (dir: string, name: string): void => {
  const target = path.join(dir, "node_modules", ".bin", name);
  writeFileSync(target, "#!/bin/sh\nexit 0\n");
  chmodSync(target, 0o644);
};
/**
 * Every pre-commit hook in the repository that hands work to lint-staged.
 * @returns Repo-relative paths.
 */
const preCommitHooksRunningLintStaged = (): string[] => {
  const found: string[] = [];
  /**
   * Recurse into one directory.
   * @param relative - Repo-relative directory path.
   * @returns void
   */
  const walk = (relative: string): void => {
    for (const entry of readdirSync(path.join(REPO_ROOT, relative), {
      withFileTypes: true,
    })) {
      const next = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!UNWALKED.has(entry.name)) walk(next);
      } else if (
        entry.name === "pre-commit" &&
        readFileSync(path.join(REPO_ROOT, next), "utf8").includes(
          "lint-staged --config"
        )
      ) {
        found.push(next);
      }
    }
  };
  walk("");
  return found;
};

describe("lint-staged preflight — behaviour", () => {
  it("BLOCKS a tool that is present but cannot be spawned", async () => {
    // Runs on every platform. The errno is deliberately NOT asserted: which
    // one a broken tool produces is platform-dependent, and pinning the errno
    // is what made this suite pass on macOS and fail on CI twice.
    const dir = fixture('{ "*.ts": ["lisa-fixture-shim scan"] }');
    installUnspawnableBin(dir, "lisa-fixture-shim");

    const { code, output } = await runPreflight(dir, CONFIG_ARGS);

    expect(code).toBe(1);
    expect(output).toContain("lisa-fixture-shim");
  });

  it.runIf(ENOEXEC_IS_REACHABLE)(
    "BLOCKS a tool that is executable but not runnable (ENOEXEC)",
    async () => {
      // The specific fail-open lint-staged has: it prints `spawn ENOEXEC` and
      // returns 0. A shebang-less text file with the exec bit is what a package
      // leaves behind when a postinstall that should have materialized the real
      // binary never ran.
      //
      // Skipped on Linux because the condition cannot be CONSTRUCTED there, not
      // because it is inconvenient — execvp's /bin/sh fallback means such a file
      // spawns successfully. A skip whose reason is "this platform cannot
      // exhibit the defect" is honest; one that hides a red is not.
      const dir = fixture('{ "*.ts": ["lisa-fixture-enoexec scan"] }');
      installBin(dir, "lisa-fixture-enoexec", "never replaced\n");

      const { code, output } = await runPreflight(dir, CONFIG_ARGS);

      expect(code).toBe(1);
      expect(output).toContain("ENOEXEC");
    }
  );

  it("BLOCKS a tool that is absent entirely (ENOENT)", async () => {
    const dir = fixture('{ "*.ts": ["lisa-fixture-absent --check"] }');

    const { code, output } = await runPreflight(dir, CONFIG_ARGS);

    expect(code).toBe(1);
    expect(output).toContain("ENOENT");
  });

  it("PASSES a runnable tool, and says how many it probed", async () => {
    // The count is load-bearing: a run that proved nothing must not be able to
    // look like a run that proved everything.
    const dir = fixture(
      '{ "*.ts": ["lisa-fixture-real --fix", "lisa-fixture-real scan"] }'
    );
    installBin(dir, "lisa-fixture-real", "#!/bin/sh\nexit 0\n");

    const { code, output } = await runPreflight(dir, CONFIG_ARGS);

    expect(code).toBe(0);
    expect(output).toContain("1 tool(s) verified runnable");
  });

  it("PASSES a tool that rejects the probe argument, because it still started", async () => {
    // Exit status is deliberately not the question — spawning is.
    const dir = fixture('{ "*.ts": ["lisa-fixture-grumpy"] }');
    installBin(dir, "lisa-fixture-grumpy", "#!/bin/sh\nexit 3\n");

    const { code } = await runPreflight(dir, CONFIG_ARGS);

    expect(code).toBe(0);
  });

  it("names every broken tool, not just the first", async () => {
    const dir = fixture(
      '{ "*.ts": ["lisa-fixture-shim-a", "lisa-fixture-shim-b"] }'
    );
    installUnspawnableBin(dir, "lisa-fixture-shim-a");
    installUnspawnableBin(dir, "lisa-fixture-shim-b");

    const { code, output } = await runPreflight(dir, CONFIG_ARGS);

    expect(code).toBe(1);
    expect(output).toContain("2 of 2 tool(s) cannot be started");
  });

  it("BLOCKS when the config is missing", async () => {
    const dir = fixture('{ "*.ts": ["lisa-fixture-real"] }');

    const { code, output } = await runPreflight(dir, [
      "--config",
      "nowhere.json",
    ]);

    expect(code).toBe(1);
    expect(output).toContain("no config at nowhere.json");
  });

  it("BLOCKS when the config is not valid JSON", async () => {
    const dir = fixture("{ not json");

    const { code, output } = await runPreflight(dir, CONFIG_ARGS);

    expect(code).toBe(1);
    expect(output).toContain("is not valid JSON");
  });

  it("BLOCKS an empty config rather than reporting nothing to do", async () => {
    // "Nothing to check" is the report this guard exists to stop trusting.
    const dir = fixture("{}");

    const { code, output } = await runPreflight(dir, CONFIG_ARGS);

    expect(code).toBe(1);
    expect(output).toContain("declares no tasks");
  });

  it("BLOCKS a config whose shape it cannot read", async () => {
    const dir = fixture('{ "*.ts": { "run": "lisa-fixture-real" } }');

    const { code, output } = await runPreflight(dir, CONFIG_ARGS);

    expect(code).toBe(1);
    expect(output).toContain("shape this guard cannot read");
  });

  it("accepts --config in both spellings, and defaults to .lintstagedrc.json", () => {
    expect(configPathFrom(["--config", "a.json"])).toBe("a.json");
    expect(configPathFrom(["--config=b.json"])).toBe("b.json");
    expect(configPathFrom([])).toBe(CONFIG);
  });
});

describe("lint-staged preflight — task parsing", () => {
  it("reads the executable from a task string the way lint-staged spawns it", () => {
    expect(executableOf("ast-grep scan")).toBe("ast-grep");
    expect(executableOf("  prettier --write  ")).toBe("prettier");
    expect(executableOf('"my tool" --flag')).toBe("my tool");
    expect(executableOf("./node_modules/.bin/eslint --fix")).toBe(
      "./node_modules/.bin/eslint"
    );
    expect(executableOf("   ")).toBe("");
  });

  it("collects tasks from both the string and array forms", () => {
    expect(tasksOf({ "*.ts": "a", "*.md": ["b", "c"] })).toEqual({
      tasks: ["a", "b", "c"],
    });
  });

  it("refuses a shape it cannot read instead of returning an empty list", () => {
    // An empty list would flow onward as "nothing to probe" and pass.
    expect(tasksOf(["a"])).toHaveProperty("problem");
    expect(tasksOf(null)).toHaveProperty("problem");
    expect(tasksOf({ "*.ts": 7 })).toHaveProperty("problem");
  });
});

describe("lint-staged preflight — CLI entry detection", () => {
  it("treats a missing process entry path as not invoked", () => {
    const [entryPath] = process.argv.splice(1, 1);

    try {
      expect(invokedAsScript(import.meta.url)).toBe(false);
    } finally {
      if (entryPath !== undefined) process.argv.splice(1, 0, entryPath);
    }
  });

  it("treats an empty explicit entry path as not invoked", () => {
    expect(invokedAsScript(import.meta.url, "")).toBe(false);
  });
});

describe("lint-staged preflight — the configs Lisa ships", () => {
  it("every tool named by this repository's own config really starts", async () => {
    // Runs in required CI, against the real installed toolchain. It is the one
    // arm of this guard that is not pre-commit-only: a shipped config naming a
    // tool that cannot be started goes red here rather than waiting for
    // somebody's commit to quietly scan nothing.
    const { code, output } = await runPreflight(REPO_ROOT, CONFIG_ARGS);

    expect(output, output).toContain("verified runnable");
    expect(code, output).toBe(0);
  });

  it("every task in the shipped stack template names an extractable executable", () => {
    const template = "typescript/copy-overwrite/.lintstagedrc.json";
    const extracted = tasksOf(
      JSON.parse(readFileSync(path.join(REPO_ROOT, template), "utf8"))
    );

    expect(extracted).not.toHaveProperty("problem");
    const tasks = (extracted as { tasks: string[] }).tasks;
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) expect(executableOf(task), task).not.toBe("");
  });
});

describe("lint-staged preflight — wiring", () => {
  const hooks = preCommitHooksRunningLintStaged();

  it("finds the pre-commit hooks it is supposed to be checking", () => {
    // A walk that reached nothing would let every assertion below pass
    // vacuously, which is the same defect class as the bug being fixed.
    expect(hooks.length).toBeGreaterThan(0);
    for (const known of KNOWN_HOOKS) expect(hooks).toContain(known);
  });

  it.each(hooks)("runs the preflight before lint-staged: %s", hook => {
    const text = readFileSync(path.join(REPO_ROOT, hook), "utf8");
    const preflightAt = text.indexOf("lisa-lint-staged-preflight.mjs");

    expect(preflightAt).toBeGreaterThanOrEqual(0);
    expect(preflightAt).toBeLessThan(text.indexOf("lint-staged --config"));
  });

  it.each(hooks)(
    "runs the preflight before the gate runner too, because a gate can run lint-staged: %s",
    hook => {
      const text = readFileSync(path.join(REPO_ROOT, hook), "utf8");
      const runnerAt = text.indexOf("lisa-run-gates.mjs");
      if (runnerAt < 0) return;

      expect(text.indexOf("lisa-lint-staged-preflight.mjs")).toBeLessThan(
        runnerAt
      );
    }
  );

  it.each(hooks)("exits on a failing preflight: %s", hook => {
    const text = readFileSync(path.join(REPO_ROOT, hook), "utf8");

    expect(text).toContain("LINT_STAGED_PREFLIGHT_STATUS=$?");
    expect(text).toContain("exit $LINT_STAGED_PREFLIGHT_STATUS");
  });

  it.each(hooks)(
    "treats an unavailable preflight as a block, never a skip: %s",
    hook => {
      const text = readFileSync(path.join(REPO_ROOT, hook), "utf8");

      expect(text).toContain(
        "❌ Commit blocked: the lint-staged preflight could not run."
      );
    }
  );
});
