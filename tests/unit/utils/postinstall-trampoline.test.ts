/* eslint-disable max-lines -- Test file requires extensive test cases covering CI + interactive trampoline modes */
/**
 * Unit tests for the postinstall reconciliation trampoline.
 *
 * Context: `bun add` (and similar package-manager mutations in npm/yarn/pnpm) reads
 * package.json into memory at the start of the command and rewrites it at the end,
 * clobbering any changes postinstall scripts make to package.json. Lisa's
 * `force.resolutions`/`force.overrides` edits get lost whenever a project runs
 * `bun add -d @codyswann/lisa@latest`.
 *
 * The trampoline works around this by spawning a fully detached child process that
 * waits for the package manager to exit and re-runs Lisa. These tests cover the
 * decision logic (when to schedule), the dist-path resolver, and the detached-spawn
 * behaviour (exits immediately, inherits correct env).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import {
  detectPackageManagers,
  getLisaDistDir,
  getLockfileRegenPlan,
  hashFile,
  isRunningAsLifecycleScript,
  isRunningAsTrampoline,
  isRunningInCI,
  scheduleReconciliationChild,
  shouldSchedulePostinstallReconciliation,
} from "../../../src/utils/postinstall-trampoline.js";

// Use project-local paths (not /tmp/*) to avoid sonarjs's publicly-writable-directory
// warnings. These are never actually read/written — they are fixtures passed to
// spawn for assertion purposes.
const FAKE_PROJECT_DIR = "./fake/project";
const FAKE_LISA_DIST = "./fake/lisa/dist";
const FAKE_PACKAGE_JSON_PATH = "./fake/project/package.json";

// Lockfile base names used across detection, plan, and hash tests. Named constants
// silence sonarjs/no-duplicate-string and make the intent obvious at call sites.
const BUN_LOCK = "bun.lock";
const NPM_LOCK = "package-lock.json";
const PNPM_LOCK = "pnpm-lock.yaml";
const YARN_LOCK = "yarn.lock";
const IGNORE_SCRIPTS = "--ignore-scripts";
const INSTALL_CMD = "install";
const PACKAGE_JSON = "package.json";

describe("postinstall-trampoline", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env vars mutated by individual tests
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("isRunningAsLifecycleScript", () => {
    it("returns true when npm_package_json is set", () => {
      process.env.npm_package_json = FAKE_PACKAGE_JSON_PATH;
      expect(isRunningAsLifecycleScript()).toBe(true);
    });

    it("returns false when npm_package_json is unset", () => {
      delete process.env.npm_package_json;
      expect(isRunningAsLifecycleScript()).toBe(false);
    });

    it("returns false when npm_package_json is the empty string", () => {
      process.env.npm_package_json = "";
      expect(isRunningAsLifecycleScript()).toBe(false);
    });
  });

  describe("isRunningAsTrampoline", () => {
    it("returns true when LISA_POSTINSTALL_TRAMPOLINE is '1'", () => {
      process.env.LISA_POSTINSTALL_TRAMPOLINE = "1";
      expect(isRunningAsTrampoline()).toBe(true);
    });

    it("returns false when LISA_POSTINSTALL_TRAMPOLINE is unset", () => {
      delete process.env.LISA_POSTINSTALL_TRAMPOLINE;
      expect(isRunningAsTrampoline()).toBe(false);
    });

    it("returns false when LISA_POSTINSTALL_TRAMPOLINE has a different value", () => {
      process.env.LISA_POSTINSTALL_TRAMPOLINE = "true";
      expect(isRunningAsTrampoline()).toBe(false);
    });
  });

  describe("shouldSchedulePostinstallReconciliation", () => {
    it("returns true inside a lifecycle script when not a trampoline and not dry-run", () => {
      process.env.npm_package_json = FAKE_PACKAGE_JSON_PATH;
      delete process.env.LISA_POSTINSTALL_TRAMPOLINE;
      expect(shouldSchedulePostinstallReconciliation(false)).toBe(true);
    });

    it("returns false when in dry-run mode", () => {
      process.env.npm_package_json = FAKE_PACKAGE_JSON_PATH;
      delete process.env.LISA_POSTINSTALL_TRAMPOLINE;
      expect(shouldSchedulePostinstallReconciliation(true)).toBe(false);
    });

    it("returns false when already running as the trampoline child", () => {
      process.env.npm_package_json = FAKE_PACKAGE_JSON_PATH;
      process.env.LISA_POSTINSTALL_TRAMPOLINE = "1";
      expect(shouldSchedulePostinstallReconciliation(false)).toBe(false);
    });

    it("returns false outside a lifecycle script", () => {
      delete process.env.npm_package_json;
      delete process.env.LISA_POSTINSTALL_TRAMPOLINE;
      expect(shouldSchedulePostinstallReconciliation(false)).toBe(false);
    });
  });

  describe("getLisaDistDir", () => {
    it("resolves to the parent directory of the caller module", () => {
      // Simulate utils/postinstall-trampoline.js at <dist>/utils/postinstall-trampoline.js
      const fakeModulePath = path.resolve(
        "/fake/dist/utils/postinstall-trampoline.js"
      );
      const fakeModuleUrl = pathToFileURL(fakeModulePath).toString();
      expect(getLisaDistDir(fakeModuleUrl)).toBe(path.resolve("/fake/dist"));
    });
  });

  describe("detectPackageManagers", () => {
    /**
     * Create a disposable directory containing empty "lockfile" sentinel files.
     *
     * detectPackageManagers uses lockfile presence as the sole signal, so empty
     * files are enough to drive the detection logic. The scratch directory is
     * intentionally ephemeral — we never run a real package manager against it.
     * @param lockfiles - Lockfile base names to create
     * @returns Absolute path to the scratch directory
     */
    function withLockfiles(lockfiles: readonly string[]): string {
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "lisa-detect-pm-test-")
      );
      for (const file of lockfiles) {
        fs.writeFileSync(path.join(dir, file), "");
      }
      return dir;
    }

    it("returns empty list when no lockfile is present", () => {
      const dir = withLockfiles([]);
      try {
        expect(detectPackageManagers(dir)).toEqual([]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("detects bun from bun.lock", () => {
      const dir = withLockfiles([BUN_LOCK]);
      try {
        expect(detectPackageManagers(dir)).toEqual(["bun"]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("detects npm from package-lock.json", () => {
      const dir = withLockfiles([NPM_LOCK]);
      try {
        expect(detectPackageManagers(dir)).toEqual(["npm"]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("detects pnpm from pnpm-lock.yaml", () => {
      const dir = withLockfiles([PNPM_LOCK]);
      try {
        expect(detectPackageManagers(dir)).toEqual(["pnpm"]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("detects yarn from yarn.lock", () => {
      const dir = withLockfiles([YARN_LOCK]);
      try {
        expect(detectPackageManagers(dir)).toEqual(["yarn"]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("detects both lockfiles when bun.lock and package-lock.json coexist (dual-lockfile CDK pattern)", () => {
      const dir = withLockfiles([BUN_LOCK, NPM_LOCK]);
      try {
        const detected = detectPackageManagers(dir);
        expect(detected).toContain("bun");
        expect(detected).toContain("npm");
        expect(detected.length).toBe(2);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("getLockfileRegenPlan", () => {
    it("maps bun to `bun install --ignore-scripts`", () => {
      const plan = getLockfileRegenPlan("bun");
      expect(plan.pm).toBe("bun");
      expect(plan.lockfile).toBe(BUN_LOCK);
      expect(plan.command).toBe("bun");
      expect(plan.args).toContain(INSTALL_CMD);
      expect(plan.args).toContain(IGNORE_SCRIPTS);
    });

    it("maps npm to `npm install --package-lock-only --ignore-scripts`", () => {
      const plan = getLockfileRegenPlan("npm");
      expect(plan.pm).toBe("npm");
      expect(plan.lockfile).toBe(NPM_LOCK);
      expect(plan.command).toBe("npm");
      expect(plan.args).toContain("--package-lock-only");
      expect(plan.args).toContain(IGNORE_SCRIPTS);
    });

    it("maps pnpm to `pnpm install --lockfile-only --ignore-scripts`", () => {
      const plan = getLockfileRegenPlan("pnpm");
      expect(plan.pm).toBe("pnpm");
      expect(plan.lockfile).toBe(PNPM_LOCK);
      expect(plan.command).toBe("pnpm");
      expect(plan.args).toContain("--lockfile-only");
      expect(plan.args).toContain(IGNORE_SCRIPTS);
    });

    it("maps yarn to `yarn install --mode update-lockfile`", () => {
      const plan = getLockfileRegenPlan("yarn");
      expect(plan.pm).toBe("yarn");
      expect(plan.lockfile).toBe(YARN_LOCK);
      expect(plan.command).toBe("yarn");
      expect(plan.args).toContain(INSTALL_CMD);
      expect(plan.args).toContain("--mode");
      expect(plan.args).toContain("update-lockfile");
    });
  });

  describe("hashFile", () => {
    it("returns a hex sha256 digest for a file that exists", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-hash-test-"));
      try {
        const filePath = path.join(dir, PACKAGE_JSON);
        fs.writeFileSync(filePath, JSON.stringify({ name: "x" }));
        const hash = hashFile(filePath);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("produces different hashes for different contents (used to detect package.json mutation)", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-hash-test-"));
      try {
        const filePath = path.join(dir, PACKAGE_JSON);
        fs.writeFileSync(filePath, JSON.stringify({ name: "x" }));
        const before = hashFile(filePath);
        fs.writeFileSync(filePath, JSON.stringify({ name: "x", version: "1" }));
        const after = hashFile(filePath);
        expect(before).not.toBe(after);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("returns null when the file does not exist", () => {
      expect(hashFile("/definitely/not/a/real/file.json")).toBeNull();
    });
  });

  describe("isRunningInCI", () => {
    /**
     * Clear VITEST / JEST_WORKER_ID so the CI detection branches can run
     * under a test runner. The afterEach hook restores them from originalEnv.
     */
    function clearTestRunnerEnv(): void {
      delete process.env.VITEST;
      delete process.env.JEST_WORKER_ID;
    }

    it("returns true when CI=true", () => {
      clearTestRunnerEnv();
      process.env.CI = "true";
      delete process.env.GITHUB_ACTIONS;
      delete process.env.CONTINUOUS_INTEGRATION;
      expect(isRunningInCI()).toBe(true);
    });

    it("returns true when CI=1", () => {
      clearTestRunnerEnv();
      process.env.CI = "1";
      delete process.env.GITHUB_ACTIONS;
      delete process.env.CONTINUOUS_INTEGRATION;
      expect(isRunningInCI()).toBe(true);
    });

    it("returns true when GITHUB_ACTIONS=true", () => {
      clearTestRunnerEnv();
      delete process.env.CI;
      process.env.GITHUB_ACTIONS = "true";
      delete process.env.CONTINUOUS_INTEGRATION;
      expect(isRunningInCI()).toBe(true);
    });

    it("returns true when CONTINUOUS_INTEGRATION=true", () => {
      clearTestRunnerEnv();
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      process.env.CONTINUOUS_INTEGRATION = "true";
      expect(isRunningInCI()).toBe(true);
    });

    it("returns true when both CI and GITHUB_ACTIONS are set", () => {
      clearTestRunnerEnv();
      process.env.CI = "true";
      process.env.GITHUB_ACTIONS = "true";
      expect(isRunningInCI()).toBe(true);
    });

    it("returns false when no CI env vars are set", () => {
      clearTestRunnerEnv();
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      delete process.env.CONTINUOUS_INTEGRATION;
      expect(isRunningInCI()).toBe(false);
    });

    it("returns false when CI has an unrelated value", () => {
      clearTestRunnerEnv();
      process.env.CI = "false";
      delete process.env.GITHUB_ACTIONS;
      delete process.env.CONTINUOUS_INTEGRATION;
      expect(isRunningInCI()).toBe(false);
    });

    it("returns false under Vitest even when CI=true (avoids blocking test runs)", () => {
      process.env.VITEST = "true";
      process.env.CI = "true";
      expect(isRunningInCI()).toBe(false);
    });

    it("returns false under Jest even when CI=true (avoids blocking test runs)", () => {
      delete process.env.VITEST;
      process.env.JEST_WORKER_ID = "1";
      process.env.CI = "true";
      expect(isRunningInCI()).toBe(false);
    });
  });

  describe("scheduleReconciliationChild", () => {
    /**
     * Minimal fake ChildProcess good enough for the assertions below.
     * Exposes an event emitter (`on`) used for the CI-mode await, plus
     * `unref` so the detached-mode branch can verify the call.
     */
    type FakeChild = {
      on: ReturnType<typeof vi.fn>;
      unref: ReturnType<typeof vi.fn>;
      emit: (event: string, ...args: readonly unknown[]) => void;
    };

    /**
     * Build a fake ChildProcess that records `.on` registrations and lets
     * tests fire them synchronously via `.emit`.
     * @returns Fake child + its unref/on spies
     */
    function makeFakeChild(): FakeChild {
      const handlers: Record<
        string,
        Array<(...args: readonly unknown[]) => void>
      > = {};
      const on = vi.fn(
        (event: string, handler: (...args: unknown[]) => void) => {
          const list = handlers[event] ?? [];
          list.push(handler);
          handlers[event] = list;
        }
      );
      const unref = vi.fn();
      return {
        on,
        unref,
        emit: (event, ...args) => {
          for (const h of handlers[event] ?? []) h(...args);
        },
      };
    }

    it("spawns a detached process with unref outside CI (interactive mode)", async () => {
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      delete process.env.CONTINUOUS_INTEGRATION;

      const child = makeFakeChild();
      // Inject spawnFn directly — avoids vi.doMock of native node:child_process,
      // which is unreliable under v8 coverage on CI runners.
      const spawnSpy = vi.fn().mockReturnValue(child);

      await scheduleReconciliationChild(
        FAKE_PROJECT_DIR,
        FAKE_LISA_DIST,
        4242,
        spawnSpy as unknown as typeof spawn
      );

      expect(spawnSpy).toHaveBeenCalledTimes(1);
      const [nodeBin, args, opts] = spawnSpy.mock.calls[0] as [
        string,
        readonly string[],
        { detached?: boolean; stdio?: string; env?: Record<string, string> },
      ];
      expect(nodeBin).toBe(process.execPath);
      expect(args[0]).toBe("-e");
      // The inline trampoline source must embed the parent PID, lisa entrypoint,
      // and project dir so it runs without any cwd/PATH assumptions.
      expect(args[1]).toContain("4242");
      expect(args[1]).toContain(path.join(FAKE_LISA_DIST, "index.js"));
      expect(args[1]).toContain(FAKE_PROJECT_DIR);
      // The trampoline source must carry the lockfile regen plans so the child
      // can detect the project's package manager after Lisa re-applies and sync
      // the lockfile to match the new package.json (prevents "lockfile had
      // changes, but lockfile is frozen" failures in CI jobs).
      expect(args[1]).toContain(BUN_LOCK);
      expect(args[1]).toContain(NPM_LOCK);
      expect(args[1]).toContain(PNPM_LOCK);
      expect(args[1]).toContain(YARN_LOCK);
      expect(args[1]).toContain(IGNORE_SCRIPTS);
      expect(opts.detached).toBe(true);
      expect(opts.stdio).toBe("ignore");
      // Trampoline flag set so the re-run does not itself attempt to reschedule
      expect(opts.env?.LISA_POSTINSTALL_TRAMPOLINE).toBe("1");
      // Lifecycle env stripped so the re-run is not misidentified as postinstall
      expect(opts.env?.npm_package_json).toBe("");
      expect(child.unref).toHaveBeenCalledTimes(1);
      // Detached mode must not wait on the child process — never registers an
      // exit listener because the parent package manager needs to return.
      expect(child.on).not.toHaveBeenCalled();
    });

    it("spawns a detached process with unref in CI (avoids deadlock with package manager)", async () => {
      // CI mode must NOT block waiting for the trampoline child. The package
      // manager (PM) is blocked waiting for Lisa (postinstall) to return, and
      // the trampoline child waits for the PM to exit before running — creating
      // a circular wait that resolves only after the 120 s timeout, at which
      // point the trampoline exits WITHOUT running reconciliation.
      //
      // Fix: CI mode behaves the same as interactive mode (detached + unref'd)
      // so the PM can exit, the trampoline detects the exit, and reconciliation
      // actually runs.
      //
      // NOTE: scheduleReconciliationChild has no CI-specific branch — both modes
      // hit the same code path (always spawn detached + unref'd). This test is a
      // regression guard against future CI-specific blocking behavior; it does not
      // need to run under real CI env vars. spawnFn is injected directly to avoid
      // vi.doMock of node:child_process, which is unreliable under v8 coverage on
      // real CI runners (GITHUB_ACTIONS=true) and causes the real spawn to fire.

      const child = makeFakeChild();
      const spawnSpy = vi.fn().mockReturnValue(child);

      await scheduleReconciliationChild(
        FAKE_PROJECT_DIR,
        FAKE_LISA_DIST,
        4242,
        spawnSpy as unknown as typeof spawn
      );

      expect(spawnSpy).toHaveBeenCalledTimes(1);
      const opts = spawnSpy.mock.calls[0]?.[2] as {
        detached?: boolean;
        stdio?: string;
      };
      // Must be fully detached so Lisa can return to the PM immediately and the
      // PM can exit (which is what the trampoline's waitForParent() is waiting for).
      expect(opts.detached).toBe(true);
      expect(opts.stdio).toBe("ignore");
      expect(child.unref).toHaveBeenCalledTimes(1);
      // Must NOT register a blocking exit listener — that would re-introduce
      // the circular wait.
      expect(child.on).not.toHaveBeenCalled();
    });
  });
});
/* eslint-enable max-lines -- Re-enable after comprehensive test file */
