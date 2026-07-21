/**
 * Unit coverage for the repository-readiness doctor collector (RRR-3, #1855).
 *
 * PRD #1739 adds a second, orthogonal doctor question — "may an agent fleet
 * operate here unattended?" — behind `lisa doctor --readiness`. This suite pins
 * the additive, flag-gated collector: the default doctor path never gains the
 * readiness check, the readiness mode emits exactly eight dimensions (SKIP with
 * a reason while later tickets wire evidence), persistence lands at the single
 * resolver's path with schema_version 1, and a write failure degrades to WARN
 * rather than throwing. Warn-only per intake decision O1: the collector never
 * returns `fail`. The blocker gate and narrowed claim (RRR-5, #1857) are pinned
 * separately in doctor-readiness-blockers.test.ts.
 * @module tests/unit/cli/doctor-readiness
 */
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  READINESS_DIMENSION_IDS,
  READINESS_SCHEMA_VERSION,
  checkRepositoryReadiness,
  formatReadinessHeadline,
  resolveReadinessReportPath,
  runDimensionProducer,
} from "../../../src/cli/doctor-readiness.js";
import { runDoctor } from "../../../src/cli/doctor.js";

let tempDir: string | undefined;

/**
 * Resolve a temporary directory for one readiness test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await mkdtemp(path.join(os.tmpdir(), "lisa-readiness-"));
  return tempDir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempDir) {
    await chmod(path.join(tempDir, ".lisa"), 0o755).catch(() => {});
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("resolveReadinessReportPath", () => {
  it("resolves the persistence location through one exported resolver", () => {
    expect(resolveReadinessReportPath("/repo/root")).toBe(
      path.join("/repo/root", ".lisa", "readiness.json")
    );
  });
});

/** The dimension whose producer this suite exercises end to end. */
const DELIVERY_AUTHORITY = "delivery-authority";

/** Operator-facing marker that the readiness question was not answered. */
const NOT_ESTABLISHED = "NOT ESTABLISHED";

/** A dimension record assessed clean, reused across the headline cases. */
const ASSESSED_DIMENSION = {
  id: "context-routing",
  status: "PASS",
  findings: [],
} as const;

/** A dimension record that was never assessed, reused across headline cases. */
const UNASSESSED_DIMENSION = {
  id: DELIVERY_AUTHORITY,
  status: "SKIP",
  findings: [],
} as const;

describe("formatReadinessHeadline", () => {
  it("leads with NOT ESTABLISHED and the unassessed count when anything was skipped", () => {
    const headline = formatReadinessHeadline("READY_WITH_WARNINGS", [
      ASSESSED_DIMENSION,
      UNASSESSED_DIMENSION,
      { id: "proportionality", status: "SKIP", findings: [] },
    ]);

    expect(headline).toContain(NOT_ESTABLISHED);
    expect(headline).toContain("2 of 3 dimensions were never assessed");
  });

  it("agrees in number when exactly one dimension was never assessed", () => {
    const headline = formatReadinessHeadline("READY_WITH_WARNINGS", [
      ASSESSED_DIMENSION,
      UNASSESSED_DIMENSION,
    ]);

    expect(headline).toContain("1 of 2 dimensions was never assessed");
  });

  it("drops the not-established caveat entirely once every dimension is assessed", () => {
    // #1897 follow-up: a fully assessed READY run must not carry a sentence
    // saying the report proves nothing — that contradicts its own verdict.
    const headline = formatReadinessHeadline("READY", [
      ASSESSED_DIMENSION,
      { id: DELIVERY_AUTHORITY, status: "PASS", findings: [] },
    ]);

    expect(headline).not.toContain(NOT_ESTABLISHED);
    expect(headline).not.toContain("never assessed");
    expect(headline).toContain("every dimension was assessed");
    expect(headline).toContain("READY");
  });
});

describe("checkRepositoryReadiness", () => {
  it("assesses exactly eight dimensions and never returns fail", async () => {
    const cwd = await getTempDir();

    const check = await checkRepositoryReadiness(cwd);

    expect(check.status).not.toBe("fail");
    expect(READINESS_DIMENSION_IDS).toHaveLength(8);
    expect(new Set(READINESS_DIMENSION_IDS).size).toBe(8);
  });

  it("persists a schema_version 1 report with verdict, blocker_count, and per-dimension findings", async () => {
    const cwd = await getTempDir();

    await checkRepositoryReadiness(cwd);

    const raw = await readFile(resolveReadinessReportPath(cwd), "utf8");
    const report = JSON.parse(raw) as Record<string, unknown>;
    expect(report.schema_version).toBe(READINESS_SCHEMA_VERSION);
    expect(report.schema_version).toBe(1);
    // #1897: every dimension renders SKIP on this default path, so the report
    // must NOT claim READY — unassessed is not evidence of readiness.
    expect(report.verdict).toBe("READY_WITH_WARNINGS");
    expect(report.narrowed_claim).toBeNull();
    expect(report.blockers).toEqual([]);
    expect(report.blocker_count).toBe(0);
    expect(typeof report.generated_at).toBe("string");
    expect(typeof report.lisa_version).toBe("string");
    expect(typeof report.worker_signature).toBe("string");
    const dimensions = report.dimensions as Array<Record<string, unknown>>;
    expect(dimensions).toHaveLength(8);
    expect(dimensions.map(dimension => dimension.id)).toEqual([
      ...READINESS_DIMENSION_IDS,
    ]);
    for (const dimension of dimensions) {
      expect(dimension.status).toBe("SKIP");
      expect(Array.isArray(dimension.findings)).toBe(true);
    }
  });

  it("gives every dimension without a wired producer a SKIP that states why (#1898)", async () => {
    const cwd = await getTempDir();

    await checkRepositoryReadiness(cwd);

    const raw = await readFile(resolveReadinessReportPath(cwd), "utf8");
    const report = JSON.parse(raw) as Record<string, unknown>;
    const dimensions = report.dimensions as Array<Record<string, unknown>>;
    const skipped = dimensions.filter(dimension => dimension.status === "SKIP");
    expect(skipped.length).toBeGreaterThan(0);
    for (const dimension of skipped) {
      const findings = dimension.findings as Array<Record<string, unknown>>;
      // #1898: a SKIP is never blank — it always carries the reason it was not
      // assessed, so silence is reported as silence rather than as health.
      expect(findings.length).toBeGreaterThan(0);
      expect(typeof findings[0].reason).toBe("string");
      expect(findings[0].reason).not.toBe("");
      expect(findings[0].skip).toBe(true);
      // A SKIP must never name a blocker: the engine would stand it up.
      expect(Object.hasOwn(findings[0], "blocker")).toBe(false);
    }
  });

  it("names the unassessed dimension count and asserts no unattended readiness", async () => {
    const cwd = await getTempDir();

    const check = await checkRepositoryReadiness(cwd);

    // #1897: the operator-facing line must say how much was never assessed and
    // must not turn that silence into a readiness claim.
    expect(check.status).toBe("warn");
    expect(check.detail).toContain(NOT_ESTABLISHED);
    expect(check.detail).toContain("8 of 8 dimensions were never assessed");
    expect(check.detail).not.toMatch(/unattended fleet may run/i);
    expect(check.detail).not.toMatch(/pending evidence wiring/i);
  });

  it("names the standing blocker and prints the narrowed claim when a release path bypasses validation", async () => {
    const cwd = await getTempDir();
    await mkdir(path.join(cwd, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(cwd, ".github", "workflows", "release.yml"),
      [
        "name: Release",
        // A tag push: in-file validation is the expected place for it, so its
        // absence is provable rather than possibly-upstream (an unfiltered
        // `on: [push]` would include the default branch and correctly SKIP).
        "on:",
        "  push:",
        "    tags: ['v*']",
        "jobs:",
        "  publish:",
        "    runs-on: ubuntu-latest",
        "    permissions:",
        "      contents: read",
        "    steps:",
        "      - run: npm publish ./unvalidated-fresh-build.tgz",
        "",
      ].join("\n"),
      "utf8"
    );

    const check = await checkRepositoryReadiness(cwd);

    // The operator at the gate must be told WHICH blocker stands and what the
    // repository IS still ready for — a bare NOT_READY is unactionable.
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("NOT_READY");
    expect(check.detail).toContain("B2");
    expect(check.detail).toContain(
      "It IS ready for supervised, single-ticket agent work"
    );

    const report = JSON.parse(
      await readFile(resolveReadinessReportPath(cwd), "utf8")
    ) as Record<string, unknown>;
    expect(report.verdict).toBe("NOT_READY");
    expect(report.blocker_count).toBe(1);
  });

  it("still names the standing blocker when the report cannot be persisted", async () => {
    const cwd = await getTempDir();
    await mkdir(path.join(cwd, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(cwd, ".github", "workflows", "release.yml"),
      [
        "name: Release",
        "on:",
        "  push:",
        "    tags: ['v*']",
        "jobs:",
        "  publish:",
        "    runs-on: ubuntu-latest",
        "    permissions:",
        "      contents: read",
        "    steps:",
        "      - run: npm publish ./unvalidated-fresh-build.tgz",
        "",
      ].join("\n"),
      "utf8"
    );
    const lisaDir = path.join(cwd, ".lisa");
    await mkdir(lisaDir, { recursive: true });
    await chmod(lisaDir, 0o500);

    const check = await checkRepositoryReadiness(cwd);

    // Persistence failing is exactly when the operator cannot go read the file,
    // so the detail line must still say WHICH blocker stands.
    expect(check.detail).toContain("B2");
    expect(check.detail).toContain(
      "It IS ready for supervised, single-ticket agent work"
    );
    expect(check.detail).toContain("Could not persist");
    await chmod(lisaDir, 0o755);
  });

  it("degrades to a WARN check instead of throwing when the report cannot be written", async () => {
    const cwd = await getTempDir();
    const lisaDir = path.join(cwd, ".lisa");
    await mkdir(lisaDir, { recursive: true });
    // Make .lisa read-only so the atomic write fails.
    await chmod(lisaDir, 0o500);

    const check = await checkRepositoryReadiness(cwd);

    expect(check.status).toBe("warn");
    expect(check.detail.toLowerCase()).toContain("readiness");
    // Restore permissions so afterEach cleanup succeeds.
    await chmod(lisaDir, 0o755);
  });
});

describe("runDimensionProducer", () => {
  it("degrades a throwing producer to a stated-reason SKIP for its own dimension", async () => {
    const record = await runDimensionProducer(
      DELIVERY_AUTHORITY,
      "/nowhere",
      async () => {
        throw new Error("workflow parser exploded");
      }
    );

    // One producer failing must cost its own dimension, never the whole report.
    expect(record.id).toBe(DELIVERY_AUTHORITY);
    expect(record.status).toBe("SKIP");
    const finding = record.findings[0] as Record<string, unknown>;
    expect(finding.skip).toBe(true);
    expect(String(finding.reason)).toContain("workflow parser exploded");
    expect(Object.hasOwn(finding, "blocker")).toBe(false);
  });

  it("returns the producer's record untouched when it succeeds", async () => {
    const record = await runDimensionProducer(
      "proportionality",
      "/nowhere",
      async () => ({ id: "proportionality", status: "PASS", findings: [] })
    );

    expect(record).toEqual({
      id: "proportionality",
      status: "PASS",
      findings: [],
    });
  });
});

describe("runDoctor readiness gating", () => {
  it("omits the readiness check on the default path", async () => {
    const cwd = await getTempDir();
    await writeFile(path.join(cwd, ".lisa.config.json"), "{}\n");

    const result = await runDoctor(
      cwd,
      { offline: true },
      { runUpdateCheck: vi.fn(), write: vi.fn() }
    );

    expect(
      result.checks.some(check => check.name === "Repository readiness")
    ).toBe(false);
  });

  it("appends the readiness check only when --readiness is set", async () => {
    const cwd = await getTempDir();
    await writeFile(path.join(cwd, ".lisa.config.json"), "{}\n");

    const result = await runDoctor(
      cwd,
      { offline: true, readiness: true },
      { runUpdateCheck: vi.fn(), write: vi.fn() }
    );

    expect(
      result.checks.some(check => check.name === "Repository readiness")
    ).toBe(true);
  });
});
