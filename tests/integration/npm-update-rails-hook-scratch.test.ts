/** Genuine candidate environment and native supervisor/socket qualify pathname composition, not hosted authority. */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  runSupervisor,
  namespaceEntries,
} from "./support/rails-scratch-supervisor.js";
import { withPrivateRoot } from "../../all/copy-overwrite/scripts/lib/npm-update-process-core.mjs";
import { originalHookEnvironment } from "../../all/copy-overwrite/scripts/lib/npm-update-hosted-gate.mjs";

useIoLatencyBudget();
const SOCKET_HOOK = resolve(
  "tests/fixtures/npm-update-hosted-runtime/support/socket-hook.mjs"
);

describe("authenticated Rails hook scratch composition", () => {
  it("binds and closes a genuine socket under the original supervisor with a private candidate HOME", async () => {
    const state = { home: "" };
    await withPrivateRoot(async (root, env) => {
      state.home = root;
      const foreign = join(root, "foreign-sentinel");
      writeFileSync(foreign, "preserved", { flag: "wx", mode: 0o600 });
      const projected = originalHookEnvironment(env, { browser: true });
      expect(projected.LISA_SCRATCH_BASE).toBe("/tmp");
      // Darwin's /tmp is a symlink: qualify its actual canonical prerequisite,
      // without pretending this host is Linux or modifying the production base.
      const base = realpathSync(projected.LISA_SCRATCH_BASE);
      const run = await runSupervisor(
        base,
        ["--suite", "npm-browser", "--", process.execPath, SOCKET_HOOK],
        { ...projected, LISA_SCRATCH_BASE: base }
      );
      expect(run.stderr).toBe("");
      const witness = JSON.parse(run.stdout);
      expect(existsSync(witness.root)).toBe(false);
      expect(
        existsSync(
          join(base, "lisa-rails-scratch", witness.root.split("/").at(-1))
        )
      ).toBe(false);
      expect(readFileSync(foreign, "utf8")).toBe("preserved");
      expect(witness.home).toBe(root);
      expect(witness.tokenBytes).toBe(32);
      expect(witness.temporaryBytes).toBe(
        process.platform === "darwin" ? 62 : 54
      );
      expect(witness.socketBytes).toBe(
        process.platform === "darwin" ? 103 : 95
      );
      expect(run.code).toBe(0);
      expect(witness.nativeBind).toBe(true);
      expect(witness.socketAbsent).toBe(true);
    });
    expect(existsSync(state.home)).toBe(false);
  });
  it("retains the original nested-path refusal without binding a truncated sibling socket", async () => {
    await withPrivateRoot(async (_root, env) => {
      if (typeof env.TMPDIR !== "string")
        throw new Error("candidate TMPDIR absent");
      const run = await runSupervisor(
        env.TMPDIR,
        ["--suite", "npm-browser", "--", process.execPath, SOCKET_HOOK],
        { ...env, LISA_SCRATCH_BASE: "" }
      );
      expect(run.stderr).toBe("");
      expect(run.code).toBe(1);
      expect(JSON.parse(run.stdout)).toMatchObject({
        code: "ENAMETOOLONG",
        nativeBind: false,
        tokenBytes: 32,
      });
      expect(namespaceEntries(join(env.TMPDIR, "lisa-rails-scratch"))).toEqual(
        []
      );
    });
  });
});
