/** Real native children establish cancellation and reaping behavior without provider authority. */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  runProcess,
  withPrivateRoot,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";

describe("native updater cancellation", () => {
  it("refuses an already cancelled invocation before the child can create an output", async () => {
    await withPrivateRoot(async (root, env) => {
      const marker = join(root, "must-not-exist");
      const cancellation = new AbortController();
      cancellation.abort();
      expect(() =>
        runProcess(
          process.execPath,
          [
            "-e",
            `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected')`,
          ],
          { cwd: root, env, signal: cancellation.signal }
        )
      ).toThrow(/cancelled before execution/);
      expect(existsSync(marker)).toBe(false);
    });
  });

  it("awaits actual child-tree termination after cancelling a running invocation", async () => {
    await withPrivateRoot(async (root, env) => {
      const ready = join(root, "ready");
      const entry = join(root, "waiting.cjs");
      writeFileSync(
        entry,
        `require('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid));
process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`
      );
      const cancellation = new AbortController();
      const execution = runProcess(process.execPath, [entry], {
        cwd: root,
        env,
        timeout: 10_000,
        signal: cancellation.signal,
      });
      // Install the rejection observer immediately; readiness is a real child-owned file.
      const outcome = execution.then(
        () => undefined,
        error => error
      );
      const deadline = Date.now() + 5000;
      while (!existsSync(ready) && Date.now() < deadline) await delay(10);
      expect(existsSync(ready)).toBe(true);
      const pid = Number(readFileSync(ready, "utf8"));
      cancellation.abort();
      const failure = await outcome;
      expect(failure.message).toMatch(/cancelled/);
      expect(failure.nativeCompleted).toBe(false);
      expect(() => process.kill(pid, 0)).toThrow();
    });
  });
});
