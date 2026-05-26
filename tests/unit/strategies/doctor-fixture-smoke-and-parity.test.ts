/**
 * Fixture-backed smoke coverage plus exact doctor artifact parity assertions.
 *
 * Issue #756 (Story #748, PRD #741): doctor already has contract-level tests,
 * but it still needs representative readiness fixtures and a strict proof that
 * the generated `plugins/lisa` doctor surfaces stay byte-for-byte aligned with
 * the `plugins/src/base` source assets after `bun run build:plugins`.
 * @module tests/unit/strategies/doctor-fixture-smoke-and-parity
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { renderDoctorReport } from "../../../plugins/src/base/scripts/doctor-report.mjs";

/**
 *
 */
type DoctorStatus = "PASS" | "WARN" | "FAIL" | "SKIP";
/**
 *
 */
type DoctorCheck = {
  readonly id: string;
  readonly status: DoctorStatus;
  readonly summary: string;
  readonly observed?: string;
  readonly remediation?: string;
};
/**
 *
 */
type DoctorGroup = {
  readonly id: string;
  readonly title: string;
  readonly checks: readonly DoctorCheck[];
};
/**
 *
 */
type DoctorReportFixture = {
  readonly generatedAt?: string;
  readonly groups: readonly DoctorGroup[];
};

const BASE_PLUGIN_ROOT = path.resolve("plugins/src/base");
const GENERATED_PLUGIN_ROOT = path.resolve("plugins/lisa");
const DOCTOR_FIXTURES = path.resolve("tests/fixtures/doctor");

const readUtf8 = (filePath: string): string => readFileSync(filePath, "utf8");

const readFixture = (name: string): DoctorReportFixture =>
  JSON.parse(
    readUtf8(path.join(DOCTOR_FIXTURES, `${name}.json`))
  ) as DoctorReportFixture;

describe("doctor fixture smoke coverage (#756)", () => {
  it("renders a missing-config fixture as NOT_READY with actionable failures", () => {
    const report = renderDoctorReport(readFixture("not-ready-missing-config"));

    expect(report.verdict).toBe("NOT_READY");
    expect(report.counts).toEqual({ PASS: 1, WARN: 1, FAIL: 2, SKIP: 0 });
    expect(report.text).toContain("Overall verdict: NOT_READY");
    expect(report.text).toContain(
      "- FAIL config-json: .lisa.config.json is missing"
    );
    expect(report.text).toContain(
      "Observed: No committed Lisa config file was found in the repository root."
    );
    expect(report.text).toContain(
      "Remediation: Create .lisa.config.json with at least tracker and vendor keys before running Lisa workflows."
    );
    expect(report.text).toContain(
      "- FAIL intake-queue: build queue cannot be resolved"
    );
  });

  it("renders a minimally configured GitHub self-host fixture as READY_WITH_WARNINGS", () => {
    const report = renderDoctorReport(
      readFixture("ready-with-warnings-github-self-host")
    );

    expect(report.verdict).toBe("READY_WITH_WARNINGS");
    expect(report.counts).toEqual({ PASS: 3, WARN: 1, FAIL: 0, SKIP: 1 });
    expect(report.text).toContain("Overall verdict: READY_WITH_WARNINGS");
    expect(report.text).toContain(
      "- PASS github-tracker: merged tracker config resolves to GitHub self-host"
    );
    expect(report.text).toContain(
      "- PASS gh-access: gh auth and repo read probe succeeded"
    );
    expect(report.text).toContain(
      "- WARN scheduler-surface: manual Lisa usage is ready, but native scheduler support is unavailable in this runtime"
    );
    expect(report.text).toContain(
      "- SKIP exploratory-bugs: exploratory-bugs is not shipped for this repo surface"
    );
  });
});

describe("doctor source/generated parity (#756)", () => {
  it("keeps the distributed doctor command in lockstep with the source asset", () => {
    expect(
      readUtf8(path.join(GENERATED_PLUGIN_ROOT, "commands", "doctor.md"))
    ).toBe(readUtf8(path.join(BASE_PLUGIN_ROOT, "commands", "doctor.md")));
  });

  it("keeps the distributed doctor skill in lockstep with the source asset", () => {
    expect(
      readUtf8(path.join(GENERATED_PLUGIN_ROOT, "skills", "doctor", "SKILL.md"))
    ).toBe(
      readUtf8(path.join(BASE_PLUGIN_ROOT, "skills", "doctor", "SKILL.md"))
    );
  });

  it("keeps the distributed doctor report helper in lockstep with the source asset", () => {
    expect(
      readUtf8(path.join(GENERATED_PLUGIN_ROOT, "scripts", "doctor-report.mjs"))
    ).toBe(
      readUtf8(path.join(BASE_PLUGIN_ROOT, "scripts", "doctor-report.mjs"))
    );
  });
});
