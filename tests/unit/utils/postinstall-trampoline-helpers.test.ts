/**
 * Unit tests for the postinstall reconciliation trampoline's lockfile-regen
 * plans, package.json hashing, CI detection, and env sanitization.
 *
 * Sibling of postinstall-trampoline.test.ts; see it for the trampoline's
 * rationale.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getLockfileRegenPlan,
  hashFile,
  isRunningInCI,
} from "../../../src/utils/postinstall-trampoline.js";
import { sanitizeEnvForReconciliation } from "../../../src/utils/pm-env.js";
import {
  BUN_LOCK,
  NPM_LOCK,
  PNPM_LOCK,
  YARN_LOCK,
  IGNORE_SCRIPTS,
  INSTALL_CMD,
  PACKAGE_JSON,
  SIBLING_PROJECT_DIR,
} from "./postinstall-trampoline-fixtures.js";

describe("postinstall-trampoline", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env vars mutated by individual tests
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
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

  describe("sanitizeEnvForReconciliation", () => {
    it("removes all package-manager path/lifecycle vars while keeping the rest", () => {
      const result = sanitizeEnvForReconciliation({
        PATH: "/usr/bin",
        HOME: "/Users/dev",
        npm_config_local_prefix: SIBLING_PROJECT_DIR,
        npm_config_registry: "https://registry.npmjs.org",
        npm_package_name: "advisory-rankings",
        npm_package_json: `${SIBLING_PROJECT_DIR}/package.json`,
        npm_lifecycle_event: "postinstall",
        INIT_CWD: SIBLING_PROJECT_DIR,
        npm_execpath: "/opt/homebrew/bin/bun",
        PROJECT_CWD: SIBLING_PROJECT_DIR,
      });

      // Non-PM vars survive.
      expect(result.PATH).toBe("/usr/bin");
      expect(result.HOME).toBe("/Users/dev");
      // Every PM path/lifecycle var is stripped.
      expect(result.npm_config_local_prefix).toBeUndefined();
      expect(result.npm_config_registry).toBeUndefined();
      expect(result.npm_package_name).toBeUndefined();
      expect(result.npm_package_json).toBeUndefined();
      expect(result.npm_lifecycle_event).toBeUndefined();
      expect(result.INIT_CWD).toBeUndefined();
      expect(result.npm_execpath).toBeUndefined();
      expect(result.PROJECT_CWD).toBeUndefined();
    });

    it("does not mutate the source environment object", () => {
      const source = {
        PATH: "/usr/bin",
        npm_config_local_prefix: SIBLING_PROJECT_DIR,
      };
      sanitizeEnvForReconciliation(source);
      // Source untouched — sanitization returns a new object.
      expect(source.npm_config_local_prefix).toBe(SIBLING_PROJECT_DIR);
    });

    it("returns an empty object when given an empty environment", () => {
      expect(sanitizeEnvForReconciliation({})).toEqual({});
    });
  });
});
