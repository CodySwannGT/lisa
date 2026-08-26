/** A gate deadline reaps descendants, not only the direct shell. */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../../all/copy-overwrite/scripts/lib/bounded-spawn.mjs";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("process-tree gate deadline", () => {
  it("kills a background grandchild before the supervisor returns", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-tree-"));
    roots.push(root);
    const pidFile = path.join(root, "grandchild.pid");
    const runner = path.resolve(
      "all/copy-overwrite/scripts/lib/process-tree-runner.mjs"
    );
    const command = `(sleep 30) & echo $! > ${JSON.stringify(pidFile)}; wait`;

    const result = boundedSpawnSync(
      process.execPath,
      [runner, "--timeout-ms=100", "--", command],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5_000 }
    );

    expect(result.status).toBeNull();
    expect(result.signal).toBe("SIGKILL");
    const grandchild = Number(readFileSync(pidFile, "utf8").trim());
    expect(() => process.kill(grandchild, 0)).toThrow();
  });

  it("reaps a detached grandchild before relaying SIGTERM", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-signal-"));
    roots.push(root);
    const pidFile = path.join(root, "grandchild.pid");
    const runner = path.resolve(
      "all/copy-overwrite/scripts/lib/process-tree-runner.mjs"
    );
    const command = `(sleep 30) & echo $! > ${JSON.stringify(pidFile)}; wait`;
    const supervisor = spawn(
      process.execPath,
      [runner, "--timeout-ms=30000", "--", command],
      { stdio: "ignore" }
    );

    const started = Date.now();
    while (!existsSync(pidFile) && Date.now() - started < 2_000) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(existsSync(pidFile)).toBe(true);
    const grandchild = Number(readFileSync(pidFile, "utf8").trim());
    supervisor.kill("SIGTERM");
    const result = await new Promise<{
      code: number | null;
      signal: string | null;
    }>(resolve =>
      supervisor.once("close", (code, signal) => resolve({ code, signal }))
    );

    expect(result).toEqual({ code: null, signal: "SIGTERM" });
    expect(() => process.kill(grandchild, 0)).toThrow();
  });
});
