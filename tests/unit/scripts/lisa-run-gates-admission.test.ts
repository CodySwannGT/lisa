/**
 * The gate runner's admission wiring (CodySwannGT/lisa#4596).
 *
 * The wrapper itself is `push-admission.test.ts`. This file proves only that the
 * runner reads `pushGate.admission` at push, hands the wrapped executor to the
 * gates and to build-once, marks the push context for its children, and refuses
 * an invalid switch rather than defaulting it.
 * @module tests/unit/scripts/lisa-run-gates-admission
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
import { withAdmission } from "../../../all/copy-overwrite/scripts/lib/push-admission.mjs";
import { readGates } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

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
  "../../../all/copy-overwrite/scripts/lib/push-admission.mjs",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../../all/copy-overwrite/scripts/lib/push-admission.mjs")
    >()),
    withAdmission: vi.fn(() => () => ({ code: 0, output: null })),
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
  "../../../all/copy-overwrite/scripts/lib/push-timing.mjs",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../../all/copy-overwrite/scripts/lib/push-timing.mjs")
    >()),
    recordPushTiming: vi.fn(),
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
    readGates: vi.fn(),
  })
);

const PUSH_FLAG = "--moment=push";
const roots: string[] = [];
const ORIGINAL_CONTEXT = process.env.LISA_ADMISSION_CONTEXT;

/**
 * A coverage path in a private directory.
 * @returns Absolute path of a not-yet-written coverage file
 */
function coveragePath(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-test-"));
  roots.push(root);
  return path.join(root, "coverage.txt");
}

/**
 * State the project config the runner reads.
 * @param pushGate - The `pushGate` block
 */
function configure(pushGate: unknown): void {
  vi.mocked(readGates).mockReturnValue({
    gates: {
      "type-correctness": {
        commit: "off",
        push: "required",
        "pull-request": "off",
      },
    },
    runner: "bun run",
    config: { pushGate },
  } as unknown as ReturnType<typeof readGates>);
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  if (ORIGINAL_CONTEXT === undefined) delete process.env.LISA_ADMISSION_CONTEXT;
  else process.env.LISA_ADMISSION_CONTEXT = ORIGINAL_CONTEXT;
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("gate runner admission", () => {
  it("wraps the push executor with the switch and marks the push context", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    configure({ admission: true });
    main([PUSH_FLAG, `--coverage=${coveragePath()}`]);
    expect(withAdmission).toHaveBeenCalledTimes(1);
    expect(vi.mocked(withAdmission).mock.calls[0]?.[1]).toEqual({
      enabled: true,
    });
    expect(process.env.LISA_ADMISSION_CONTEXT).toBe("push");
  });

  it("passes an explicit false through as off", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    configure({ buildOnce: true, admission: false });
    main([PUSH_FLAG, `--coverage=${coveragePath()}`]);
    expect(vi.mocked(withAdmission).mock.calls[0]?.[1]).toEqual({
      enabled: false,
    });
  });

  it("defaults the switch on for a TypeScript project that does not set it (#4611)", () => {
    // The runner reads the stack from its working directory, which here is
    // this repository: a root tsconfig.json makes it a TypeScript project.
    vi.spyOn(console, "log").mockImplementation(() => {});
    configure({ buildOnce: true });
    main([PUSH_FLAG, `--coverage=${coveragePath()}`]);
    expect(vi.mocked(withAdmission).mock.calls[0]?.[1]).toEqual({
      enabled: true,
    });
  });

  it("routes build-once through the admitted executor as the build-once step", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const seen: unknown[] = [];
    vi.mocked(withAdmission).mockImplementation(() => (command, gate) => {
      seen.push([command, gate]);
      return { code: 0, output: null };
    });
    vi.mocked(runBuildOnce).mockImplementation(({ exec }) => {
      exec("bun run build");
      return null;
    });
    configure({ admission: true, buildOnce: true });
    main([PUSH_FLAG, `--coverage=${coveragePath()}`]);
    expect(seen[0]).toEqual(["bun run build", { id: "build-once" }]);
  });

  it("does not admit at other moments", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    configure({ admission: true });
    main(["--moment=commit", `--coverage=${coveragePath()}`]);
    expect(withAdmission).not.toHaveBeenCalled();
  });

  it("refuses an invalid switch instead of defaulting it", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(line => {
      lines.push(String(line));
    });
    configure({ admission: "yes" });
    expect(main([PUSH_FLAG, `--coverage=${coveragePath()}`])).toBe(
      EXIT.BLOCKED
    );
    expect(lines.join("\n")).toMatch(/pushGate\.admission/u);
  });
});
