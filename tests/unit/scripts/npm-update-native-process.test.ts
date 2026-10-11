/** Real native children establish cancellation and reaping behavior without provider authority. */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  runProcess,
  withPrivateRoot,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { publicFailure } from "../../../all/copy-overwrite/scripts/lib/npm-update-invariants.mjs";

describe("native updater cancellation", () => {
  it("does not promote captured hook text after native output overflow", async () => {
    await withPrivateRoot(async (root, env) => {
      const error = await runProcess(
        process.execPath,
        [
          "-e",
          'process.stdout.write("❌ rspec (1 second)\\n" + "x".repeat(8192));',
        ],
        { cwd: root, env, maximum: 64, failureRole: "destination" }
      ).catch(value => value);
      expect(error.nativeCompleted).toBe(false);
      expect(publicFailure(error)).toContain("native=output-bound");
      expect(publicFailure(error)).not.toContain("hook-reports=");
    });
  });

  it("keeps successful and explicitly allowed nonzero native results authoritative", async () => {
    await withPrivateRoot(async (root, env) => {
      for (const status of [0, 1]) {
        const result = await runProcess(
          process.execPath,
          [
            "-e",
            `process.stdout.write("❌ rspec (1 second)\\n");process.exitCode=${status};`,
          ],
          { cwd: root, env, allowed: [status], failureRole: "audit" }
        );
        expect(result.code).toBe(status);
        expect(result.stdout.toString()).toBe("❌ rspec (1 second)\n");
        expect(publicFailure(result)).not.toContain("hook-reports=");
      }
    });
  });

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
