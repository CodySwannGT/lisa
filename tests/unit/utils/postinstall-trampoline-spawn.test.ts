/**
 * Unit tests for the postinstall reconciliation trampoline's process-spawning
 * paths: in-process lockfile regeneration and the detached (or CI-awaited)
 * reconciliation child, driven through the spawn DI seam.
 *
 * Sibling of postinstall-trampoline.test.ts; see it for the trampoline's
 * rationale.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  regenerateLockfilesInProcess,
  scheduleReconciliationChild,
} from "../../../src/utils/postinstall-trampoline.js";
import {
  FAKE_PROJECT_DIR,
  FAKE_LISA_DIST,
  BUN_LOCK,
  NPM_LOCK,
  PNPM_LOCK,
  YARN_LOCK,
  IGNORE_SCRIPTS,
  SIBLING_PROJECT_DIR,
  type SpawnFn,
  FAKE_REPORTING,
} from "./postinstall-trampoline-fixtures.js";

describe("postinstall-trampoline", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env vars mutated by individual tests
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("regenerateLockfilesInProcess", () => {
    /**
     * Minimal fake child for the spawn DI seam. We only need to fire `exit`
     * synchronously so the awaited promise resolves and the loop advances.
     * @returns Fake child with `on` spy and an `emit` helper
     */
    function makeFakeChild(): {
      readonly on: ReturnType<typeof vi.fn>;
      readonly emit: (event: string) => void;
    } {
      const handlers: Record<string, Array<() => void>> = {};
      const on = vi.fn((event: string, handler: () => void) => {
        const list = handlers[event] ?? [];
        list.push(handler);
        handlers[event] = list;
      });
      return {
        on,
        emit: (event: string) => {
          for (const h of handlers[event] ?? []) h();
        },
      };
    }

    /**
     * Build a temp project dir with the requested lockfiles, run the regen
     * helper against it, and return the spawn spy plus tempdir for cleanup.
     * @param lockfiles - lockfile basenames to seed
     * @returns spawnSpy and tempdir
     */
    async function runRegen(lockfiles: readonly string[]): Promise<{
      readonly spawnSpy: ReturnType<typeof vi.fn>;
      readonly dir: string;
    }> {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-regen-test-"));
      for (const file of lockfiles) {
        fs.writeFileSync(path.join(dir, file), "");
      }
      const spawnSpy = vi.fn().mockImplementation(() => {
        const child = makeFakeChild();
        // Resolve on next microtask so the Promise wrapper has time to register
        // its listener before we fire exit.
        queueMicrotask(() => child.emit("exit"));
        return child;
      });
      await regenerateLockfilesInProcess(dir, spawnSpy as unknown as SpawnFn);
      return { spawnSpy, dir };
    }

    it("runs the npm regen plan when only package-lock.json is present (manual-invocation path)", async () => {
      // Regression guard: when Lisa is invoked manually after `npm install -D`,
      // no lifecycle env var is set so the trampoline never schedules. Without
      // an in-process regen, package-lock.json drifts from package.json and
      // `npm ci` fails. This is the exact failure mode that hit
      // acmeorgb/infrastructure-v2 and acmeorgd/infrastructure during the
      // 2.8.0 batch upgrade.
      const { spawnSpy, dir } = await runRegen([NPM_LOCK]);
      try {
        expect(spawnSpy).toHaveBeenCalledTimes(1);
        const [cmd, args, opts] = spawnSpy.mock.calls[0] as [
          string,
          readonly string[],
          { cwd?: string; stdio?: string },
        ];
        expect(cmd).toBe("npm");
        expect(args).toContain("--package-lock-only");
        expect(args).toContain(IGNORE_SCRIPTS);
        expect(opts.cwd).toBe(dir);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("runs both bun and npm regen plans for dual-lockfile projects", async () => {
      const { spawnSpy, dir } = await runRegen([BUN_LOCK, NPM_LOCK]);
      try {
        expect(spawnSpy).toHaveBeenCalledTimes(2);
        const commands = spawnSpy.mock.calls.map(call => call[0]);
        expect(commands).toContain("bun");
        expect(commands).toContain("npm");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("does nothing when no lockfile is present", async () => {
      const { spawnSpy, dir } = await runRegen([]);
      try {
        expect(spawnSpy).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("swallows spawn errors so a missing PM binary does not fail the apply", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-regen-test-"));
      try {
        fs.writeFileSync(path.join(dir, NPM_LOCK), "");
        const spawnSpy = vi.fn().mockImplementation(() => {
          throw new Error("ENOENT: npm not on PATH");
        });
        await expect(
          regenerateLockfilesInProcess(dir, spawnSpy as unknown as SpawnFn)
        ).resolves.toBeUndefined();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
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
      // Use the dependency-injection seam (4th arg) instead of vi.doMock for
      // node:child_process. Mocking node builtins via doMock + dynamic import
      // is unreliable in CI under v8 coverage — the real spawn fires anyway,
      // causing ENOENT and a missed-spy assertion. Direct DI is bulletproof.
      const spawnSpy = vi.fn().mockReturnValue(child);

      await scheduleReconciliationChild(
        FAKE_PROJECT_DIR,
        FAKE_LISA_DIST,
        4242,
        FAKE_REPORTING,
        spawnSpy as unknown as SpawnFn
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

    it("strips package-manager path env vars so a stale sibling project cannot be targeted (cross-project corruption regression)", async () => {
      // Regression: during a batched concurrent multi-project Lisa update, the
      // detached reconciliation child inherited npm_config_local_prefix / INIT_CWD
      // pointing at a SIBLING project. bun/npm honour npm_config_local_prefix (and
      // Lisa's postinstall script reads it as PROJECT_ROOT) over cwd, so the
      // re-run + its `bun install` resolved to the wrong project — writing one
      // project's package.json into another (advisory-rankings content leaked into
      // harperstarter). The child must derive its target strictly from projectDir.
      delete process.env.CI;
      // Simulate the poisoned environment a concurrent sibling install leaves behind.
      process.env.npm_config_local_prefix = SIBLING_PROJECT_DIR;
      process.env.INIT_CWD = SIBLING_PROJECT_DIR;
      process.env.npm_package_name = "advisory-rankings";
      process.env.npm_lifecycle_event = "postinstall";
      process.env.npm_config_argv = "{}";
      // A non-PM var must survive so the child can still find node/PATH.
      process.env.PATH = process.env.PATH ?? "/usr/bin";

      const child = makeFakeChild();
      const spawnSpy = vi.fn().mockReturnValue(child);

      await scheduleReconciliationChild(
        FAKE_PROJECT_DIR,
        FAKE_LISA_DIST,
        4242,
        FAKE_REPORTING,
        spawnSpy as unknown as SpawnFn
      );

      const opts = spawnSpy.mock.calls[0]?.[2] as {
        env?: Record<string, string>;
      };
      const env = opts.env ?? {};
      // Every package-manager path/lifecycle var that could redirect the re-run
      // to a sibling project must be gone.
      expect(env.npm_config_local_prefix).toBeUndefined();
      expect(env.INIT_CWD).toBeUndefined();
      expect(env.npm_package_name).toBeUndefined();
      expect(env.npm_lifecycle_event).toBeUndefined();
      expect(env.npm_config_argv).toBeUndefined();
      // Non-PM vars (PATH) survive so the detached child can locate node.
      expect(env.PATH).toBeDefined();
      // Sentinels are still applied after sanitization.
      expect(env.LISA_POSTINSTALL_TRAMPOLINE).toBe("1");
      // The inline trampoline source must also sanitize the env of the bun/Lisa
      // processes it spawns (belt-and-suspenders for any re-introduced vars).
      const inlineSource = spawnSpy.mock.calls[0]?.[1] as readonly string[];
      expect(inlineSource[1]).toContain("sanitizeEnv");
      expect(inlineSource[1]).toContain("npm_config_");
      expect(inlineSource[1]).toContain("INIT_CWD");
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
      // actually runs. This test is a regression guard — scheduleReconciliationChild
      // has no CI branch in source, so the assertion holds regardless of env.
      //
      // We use the dependency-injection seam (4th arg) instead of vi.doMock
      // for node:child_process — the latter is unreliable under v8 coverage
      // in CI release-workflow runners.

      const child = makeFakeChild();
      const spawnSpy = vi.fn().mockReturnValue(child);

      await scheduleReconciliationChild(
        FAKE_PROJECT_DIR,
        FAKE_LISA_DIST,
        4242,
        FAKE_REPORTING,
        spawnSpy as unknown as SpawnFn
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
