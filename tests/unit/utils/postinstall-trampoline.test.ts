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
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  detectPackageManagers,
  enginesForbiddenManagers,
  getLisaDistDir,
  isRunningAsLifecycleScript,
  isRunningAsTrampoline,
  shouldSchedulePostinstallReconciliation,
} from "../../../src/utils/postinstall-trampoline.js";
import {
  FAKE_PACKAGE_JSON_PATH,
  BUN_LOCK,
  BUN_LOCKB,
  NPM_LOCK,
  PNPM_LOCK,
  YARN_LOCK,
  PACKAGE_JSON,
} from "./postinstall-trampoline-fixtures.js";

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
      delete process.env.npm_config_user_agent;
      delete process.env.npm_execpath;
      delete process.env.LISA_POSTINSTALL_TRAMPOLINE;
      delete process.env.VITEST;
      delete process.env.JEST_WORKER_ID;
      expect(shouldSchedulePostinstallReconciliation(false)).toBe(true);
    });

    it("returns false for npm lifecycle scripts so package-lock regeneration runs synchronously", () => {
      process.env.npm_package_json = FAKE_PACKAGE_JSON_PATH;
      process.env.npm_config_user_agent =
        "npm/10.9.0 node/v22.21.1 darwin arm64 workspaces/false";
      delete process.env.npm_execpath;
      delete process.env.LISA_POSTINSTALL_TRAMPOLINE;
      delete process.env.VITEST;
      delete process.env.JEST_WORKER_ID;
      expect(shouldSchedulePostinstallReconciliation(false)).toBe(false);
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

    it("returns false under vitest even when npm_package_json is set", () => {
      // bun-driven test runners propagate npm_package_json into the worker
      // env, so the lifecycle-script check would falsely fire and the detached
      // trampoline child would race against test temp-dir cleanup.
      process.env.npm_package_json = FAKE_PACKAGE_JSON_PATH;
      process.env.VITEST = "true";
      delete process.env.JEST_WORKER_ID;
      delete process.env.LISA_POSTINSTALL_TRAMPOLINE;
      expect(shouldSchedulePostinstallReconciliation(false)).toBe(false);
    });

    it("returns false under jest even when npm_package_json is set", () => {
      process.env.npm_package_json = FAKE_PACKAGE_JSON_PATH;
      process.env.JEST_WORKER_ID = "1";
      delete process.env.VITEST;
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

    it("detects bun from bun.lockb (legacy binary lockfile format)", () => {
      const dir = withLockfiles([BUN_LOCKB]);
      try {
        expect(detectPackageManagers(dir)).toEqual(["bun"]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("detects bun once when both bun.lock and bun.lockb coexist", () => {
      const dir = withLockfiles([BUN_LOCK, BUN_LOCKB]);
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

    /**
     * Create a disposable directory with lockfile sentinels plus a package.json
     * carrying the supplied `engines` block. Used to exercise the engines-based
     * opt-out that excludes a forbidden manager even when its lockfile is present.
     * @param lockfiles - Lockfile base names to create
     * @param engines - engines object to write into package.json
     * @returns Absolute path to the scratch directory
     */
    function withProject(
      lockfiles: readonly string[],
      engines: Readonly<Record<string, string>>
    ): string {
      const dir = withLockfiles(lockfiles);
      fs.writeFileSync(
        path.join(dir, PACKAGE_JSON),
        JSON.stringify({ engines }, null, 2)
      );
      return dir;
    }

    it("excludes a manager forbidden via engines sentinel even when its lockfile is present", () => {
      // npm-only project with a stray bun.lock — bun must be dropped so the
      // reconciliation never re-creates the bun.lock via `bun install`.
      const dir = withProject([BUN_LOCK, NPM_LOCK], { bun: "please-use-npm" });
      try {
        expect(detectPackageManagers(dir)).toEqual(["npm"]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("keeps bun when it is the engines-sanctioned manager (npm forbidden)", () => {
      const dir = withProject([BUN_LOCK], {
        npm: "please-use-bun",
        bun: "1.3.8",
      });
      try {
        expect(detectPackageManagers(dir)).toEqual(["bun"]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("enginesForbiddenManagers", () => {
    /**
     * Write a package.json with the given engines block into a scratch dir.
     * @param engines - engines object (omit to write no engines field)
     * @returns Absolute path to the scratch directory
     */
    function withEngines(engines?: Readonly<Record<string, string>>): string {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-forbidden-pm-"));
      const pkg = engines === undefined ? {} : { engines };
      fs.writeFileSync(
        path.join(dir, PACKAGE_JSON),
        JSON.stringify(pkg, null, 2)
      );
      return dir;
    }

    it("returns an empty set when there is no package.json", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-no-pkg-"));
      try {
        expect(enginesForbiddenManagers(dir).size).toBe(0);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("flags a manager pinned to a please-use sentinel", () => {
      const dir = withEngines({ bun: "please-use-npm", node: ">=20" });
      try {
        const forbidden = enginesForbiddenManagers(dir);
        expect(forbidden.has("bun")).toBe(true);
        expect(forbidden.has("npm")).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("does not flag a manager pinned to a real version range", () => {
      const dir = withEngines({ npm: ">=10", node: ">=20" });
      try {
        expect(enginesForbiddenManagers(dir).size).toBe(0);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
