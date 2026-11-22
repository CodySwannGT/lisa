/**
 * `lisa check` (CodySwannGT/lisa#4601): argument handling, the cache-off
 * short circuit, the clean-tree refusal, and how the push-gate runner's exit
 * codes become the command's verdict. The runner itself is injected; the real
 * runner is driven end to end by `tests/integration/lisa-check-then-push.test.ts`.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addCheckCommand,
  CACHE_OFF_MESSAGE,
  DEFAULT_MAX_WAIT,
  parseMaxWait,
  runCheck,
  type CheckDependencies,
  type RunnerRequest,
} from "../../../src/cli/check-cmd.js";
import { createProgram } from "../../../src/cli/index.js";

const roots: string[] = [];
const TREE = "abcdef0123456789abcdef0123456789abcdef01";
const RUNNER_FILE = "lisa-run-gates.mjs";

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * A project directory with an optional `.lisa.config.json` and runner copy.
 * @param config - Config object, or null for no file
 * @param withRunner - Whether `scripts/lisa-run-gates.mjs` exists
 * @returns Project root
 */
function projectDir(config: object | null, withRunner = true): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-check-unit-"));
  roots.push(root);
  if (config) {
    writeFileSync(path.join(root, ".lisa.config.json"), JSON.stringify(config));
  }
  if (withRunner) {
    mkdirSync(path.join(root, "scripts"));
    writeFileSync(path.join(root, "scripts", RUNNER_FILE), "");
  }
  return root;
}

/**
 * Collaborators with a clean tree and a runner that exits with `code`.
 * @param root - Project root
 * @param overrides - Replacements
 * @returns Dependencies plus captured output and runner requests
 */
function deps(root: string, overrides: Partial<CheckDependencies> = {}) {
  const logs: string[] = [];
  const errors: string[] = [];
  const requests: RunnerRequest[] = [];
  const dependencies: CheckDependencies = {
    cwd: root,
    env: {},
    log: line => logs.push(line),
    error: line => errors.push(line),
    lisaRoot: path.join(root, "no-such-lisa"),
    git: args => {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return root;
      if (args[0] === "status") return "";
      if (args[0] === "rev-parse") return TREE;
      return null;
    },
    runRunner: request => {
      requests.push(request);
      return 0;
    },
    ...overrides,
  };
  return { dependencies, logs, errors, requests };
}

const CACHE_ON = { pushGate: { cache: true } };

describe("parseMaxWait", () => {
  it.each([
    ["1800", "1800"],
    ["30m", "30m"],
    ["2h", "2h"],
    ["45s", "45s"],
  ])("accepts %s", (input, expected) => {
    expect(parseMaxWait(input)).toBe(expected);
  });

  it.each(["", "0", "0m", "-5", "5d", "ten", "1.5h"])("refuses %j", input => {
    expect(parseMaxWait(input)).toBeNull();
  });

  it("defaults to a bound longer than the in-push five minutes", () => {
    expect(DEFAULT_MAX_WAIT).toBe("30m");
  });
});

describe("runCheck", () => {
  it("exits 0 at once without running anything when the cache is off", async () => {
    const root = projectDir({});
    const { dependencies, logs, requests } = deps(root);
    expect(await runCheck({}, dependencies)).toBe(0);
    expect(requests).toEqual([]);
    expect(logs.join("\n")).toContain(CACHE_OFF_MESSAGE);
    expect(CACHE_OFF_MESSAGE).toBe(
      "gate pass cache is off for this project; push directly (the push runs every gate)"
    );
  });

  it("treats a project with no config as cache off", async () => {
    const root = projectDir(null);
    const { dependencies, requests } = deps(root);
    expect(await runCheck({}, dependencies)).toBe(0);
    expect(requests).toEqual([]);
  });

  it("runs the gates for a TypeScript host that does not set the cache (#4611)", async () => {
    const root = projectDir({});
    writeFileSync(path.join(root, "tsconfig.json"), "{}");
    const { dependencies, requests } = deps(root);
    expect(await runCheck({}, dependencies)).toBe(0);
    expect(requests).toHaveLength(1);
  });

  it("lets a TypeScript host's explicit cache:false win (#4611)", async () => {
    const root = projectDir({ pushGate: { cache: false } });
    writeFileSync(path.join(root, "tsconfig.json"), "{}");
    const { dependencies, requests } = deps(root);
    expect(await runCheck({}, dependencies)).toBe(0);
    expect(requests).toEqual([]);
  });

  it("treats an explicit cache:false as off", async () => {
    const root = projectDir({ pushGate: { cache: false } });
    const { dependencies, requests } = deps(root);
    expect(await runCheck({}, dependencies)).toBe(0);
    expect(requests).toEqual([]);
  });

  it("refuses a malformed pushGate.cache rather than guessing", async () => {
    const root = projectDir({ pushGate: { cache: "yes" } });
    const { dependencies, errors, requests } = deps(root);
    expect(await runCheck({}, dependencies)).toBe(1);
    expect(requests).toEqual([]);
    expect(errors.join("\n")).toMatch(/pushGate\.cache/u);
  });

  it("says why when this run disables the cache", async () => {
    const root = projectDir(CACHE_ON);
    const { dependencies, logs, requests } = deps(root, {
      env: { LISA_GATE_CACHE: "off" },
    });
    expect(await runCheck({}, dependencies)).toBe(0);
    expect(requests).toEqual([]);
    expect(logs.join("\n")).toContain("LISA_GATE_CACHE=off");
  });

  it("does nothing under CI, where the cache is never used", async () => {
    const root = projectDir(CACHE_ON);
    const { dependencies, requests } = deps(root, { env: { CI: "true" } });
    expect(await runCheck({}, dependencies)).toBe(0);
    expect(requests).toEqual([]);
  });

  it("refuses a dirty tree, says to commit first, and runs nothing", async () => {
    const root = projectDir(CACHE_ON);
    const { dependencies, errors, requests } = deps(root, {
      git: args => {
        if (args[1] === "--show-toplevel") return root;
        if (args[0] === "status") return " M src/a.ts";
        return TREE;
      },
    });
    expect(await runCheck({}, dependencies)).toBe(1);
    expect(requests).toEqual([]);
    expect(errors.join("\n")).toMatch(/commit first/iu);
  });

  it("refuses outside a git repository", async () => {
    const root = projectDir(CACHE_ON);
    const { dependencies, errors } = deps(root, { git: () => null });
    expect(await runCheck({}, dependencies)).toBe(1);
    expect(errors.join("\n")).toMatch(/git repository/u);
  });

  it("refuses an invalid --max-wait before touching git", async () => {
    const root = projectDir(CACHE_ON);
    const git = vi.fn(() => "");
    const { dependencies, errors } = deps(root, { git });
    expect(await runCheck({ maxWait: "soon" }, dependencies)).toBe(1);
    expect(git).not.toHaveBeenCalled();
    expect(errors.join("\n")).toMatch(/--max-wait/u);
  });

  it("runs the project's push gates with the long admission bound", async () => {
    const root = projectDir(CACHE_ON);
    const { dependencies, requests, logs } = deps(root);
    expect(await runCheck({}, dependencies)).toBe(0);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.runner).toBe(path.join(root, "scripts", RUNNER_FILE));
    expect(request?.cwd).toBe(root);
    expect(request?.args[0]).toBe("--moment=push");
    expect(request?.args[1]).toMatch(/^--coverage=/u);
    expect(request?.env.LISA_ADMISSION_MAX_WAIT).toBe("30m");
    expect(logs.join("\n")).toMatch(/push now/iu);
  });

  it("passes an explicit --max-wait through", async () => {
    const root = projectDir(CACHE_ON);
    const { dependencies, requests } = deps(root);
    expect(await runCheck({ maxWait: "2h" }, dependencies)).toBe(0);
    expect(requests[0]?.env.LISA_ADMISSION_MAX_WAIT).toBe("2h");
  });

  it("falls back to the runner Lisa ships when the project has no copy", async () => {
    const root = projectDir(CACHE_ON, false);
    const lisaRoot = path.join(root, "lisa-package");
    const shipped = path.join(
      lisaRoot,
      "all",
      "copy-overwrite",
      "scripts",
      RUNNER_FILE
    );
    mkdirSync(path.dirname(shipped), { recursive: true });
    writeFileSync(shipped, "");
    const { dependencies, requests } = deps(root, { lisaRoot });
    expect(await runCheck({}, dependencies)).toBe(0);
    expect(requests[0]?.runner).toBe(shipped);
  });

  it("fails when no gate runner can be found", async () => {
    const root = projectDir(CACHE_ON, false);
    const { dependencies, errors } = deps(root);
    expect(await runCheck({}, dependencies)).toBe(1);
    expect(errors.join("\n")).toMatch(/gate runner/u);
  });

  it("blocks with exit 1 when a required gate fails", async () => {
    const root = projectDir(CACHE_ON);
    const { dependencies, errors } = deps(root, { runRunner: () => 1 });
    expect(await runCheck({}, dependencies)).toBe(1);
    expect(errors.join("\n")).toMatch(/FAILED/u);
    expect(errors.join("\n")).toMatch(/before pushing/u);
  });

  it("exits 0 and says the push runs its built-in checks when the registry does not govern push", async () => {
    const root = projectDir(CACHE_ON);
    const { dependencies, logs } = deps(root, { runRunner: () => 78 });
    expect(await runCheck({}, dependencies)).toBe(0);
    expect(logs.join("\n")).toMatch(/built-in checks/u);
  });

  it.each([70, null])(
    "fails when the runner could not run (%s)",
    async status => {
      const root = projectDir(CACHE_ON);
      const { dependencies, errors } = deps(root, {
        runRunner: () => status,
      });
      expect(await runCheck({}, dependencies)).toBe(1);
      expect(errors.join("\n")).toMatch(/NOT a pass/u);
    }
  );
});

describe("Lisa's own configuration", () => {
  it("turns the cache on for itself in exactly one pushGate block", () => {
    const configPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      ".lisa.config.json"
    );
    const raw = readFileSync(configPath, "utf8");
    // JSON.parse keeps only the LAST of two duplicate keys, so a second
    // `pushGate` block silently drops whichever switch the first one held.
    expect(raw.split('"pushGate"').length - 1).toBe(1);
    expect(JSON.parse(raw).pushGate).toMatchObject({
      cache: true,
      buildOnce: true,
    });
  });
});

describe("addCheckCommand", () => {
  it("registers `check` with --max-wait and forwards it", async () => {
    const run = vi.fn(async () => 0);
    const program = new Command().exitOverride();
    addCheckCommand(program, { runCheck: run });
    await program.parseAsync(["node", "lisa", "check", "--max-wait", "45m"]);
    expect(run).toHaveBeenCalledWith({ maxWait: "45m" });
  });

  it("is registered on the root lisa program", () => {
    const names = createProgram().commands.map(command => command.name());
    expect(names).toContain("check");
  });

  it("sets a non-zero exit code on a failed check", async () => {
    const run = vi.fn(async () => 1);
    const program = new Command().exitOverride();
    addCheckCommand(program, { runCheck: run });
    const before = process.exitCode;
    await program.parseAsync(["node", "lisa", "check"]);
    expect(process.exitCode).toBe(1);
    process.exitCode = before;
  });
});
