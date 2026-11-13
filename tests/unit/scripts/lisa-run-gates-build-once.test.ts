/**
 * The gate runner's build-once wiring (CodySwannGT/lisa#4595).
 *
 * The step itself is `build-marker.test.ts`. This file proves only that the
 * runner calls it at push, before the first gate, never at another moment; that
 * a failing build fails the push with no gate run; and that an invalid
 * `pushGate` is refused rather than defaulted.
 * @module tests/unit/scripts/lisa-run-gates-build-once
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  main,
  EXIT,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { runBuildOnce } from "../../../all/copy-overwrite/scripts/lib/build-marker.mjs";

vi.mock(
  "../../../all/copy-overwrite/scripts/lib/build-marker.mjs",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../../all/copy-overwrite/scripts/lib/build-marker.mjs")
    >()),
    runBuildOnce: vi.fn(() => null),
  })
);
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
    readGates: vi.fn(() => ({
      gates: {
        "code-style": { commit: "off", push: "off", "pull-request": "off" },
      },
      runner: "bun run",
      config: { pushGate: { buildOnce: true } },
    })),
  })
);

const PUSH_FLAG = "--moment=push";
const GATES_LINE = "🚦 Gates at push";
const roots: string[] = [];

/**
 * A coverage path in a private directory.
 * @returns Absolute path of a not-yet-written coverage file
 */
function coveragePath(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-build-once-"));
  roots.push(root);
  return path.join(root, "coverage.txt");
}

/**
 * Capture console output in order.
 * @returns The captured lines
 */
function capture(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation(line => {
    lines.push(String(line));
  });
  vi.spyOn(console, "error").mockImplementation(line => {
    lines.push(String(line));
  });
  return lines;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.mocked(runBuildOnce).mockImplementation(() => null);
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("gate runner build-once", () => {
  it("builds once at push, before the gates line, with the project config", () => {
    const order: string[] = [];
    vi.mocked(runBuildOnce).mockImplementation(() => {
      order.push("build");
      return {
        id: "build-once",
        level: "required",
        command: "bun run build",
        state: "passed",
        code: 0,
        startedAt: new Date(0).toISOString(),
        durationMs: 1200,
        provedBy: null,
      };
    });
    vi.spyOn(console, "log").mockImplementation(line => {
      order.push(String(line));
    });
    expect(main([PUSH_FLAG, `--coverage=${coveragePath()}`])).toBe(EXIT.PROVED);
    expect(runBuildOnce).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runBuildOnce).mock.calls[0]?.[0]).toMatchObject({
      config: { pushGate: { buildOnce: true } },
      runner: "bun run",
    });
    const gatesAt = order.findIndex(line => line.startsWith(GATES_LINE));
    expect(order.indexOf("build")).toBeLessThan(gatesAt);
    expect(order.some(line => line.startsWith("🔨 build-once:"))).toBe(true);
  });

  it("does not build at any other moment", () => {
    capture();
    main(["--moment=commit", `--coverage=${coveragePath()}`]);
    main(["--moment=pull-request", `--coverage=${coveragePath()}`]);
    expect(runBuildOnce).not.toHaveBeenCalled();
  });

  it("a failing build fails the push and runs no gate", () => {
    vi.mocked(runBuildOnce).mockReturnValue({
      id: "build-once",
      level: "required",
      command: "bun run build",
      state: "failed",
      code: 2,
      startedAt: new Date(0).toISOString(),
      durationMs: 10,
      provedBy: null,
    });
    const lines = capture();
    expect(main([PUSH_FLAG, `--coverage=${coveragePath()}`])).toBe(
      EXIT.BLOCKED
    );
    expect(
      lines.some(line => /build-once: `bun run build` failed/u.test(line))
    ).toBe(true);
    expect(lines.some(line => line.startsWith(GATES_LINE))).toBe(false);
  });

  it("refuses an invalid pushGate instead of defaulting it", () => {
    vi.mocked(runBuildOnce).mockImplementation(() => {
      throw new Error('pushGate.buildOnce is "yes"; expected true or false.');
    });
    const lines = capture();
    expect(main([PUSH_FLAG, `--coverage=${coveragePath()}`])).toBe(
      EXIT.BLOCKED
    );
    expect(lines.some(line => /pushGate\.buildOnce/u.test(line))).toBe(true);
  });

  it("runs the gates unchanged when the step does not apply", () => {
    const lines = capture();
    expect(main([PUSH_FLAG, `--coverage=${coveragePath()}`])).toBe(EXIT.PROVED);
    expect(lines.some(line => line.startsWith("🔨"))).toBe(false);
    expect(lines.some(line => line.startsWith(GATES_LINE))).toBe(true);
  });
});
