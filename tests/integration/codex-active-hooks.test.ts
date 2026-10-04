/** CLI migration regression: execute exact saved commands after full apply. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../helpers/test-utils.js";
// Preserve the existing case base, calibrating both deadlines at 2.5x headroom.
// Measured 2026-10-04: 98.275s case / 99.76s suite, 45 contemporaneous samples:
// ps aux matched 4-26 Vitest rows including one sampler (3-25 excluding it),
// 1-minute load 14.84-35.84. No process count is inferred for the older 72s run.
// Raw/qualified readings: .lisa/evidence/4335/green-submit-integration-machine.json.
useIoLatencyBudget(300_000);
let evidence: string;
beforeEach(async () => {
  evidence = await createTempDir();
});
afterEach(async () => cleanupTempDir(evidence));
it("keeps exact legacy commands functional across explicit full refresh and package replacement", async () => {
  const result = boundedSpawnSync({
    command: process.execPath,
    args: [path.resolve(".lisa/evidence/4335/green-reproduce.mjs")],
    label: "explicit full apply command matrix",
    baseMs: 120_000,
    cwd: process.cwd(),
    env: { ...process.env, LISA_COMPAT_EVIDENCE: evidence },
  });
  expect(result.stderr).toBe("");
  expect(result.status, result.stdout).toBe(0);
  const report = await fs.readJson(path.join(evidence, "green-results.json"));
  expect(report.greenEstablished).toBe(true);
  expect(report.after).toHaveLength(4);
  expect(report.apply.status).toBe(0);
  expect(report.candidateIdentity.publicPublication).toBe(false);
  expect(report.candidateIdentity.sourceHead).toMatch(/^[a-f0-9]{40}$/u);
  expect(report.candidateIdentity.indexTree).toMatch(/^[a-f0-9]{40}$/u);
  for (const [file, digest] of Object.entries(report.sourceHashesBefore)) {
    expect(report.candidateIdentity.copiedHashes[file], file).toBe(digest);
  }
  expect(
    report.checks.filter((check: { passed: boolean }) => !check.passed)
  ).toEqual([]);
});
