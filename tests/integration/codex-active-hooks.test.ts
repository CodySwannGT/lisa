/** CLI migration regression: execute exact saved commands after full apply. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../helpers/test-utils.js";
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
    baseMs: 300_000,
    cwd: process.cwd(),
    env: { ...process.env, LISA_COMPAT_EVIDENCE: evidence },
  });
  expect(result.stderr).toBe("");
  expect(result.status, result.stdout).toBe(0);
  const report = await fs.readJson(path.join(evidence, "green-results.json"));
  expect(report.greenEstablished).toBe(true);
  expect(report.after).toHaveLength(4);
  expect(report.apply.status).toBe(0);
  expect(
    report.checks.filter((check: { passed: boolean }) => !check.passed)
  ).toEqual([]);
}, 300_000);
