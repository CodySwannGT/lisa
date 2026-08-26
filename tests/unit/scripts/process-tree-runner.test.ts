/** A gate deadline reaps descendants, not only the direct shell. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
});
