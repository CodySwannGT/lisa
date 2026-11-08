/**
 * The gate runner sweeps once, at `--moment=push` only, before the first gate
 * (CodySwannGT/lisa#4597).
 *
 * The launcher is mocked: what it does on success, failure and timeout is
 * `lisa-cleanup-sweep-launch.test.ts`. This file proves only the wiring — that
 * the runner calls it at push, never at another moment, and still runs its
 * gates when the sweep reports a failure.
 * @module tests/unit/scripts/lisa-run-gates-cleanup-sweep
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  main,
  EXIT,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { runStartOfRunSweep } from "../../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep.mjs";

vi.mock(
  "../../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep.mjs",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep.mjs")
    >()),
    runStartOfRunSweep: vi.fn(),
  })
);
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/worktree-dependencies.mjs",
  () => ({ worktreeDependencyProblem: vi.fn(() => null) })
);
vi.mock(
  "../../../all/copy-overwrite/scripts/lisa-gates.mjs",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../../all/copy-overwrite/scripts/lisa-gates.mjs")
    >()),
    // One gate declared "off" at every moment this file runs: each moment
    // reaches the gate loop and resolves to zero gates, so nothing is spawned.
    readGates: vi.fn(() => ({
      gates: {
        "code-style": { commit: "off", push: "off", "pull-request": "off" },
      },
      runner: "bun run",
    })),
  })
);

const PUSH_FLAG = "--moment=push";
const roots: string[] = [];

/**
 * A coverage path in a private directory.
 * @returns Absolute path of a not-yet-written coverage file
 */
function coveragePath(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-sweep-"));
  roots.push(root);
  return path.join(root, "coverage.txt");
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("gate runner start-of-run sweep", () => {
  it("sweeps once at push, before the gates line", () => {
    const order: string[] = [];
    vi.mocked(runStartOfRunSweep).mockImplementation(() => {
      order.push("sweep");
    });
    vi.spyOn(console, "log").mockImplementation(line => {
      order.push(String(line));
    });
    const code = main([PUSH_FLAG, `--coverage=${coveragePath()}`]);
    expect(code).toBe(EXIT.PROVED);
    expect(runStartOfRunSweep).toHaveBeenCalledTimes(1);
    const sweepAt = order.indexOf("sweep");
    const gatesAt = order.findIndex(line =>
      line.startsWith("🚦 Gates at push")
    );
    expect(sweepAt).toBeGreaterThanOrEqual(0);
    expect(sweepAt).toBeLessThan(gatesAt);
  });

  it("does not sweep at any other moment", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    main(["--moment=commit", `--coverage=${coveragePath()}`]);
    main(["--moment=pull-request", `--coverage=${coveragePath()}`]);
    expect(runStartOfRunSweep).not.toHaveBeenCalled();
  });

  it("still runs the gates when the sweep throws", () => {
    vi.mocked(runStartOfRunSweep).mockImplementation(() => {
      throw new Error("sweep exploded");
    });
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation(line => {
      lines.push(String(line));
    });
    const code = main([PUSH_FLAG, `--coverage=${coveragePath()}`]);
    expect(code).toBe(EXIT.PROVED);
    expect(lines.some(line => /sweep exploded/u.test(line))).toBe(true);
    expect(lines.some(line => line.startsWith("🚦 Gates at push"))).toBe(true);
  });

  it("also sweeps on the push path that falls back to the built-in checks", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation(line => {
      lines.push(String(line));
    });
    // No --coverage: the push floor the block leaves undeclared sends the
    // hook back to its built-in steps, which still run tests.
    expect(main([PUSH_FLAG])).toBe(EXIT.NO_GATES);
    expect(lines.some(line => /built-in checks/u.test(line))).toBe(true);
    expect(runStartOfRunSweep).toHaveBeenCalledTimes(1);
  });
});
