import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  main,
  EXIT,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { readGates } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { worktreeDependencyProblem } from "../../../all/copy-overwrite/scripts/lib/worktree-dependencies.mjs";

vi.mock(
  "../../../all/copy-overwrite/scripts/lib/worktree-dependencies.mjs",
  () => ({
    worktreeDependencyProblem: vi.fn(),
  })
);
vi.mock(
  "../../../all/copy-overwrite/scripts/lisa-gates.mjs",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../../all/copy-overwrite/scripts/lisa-gates.mjs")
    >()),
    readGates: vi.fn(() => ({ gates: null, runner: "bun run" })),
  })
);

const DIAGNOSIS =
  "Nested worktree resolves dependencies from the parent checkout";
const PUSH = "--moment=push";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("gate runner worktree dependency preflight", () => {
  it("refuses before reading gates and clears stale coverage", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-worktree-coverage-"));
    const coverage = path.join(root, "coverage.txt");
    writeFileSync(coverage, "test-correctness\n");
    vi.mocked(worktreeDependencyProblem).mockReturnValue(DIAGNOSIS);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(main([PUSH, `--coverage=${coverage}`])).toBe(EXIT.BLOCKED);
      expect(readGates).not.toHaveBeenCalled();
      expect(readFileSync(coverage, "utf8")).toBe("");
      expect(error).toHaveBeenCalledWith(DIAGNOSIS);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses without attempting a coverage write when no path was requested", () => {
    vi.mocked(worktreeDependencyProblem).mockReturnValue(DIAGNOSIS);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main([PUSH])).toBe(EXIT.BLOCKED);
    expect(readGates).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(DIAGNOSIS);
  });

  it("retains the no-gates fallback when the dependency condition is absent", () => {
    vi.mocked(worktreeDependencyProblem).mockReturnValue(null);
    expect(main([PUSH])).toBe(EXIT.NO_GATES);
    expect(readGates).toHaveBeenCalledTimes(1);
  });
});
