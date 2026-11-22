/** Observe standalone selection, refusal, and evidence through the runner entry point. @module */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readGates } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  evidenceDocument,
  EXIT,
  main,
  runGates,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";

vi.mock(
  "../../../all/copy-overwrite/scripts/lisa-gates.mjs",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../../all/copy-overwrite/scripts/lisa-gates.mjs")
    >()),
    readGates: vi.fn(),
  })
);
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/worktree-dependencies.mjs",
  () => ({
    worktreeDependencyProblem: vi.fn(() => null),
  })
);

const MOMENT = "pull-request";
const PR = `--moment=${MOMENT}`;
const STANDALONE = "--builtins=none";
const STYLE = "code-style";
const SELECT_STYLE = `--gate=${STYLE}`;
const VERSION = [process.execPath, "--version"];
const LINT = {
  [MOMENT]: { level: "required" },
  parts: [
    {
      scope: ".",
      command: VERSION,
      evidence: { locators: [{ path: "package.json", line: 1 }] },
    },
  ],
};
const RUNNER = "bun run";
const CONFIG = { runner: RUNNER, config: {}, policy: {}, unproven: "block" };
const roots: string[] = [];

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("standalone workflow gate selection", () => {
  it.each([
    [PR, STANDALONE, "--gate"],
    [PR, STANDALONE, "--gate="],
    [PR, SELECT_STYLE],
    ["--moment=push", STANDALONE, SELECT_STYLE],
  ])(
    "rejects invalid gate selection %j %j %j before reading configuration",
    (...args) => {
      expect(main(args)).toBe(EXIT.RUNNER_FAILED);
      expect(console.error).toHaveBeenCalledWith(
        "⚠️  Use --gate=<id> with --moment=pull-request and --builtins=none."
      );
      expect(readGates).not.toHaveBeenCalled();
    }
  );

  it("refuses a named check in a checkout without declarations", () => {
    vi.mocked(readGates).mockReturnValue({
      ...CONFIG,
      gates: {},
    });
    expect(main([PR, STANDALONE, SELECT_STYLE])).toBe(EXIT.BLOCKED);
    expect(console.error).toHaveBeenCalledWith(
      '   ❌ No gate "code-style" is declared.'
    );
  });

  it.each([
    ["--gate=code-style", 'Gate "code-style" has no runnable declaration'],
    ["--gate=code-review", 'Gate "code-review" has no runnable declaration'],
  ])("refuses %s without running the declared checks", (flag, diagnostic) => {
    vi.mocked(readGates).mockReturnValue({
      ...CONFIG,
      gates: {
        "code-review": { [MOMENT]: { level: "required", await: "Review" } },
      },
    });
    expect(main([PR, STANDALONE, flag])).toBe(EXIT.BLOCKED);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(diagnostic)
    );
    expect(console.log).not.toHaveBeenCalledWith(
      expect.stringContaining("🚦 Gates")
    );
  });

  it("records only the selected gate and binds the evidence to that declaration", () => {
    vi.mocked(readGates).mockReturnValue({
      ...CONFIG,
      gates: {
        [STYLE]: LINT,
        "build-integrity": {
          [MOMENT]: { level: "required", run: "build" },
        },
      },
    });
    const root = mkdtempSync(path.join(tmpdir(), "lisa-standalone-gate-"));
    roots.push(root);
    const evidence = path.join(root, "proof.json");
    const status = main([
      PR,
      STANDALONE,
      "--parts=all",
      SELECT_STYLE,
      `--evidence=${evidence}`,
    ]);
    expect(status, vi.mocked(console.error).mock.calls.flat().join("\n")).toBe(
      EXIT.PROVED
    );
    const recorded: unknown = JSON.parse(readFileSync(evidence, "utf8"));
    const selected = evidenceDocument({
      moment: MOMENT,
      gates: { [STYLE]: LINT },
      runner: RUNNER,
      verdict: "proved",
      observedAt: new Date(0).toISOString(),
    });
    expect(recorded).toMatchObject({
      contract: selected.contract,
      verdict: "proved",
    });
    expect(recorded).toHaveProperty("gates", [
      expect.objectContaining({ gate: STYLE, scope: ".", status: "pass" }),
    ]);
  });

  it.each([true, false])(
    "runs past a costly failed part only when all parts are required (%s)",
    completeParts => {
      const [first, second] = ["src", "tests"];
      const execArgv = vi.fn((_argv: string[], context: { cwd: string }) =>
        path.basename(context.cwd) === first ? 1 : 0
      );
      const result = runGates({
        gates: {
          "test-correctness": {
            [MOMENT]: { level: "required" },
            parts: [first, second].map(scope => ({ scope, command: VERSION })),
          },
        },
        moment: MOMENT,
        completeParts,
        builtins: false,
        exec: () => {
          throw new Error(
            "Scoped checks must use their declared argument list."
          );
        },
        execArgv,
        out: () => {},
        change: () => ({ paths: null, note: null }),
        priorKills: [],
        interrupted: () => null,
      });
      expect(result.blocked).toBe(true);
      expect(
        execArgv.mock.calls.map(([, context]) => path.basename(context.cwd))
      ).toEqual(completeParts ? [first, second] : [first]);
    }
  );
});
