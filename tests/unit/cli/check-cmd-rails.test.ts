/**
 * `lisa check` in a Rails project (CodySwannGT/lisa#4613): it runs the Rails
 * pre-push gate set through `scripts/lisa-rails-gates.mjs --all` instead of the
 * gate registry runner, with the pass cache on unless the project sets
 * `pushGate.cache: false`. The script itself is injected here; the real one
 * runs end to end in `tests/integration/rails-push-gate-cache.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CACHE_OFF_MESSAGE,
  RAILS_RUNNER,
  runCheck,
  type CheckDependencies,
  type RunnerRequest,
} from "../../../src/cli/check-cmd.js";

const roots: string[] = [];
const TREE = "abcdef0123456789abcdef0123456789abcdef01";

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * Collaborators with a clean tree and a runner that exits 0.
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

/**
 * A Rails project (`config/application.rb`) carrying the Rails gate script.
 * @param config - Config object, or null for no file
 * @param withScript - Whether `scripts/lisa-rails-gates.mjs` exists
 * @returns Project root
 */
function railsProject(config: object | null, withScript = true): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-check-rails-"));
  roots.push(root);
  if (config) {
    writeFileSync(path.join(root, ".lisa.config.json"), JSON.stringify(config));
  }
  mkdirSync(path.join(root, "config"));
  writeFileSync(path.join(root, "config", "application.rb"), "");
  if (withScript) {
    mkdirSync(path.join(root, "scripts"));
    writeFileSync(path.join(root, RAILS_RUNNER), "");
  }
  return root;
}

describe("runCheck in a Rails project (CodySwannGT/lisa#4613)", () => {
  it("runs the Rails gate set through its own script, cache on by default", async () => {
    const root = railsProject(null);
    const { dependencies, requests, logs } = deps(root);
    expect(await runCheck({}, dependencies)).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.runner).toBe(path.join(root, RAILS_RUNNER));
    expect(requests[0]?.args).toEqual(["--all"]);
    expect(requests[0]?.env.LISA_ADMISSION_MAX_WAIT).toBe("30m");
    expect(logs.join("\n")).toMatch(/Rails push gates/u);
    expect(logs.join("\n")).toMatch(/push now/iu);
  });

  it("lets an explicit pushGate.cache:false switch it off", async () => {
    const root = railsProject({ pushGate: { cache: false } });
    const { dependencies, requests, logs } = deps(root);
    expect(await runCheck({}, dependencies)).toBe(0);
    expect(requests).toHaveLength(0);
    expect(logs).toEqual([CACHE_OFF_MESSAGE]);
  });

  it("fails, naming the script, when the Rails gate script is missing", async () => {
    const root = railsProject(null, false);
    const { dependencies, errors, requests } = deps(root);
    expect(await runCheck({}, dependencies)).toBe(1);
    expect(requests).toHaveLength(0);
    expect(errors.join("\n")).toMatch(/lisa-rails-gates\.mjs/u);
  });

  it("blocks with exit 1 when a Rails gate fails", async () => {
    const root = railsProject(null);
    const { dependencies } = deps(root, { runRunner: () => 1 });
    expect(await runCheck({}, dependencies)).toBe(1);
  });
});
