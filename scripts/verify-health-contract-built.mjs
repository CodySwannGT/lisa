#!/usr/bin/env node
/** Empirical proof for the shipped Health v1 contract and real built CLI. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let assertions = 0;
const check = (condition, message) => {
  assertions += 1;
  assert.ok(condition, message);
};
const equal = (actual, expected, message) => {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
};

const root = process.cwd();
const project = await mkdtemp(path.join(tmpdir(), "lisa-health-built-"));
try {
  await writeFile(
    path.join(project, ".lisa.config.json"),
    `${JSON.stringify({ tracker: "github", github: { org: "acme", repo: "app" } }, null, 2)}\n`
  );
  execFileSync(
    process.execPath,
    [path.join(root, "dist/index.js"), "sync", project, "--json"],
    {
      cwd: root,
      env: { ...process.env, LISA_SKIP_UPDATE_CHECK: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const config = JSON.parse(
    await readFile(path.join(project, ".lisa.config.json"), "utf8")
  );
  equal(
    config.health,
    { schedule: "off" },
    "sync populates only health.schedule"
  );
  equal(
    config._lisaSync.populated["health.schedule"],
    "off",
    "sync records literal health.schedule provenance"
  );
  check(
    config.health.latest === undefined,
    "runtime health state stays out of config"
  );
  console.log("[EVIDENCE: health-v1-built-sync]");

  const health = await import("@codyswann/lisa/health");
  const deterministicFindings = [
    {
      check: "config.sync",
      layer: "deterministic",
      status: "warn",
      reason: "A configuration advisory needs operator review.",
    },
  ];
  const deterministic = health.validateHealthResult({
    schemaVersion: 1,
    runId: "health-run-new",
    mode: "deterministic",
    startedAt: "2026-07-20T12:00:00.000Z",
    completedAt: "2026-07-20T12:01:00.000Z",
    findings: deterministicFindings,
    summary: health.summarizeHealthFindings(deterministicFindings),
  });
  equal(deterministic.summary.counts, { pass: 0, warn: 1, fail: 0 });
  equal(deterministic.summary.verdict, "in band");
  const fullFindings = [
    {
      check: "config.sync",
      layer: "deterministic",
      status: "pass",
      reason: "Configuration is synchronized.",
    },
    {
      check: "agent.review",
      layer: "agentic",
      status: "warn",
      reason: "The agent review found a concern for operator review.",
    },
  ];
  const full = health.validateHealthResult({
    schemaVersion: 1,
    runId: "health-run-full",
    mode: "full",
    startedAt: "2026-07-20T12:02:00.000Z",
    completedAt: "2026-07-20T12:03:00.000Z",
    findings: fullFindings,
    summary: health.summarizeHealthFindings(fullFindings),
  });
  equal(full.summary.counts, { pass: 1, warn: 1, fail: 0 });
  equal(full.summary.verdict, "in band");
  check(
    Object.isFrozen(full) && Object.isFrozen(full.findings),
    "result is frozen"
  );
  const historicalFailFindings = [
    fullFindings[0],
    {
      check: "agent.historical-review",
      layer: "agentic",
      status: "fail",
      reason: "The v1 contract historically permits an agentic failure.",
    },
  ];
  const historicalFull = health.validateHealthResult({
    schemaVersion: 1,
    runId: "health-run-historical-full",
    mode: "full",
    startedAt: "2026-07-20T12:04:00.000Z",
    completedAt: "2026-07-20T12:05:00.000Z",
    findings: historicalFailFindings,
    summary: health.summarizeHealthFindings(historicalFailFindings),
  });
  equal(historicalFull.summary.counts, { pass: 1, warn: 0, fail: 1 });
  equal(historicalFull.summary.verdict, "drift detected");
  console.log("[EVIDENCE: health-v1-built-contract]");

  const neverRunProject = await mkdtemp(
    path.join(tmpdir(), "lisa-health-never-")
  );
  try {
    equal(await health.readLatestHealthResult(neverRunProject), {
      status: "never-run",
    });
  } finally {
    await rm(neverRunProject, { recursive: true, force: true });
  }
  equal(
    (await health.writeLatestHealthResult(project, deterministic)).status,
    "written"
  );
  equal(
    (await health.writeLatestHealthResult(project, full)).status,
    "written"
  );
  equal(
    (await health.writeLatestHealthResult(project, deterministic)).status,
    "unchanged"
  );
  const available = await health.readLatestHealthResult(project);
  equal(available.status, "available");
  equal(available.lastRun, full.completedAt);

  await writeFile(path.join(project, ".lisa/health/latest.json"), "{malformed");
  equal((await health.readLatestHealthResult(project)).status, "unreadable");
  await writeFile(
    path.join(project, ".lisa/health/latest.json"),
    JSON.stringify({ ...full, schemaVersion: 2 })
  );
  equal((await health.readLatestHealthResult(project)).status, "unreadable");
  console.log("[EVIDENCE: health-v1-built-storage]");
  check(assertions > 0, "proof must execute assertions");
  console.log(`health-v1 assertions=${assertions}`);
} finally {
  await rm(project, { recursive: true, force: true });
}
