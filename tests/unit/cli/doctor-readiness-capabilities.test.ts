/**
 * Unit coverage for the capabilities/tools readiness producer (PRD #1739,
 * #1896) and for the close-out contract that no dimension is ever left blank.
 *
 * Dimension 2 asks whether every tool the work needs is provably reachable, not
 * merely installed. The `tool-access-gate` names presence-on-`PATH` as the
 * anti-pattern: reachability is established by a live read-only probe against
 * the real system, and nothing an offline file read can see substitutes for it.
 * So this dimension has no blocker to stand and no evidence to gather — it has a
 * reasoned SKIP, stated every time, which is what keeps the report honest rather
 * than silent.
 * @module tests/unit/cli/doctor-readiness-capabilities
 */
import { readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  CAPABILITIES_TOOLS_DIMENSION_ID,
  assessCapabilitiesToolsDimension,
} from "../../../src/cli/doctor-readiness-capabilities.js";
import {
  READINESS_DIMENSION_IDS,
  checkRepositoryReadiness,
  resolveReadinessReportPath,
} from "../../../src/cli/doctor-readiness.js";
import {
  asFindings,
  makeScratchRepo,
  SKIP,
  writeRepoFile,
} from "../../helpers/readiness-workflow-fixtures.js";

/** The dimension this producer owns. */
const DIMENSION_ID = "capabilities-tools";

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("capabilities");
  return tempDir;
}

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("assessCapabilitiesToolsDimension", () => {
  it("renders a reasoned SKIP naming the live probe it cannot run", async () => {
    const root = await getTempDir();

    const record = await assessCapabilitiesToolsDimension(root);

    expect(record.id).toBe(CAPABILITIES_TOOLS_DIMENSION_ID);
    expect(record.id).toBe(DIMENSION_ID);
    expect(record.status).toBe(SKIP);
    const findings = asFindings(record.findings);
    expect(findings).toHaveLength(1);
    expect(String(findings[0].reason)).toContain("live");
    expect(String(findings[0].reason)).toContain("probe");
    expect(findings[0].skip).toBe(true);
    expect(Object.hasOwn(findings[0], "blocker")).toBe(false);
  });

  it("still SKIPs when the repository declares the tools it uses", async () => {
    const root = await getTempDir();
    await writeRepoFile(
      root,
      "package.json",
      '{ "name": "acme", "devDependencies": { "vitest": "1.0.0" } }\n'
    );

    const record = await assessCapabilitiesToolsDimension(root);

    // Declared-and-installed is precisely the `tool-access-gate` anti-pattern:
    // it must never be reported as reachability.
    expect(record.status).toBe(SKIP);
    expect(Object.hasOwn(asFindings(record.findings)[0], "blocker")).toBe(
      false
    );
  });
});

describe("readiness close-out — every dimension has a producer or a reasoned SKIP", () => {
  it("leaves no dimension blank in the persisted report", async () => {
    const root = await getTempDir();

    await checkRepositoryReadiness(root);

    const report = JSON.parse(
      await readFile(resolveReadinessReportPath(root), "utf8")
    ) as Record<string, unknown>;
    const dimensions = report.dimensions as Array<Record<string, unknown>>;
    expect(dimensions).toHaveLength(8);
    expect(dimensions.map(dimension => dimension.id)).toEqual([
      ...READINESS_DIMENSION_IDS,
    ]);
    for (const dimension of dimensions) {
      const findings = dimension.findings as Array<Record<string, unknown>>;
      expect(findings.length).toBeGreaterThan(0);
      if (dimension.status === SKIP) {
        expect(String(findings[0].reason).trim()).not.toBe("");
        expect(findings[0].skip).toBe(true);
      }
    }
  });
});
