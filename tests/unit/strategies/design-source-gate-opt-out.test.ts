/**
 * Exercise the CLI against real git changes so an explicit opt-out cannot
 * become a silent PASS or accidentally weaken default enforcement.
 * @module tests/unit/strategies/design-source-gate-opt-out
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { evaluateDesignSource } from "../../../plugins/src/base/scripts/design-source-gate.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const GATE = path.resolve("plugins/src/base/scripts/design-source-gate.mjs");
const OPT_OUT = '{"designSource":{"enabled":false}}';
const CONFIG_FILE = ".lisa.config.json";
const BASE = "--base=HEAD~1";
let root = "";

/** Run a command in the isolated fixture with the normal hang detector.
 * @param command - Program to execute.
 * @param args - Arguments passed without a shell.
 * @returns The completed subprocess result.
 */
function run(command: string, args: readonly string[]) {
  return boundedSpawnSync({
    label: "design-source opt-out",
    command,
    args,
    cwd: root,
  });
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-design-source-opt-out-"));
  for (const args of [
    ["init", "--quiet"],
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "base",
    ],
  ])
    expect(run("git", args).status).toBe(0);
  writeFileSync(
    path.join(root, "Surface.tsx"),
    "export const Surface = () => <main />;\n"
  );
  expect(run("git", ["add", "Surface.tsx"]).status).toBe(0);
  expect(
    run("git", [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "--quiet",
      "-m",
      "surface",
    ]).status
  ).toBe(0);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

/** Write the host config and invoke the real CLI, without mocking git.
 * @param config - Raw config text, including malformed controls.
 * @param args - CLI options; defaults to the real changed UI diff.
 * @returns The CLI process result.
 */
function gate(config: string, args = [BASE]) {
  writeFileSync(path.join(root, CONFIG_FILE), config);
  return run(process.execPath, [GATE, ...args]);
}

describe("design-source explicit opt-out", () => {
  it("visibly skips an unannotated UI change", () => {
    const result = gate(OPT_OUT);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("SKIPPED: designSource.enabled=false");
    expect(result.stdout).not.toContain("PASS");
  });

  it("skips before resolving an invalid diff and reports JSON honestly", () => {
    const result = gate(OPT_OUT, ["--base=missing-ref", "--json"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      verdict: "SKIPPED",
      reasons: ["designSource.enabled=false"],
      summary: { judged: 0, violations: 0 },
    });
  });

  it("skips the evaluator without classifying files or demanding a diff", () => {
    const result = evaluateDesignSource({
      config: { enabled: false },
      diffError: "missing ref",
    });
    expect(result.verdict).toBe("SKIPPED");
    expect(result.reasons).toEqual(["designSource.enabled=false"]);
    expect(result.violations).toEqual([]);
    expect(result.summary.judged).toBe(0);
  });

  it.each([
    "{}",
    '{"designSource":{}}',
    '{"designSource":{"enabled":true}}',
    '{"designSource":{"enabled":"false"}}',
    '{"designSource":{"enabled":0}}',
    '{"designSource":{"enabled":null}}',
    '{"designSource":false}',
    "{broken config",
  ])("keeps undeclared UI fail-closed for %s", config => {
    const result = gate(config, [BASE, "--json"]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      verdict: "FAIL",
      reasons: ["undeclared:Surface.tsx"],
    });
  });

  it("preserves missing-config enforcement", () => {
    rmSync(path.join(root, CONFIG_FILE), { force: true });
    const result = run(process.execPath, [GATE, BASE]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("undeclared");
  });

  it("still fails unresolved diffs when enabled", () => {
    const result = gate('{"designSource":{"enabled":true}}', [
      "--base=missing-ref",
      "--json",
    ]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).reasons).toContain("diff-unresolved");
  });
});
