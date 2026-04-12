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
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  getLisaDistDir,
  isRunningAsLifecycleScript,
  isRunningAsTrampoline,
  shouldSchedulePostinstallReconciliation,
} from "../../../src/utils/postinstall-trampoline.js";

// Use project-local paths (not /tmp/*) to avoid sonarjs's publicly-writable-directory
// warnings. These are never actually read/written — they are fixtures passed to
// spawn for assertion purposes.
const FAKE_PROJECT_DIR = "./fake/project";
const FAKE_LISA_DIST = "./fake/lisa/dist";
const FAKE_PACKAGE_JSON_PATH = "./fake/project/package.json";

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

  describe("scheduleReconciliationChild", () => {
    it("spawns a detached node -e process that can be unref'd", async () => {
      // Use a dynamic mock for child_process.spawn so we can observe the call.
      const unrefSpy = vi.fn();
      const spawnSpy = vi.fn().mockReturnValue({ unref: unrefSpy });
      vi.doMock("node:child_process", () => ({ spawn: spawnSpy }));
      // Re-import module after mock so the in-module spawn binding picks it up.
      vi.resetModules();
      const fresh =
        await import("../../../src/utils/postinstall-trampoline.js");

      fresh.scheduleReconciliationChild(FAKE_PROJECT_DIR, FAKE_LISA_DIST, 4242);

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
      expect(opts.detached).toBe(true);
      expect(opts.stdio).toBe("ignore");
      // Trampoline flag set so the re-run does not itself attempt to reschedule
      expect(opts.env?.LISA_POSTINSTALL_TRAMPOLINE).toBe("1");
      // Lifecycle env stripped so the re-run is not misidentified as postinstall
      expect(opts.env?.npm_package_json).toBe("");
      expect(unrefSpy).toHaveBeenCalledTimes(1);

      vi.doUnmock("node:child_process");
      vi.resetModules();
    });
  });
});
