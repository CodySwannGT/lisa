/**
 * @file history-secret-scanner-path.test.ts
 * @description Real pinned vendor and emitted CLI PATH qualification controls.
 * @module tests/history-secrets
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
useIoLatencyBudget();
const root = resolve(import.meta.dirname, "../..");
const lease = mkdtempSync(join(tmpdir(), "history-scanner-path-"));
const scanner = join(lease, "gitleaks");
beforeAll(() => {
  const result = boundedSpawnSync({
    label: "official pinned PATH-control scanner provision",
    command: process.execPath,
    args: [
      join(root, "all/copy-overwrite/scripts/lisa-history-secrets.mjs"),
      "provision",
      scanner,
    ],
    cwd: root,
    baseMs: 30000,
  });
  expect(result.status, result.stderr).toBe(0);
});
afterAll(() => {
  rmSync(lease, { recursive: true, force: true });
  expect(existsSync(lease)).toBe(false);
});
describe("genuine emitted scanner PATH qualification", () => {
  it.each([
    ["success", 4],
    ["refusal", 4],
    ["usability", 10],
  ])(
    "executes native %s controls without running unqualified bytes",
    (group, count) => {
      const result = boundedSpawnSync({
        label: `actual emitted scanner PATH ${group} controls`,
        command: process.execPath,
        args: [
          join(root, "tests/fixtures/git-history-secrets/scanner-path.mjs"),
          "--scanner",
          scanner,
          "--case",
          String(group),
        ],
        cwd: root,
        baseMs: 30000,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      const report = JSON.parse(result.stdout);
      expect(report.scannerVersion).toBe("8.30.1");
      expect(report.scannerSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(report.emittedSourceSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(report.redaction).toBe(true);
      expect(report.cleanup).toBe("owned scratch removed on exit");
      expect(report.observations).toHaveLength(count);
      for (const observation of report.observations) {
        expect(observation.unqualifiedNotExecuted).toBe(true);
        expect(observation.exit).toBe(
          observation.name.includes("finding") ||
            observation.name.includes("still-blocks")
            ? 42
            : group === "refusal" || observation.name.startsWith("explicit-")
              ? 1
              : 0
        );
      }
    }
  );
});
