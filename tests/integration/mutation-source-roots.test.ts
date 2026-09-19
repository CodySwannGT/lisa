/**
 * Run the shipped CLI and real Stryker against source outside the scaffolded
 * root. Argument-only tests cannot prove Stryker received a usable selection:
 * inspect its report to prove production mutants exist and exclusions held.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  boundedExecFileSync,
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(__dirname, "../..");
const GATE = path.join(REPO_ROOT, "scripts/lisa-mutation.mjs");
const SOURCE = "lib/answer.ts";
const STRYKER_CONFIG = "stryker.conf.json";

/**
 * Write a fixture without relying on the host repository's source layout.
 * @param root - Fixture project directory
 * @param relative - Path within the fixture
 * @param contents - Fixture content
 */
const write = (root: string, relative: string, contents: string): void => {
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
};

describe("mutation source roots through the shipped CLI", () => {
  useIoLatencyBudget();
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "lisa-mutation-roots-"))
    );
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it.each([false, true])(
    "mutates real source with declared sourceDirs=%s",
    declared => {
      write(
        root,
        "mutation.gate.json",
        JSON.stringify({ enabled: true, since: "main" })
      );
      write(
        root,
        STRYKER_CONFIG,
        JSON.stringify({
          mutate: ["src/**/*.ts"],
          testRunner: "command",
          commandRunner: { command: "node tests/check.cjs" },
          reporters: ["clear-text", "json"],
          jsonReporter: { fileName: "mutation.json" },
          coverageAnalysis: "off",
          concurrency: 1,
          thresholds: { break: 100 },
          timeoutMS: 10000,
          incremental: false,
        })
      );
      write(root, SOURCE, "module.exports = n => n > 1;\n");
      write(root, "lib/answer.spec.ts", 'throw new Error("excluded spec");\n');
      write(root, "lib/answer.test.tsx", 'throw new Error("excluded test");\n');
      write(root, "lib/answer.d.ts", "declare const n: number;\n");
      write(
        root,
        "tests/check.cjs",
        'const assert=require("node:assert/strict"); const answer=require("../lib/answer.ts"); ' +
          "assert.equal(answer(1),false); assert.equal(answer(2),true);\n"
      );
      if (declared) write(root, "src/unused.ts", "module.exports = 10;\n");
      if (declared)
        write(
          root,
          ".lisa.config.json",
          JSON.stringify({
            quality: { mutation: { sourceDirs: ["lib"] } },
          })
        );
      fs.symlinkSync(
        path.join(REPO_ROOT, "node_modules"),
        path.join(root, "node_modules"),
        "dir"
      );
      boundedExecFileSync({
        label: "initialize source-roots fixture",
        command: "git",
        args: ["init", "-q", "-b", "main"],
        cwd: root,
      });
      boundedExecFileSync({
        label: "track source-roots fixture",
        command: "git",
        args: ["add", "."],
        cwd: root,
      });
      const original = fs.readFileSync(path.join(root, STRYKER_CONFIG), "utf8");

      const result = boundedSpawnSync({
        label: "run actual mutation source-roots CLI",
        command: process.execPath,
        args: [GATE, "--all"],
        cwd: root,
        env: { ...process.env, MUTATION_ENABLED: "1", MUTATION_CAPTURE: "1" },
      });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const report = JSON.parse(
        fs.readFileSync(path.join(root, "mutation.json"), "utf8")
      );
      expect(Object.keys(report.files)).toEqual([SOURCE]);
      const mutants = report.files[SOURCE].mutants as { status: string }[];
      expect(mutants.length).toBeGreaterThan(0);
      expect(mutants.every(mutant => mutant.status === "Killed")).toBe(true);
      expect(fs.readFileSync(path.join(root, STRYKER_CONFIG), "utf8")).toBe(
        original
      );
      if (!declared) expect(result.stdout).toContain("lib/ (1 file)");
    }
  );
});
