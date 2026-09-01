/**
 * @file doctor-nightly-e2e-reporter-cli.test.ts
 * @description Built-CLI recognition for Lisa's reporting-only reusable
 * @module tests/integration/doctor-nightly-e2e-reporter-cli.test
 */
import { describe, expect, it } from "vitest";

import {
  type DoctorExecution,
  doctorNightlyGuard as doctor,
  readDoctorJson,
} from "./doctor-nightly-e2e-guard-cli-helper.js";

const DETERMINATE_ZERO = "determinate zero";
const REPORTER = "CodySwannGT/lisa/.github/workflows/nightly-e2e-report.yml@";

const execution = (
  overrides: Partial<DoctorExecution> = {}
): DoctorExecution => ({
  stdout: "",
  stderr: "",
  code: 0,
  signal: null,
  killed: false,
  ...overrides,
});

describe("built doctor JSON transport", () => {
  it("retries an empty transport failure and accepts the next JSON result", async () => {
    let calls = 0;
    const stdout = await readDoctorJson(async () => {
      calls += 1;
      return calls === 1
        ? execution({ code: "EAGAIN", stderr: "runner busy" })
        : execution({ stdout: '{"checks":[]}' });
    });

    expect(calls).toBe(2);
    expect(stdout).toBe('{"checks":[]}');
  });

  it("does not retry a semantic failure that emitted JSON", async () => {
    let calls = 0;
    const stdout = await readDoctorJson(async () => {
      calls += 1;
      return execution({ code: 1, stdout: '{"checks":[{"status":"fail"}]}' });
    });

    expect(calls).toBe(1);
    expect(stdout).toContain('"status":"fail"');
  });

  it("reports bounded child evidence when every attempt is empty", async () => {
    let calls = 0;
    const result = readDoctorJson(async () => {
      calls += 1;
      return execution({
        code: "EAGAIN",
        signal: "SIGTERM",
        killed: true,
        stderr: "runner busy",
      });
    });

    await expect(result).rejects.toThrow(
      /no JSON after 3 attempts.*code=EAGAIN.*signal=SIGTERM.*killed=true.*runner busy/u
    );
    expect(calls).toBe(3);
  });
});

describe("built doctor official reporter discovery", () => {
  it("ignores Lisa's official reporting reusable as reporting-only", async () => {
    const finding = await doctor(`
'on': [schedule]
jobs:
  report:
    uses: ${REPORTER}934490d2b60b5a44d96b66d327b9ed40e3d6dc69
    with:
      branch: dev
      gate_context: nightly-health
      bypass_label: nightly-e2e-bypass
`);
    expect(finding).toMatchObject({
      status: "ok",
      detail: expect.stringContaining(DETERMINATE_ZERO),
    });
  });

  it("fails a dynamic reference to Lisa's official reporting reusable", async () => {
    const finding = await doctor(`
'on': [schedule]
jobs:
  report:
    uses: "${REPORTER}\${{ github.ref }}"
    with:
      bypass_label: nightly-e2e-bypass
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/reporting reusable.*static literal/u),
    });
    expect(finding.detail).not.toContain(DETERMINATE_ZERO);
  });

  it("fails a dynamic bypass label passed to the official reporter", async () => {
    const finding = await doctor(`
'on': [schedule]
jobs:
  report:
    uses: ${REPORTER}934490d2b60b5a44d96b66d327b9ed40e3d6dc69
    with:
      bypass_label: \${{ vars.NIGHTLY_BYPASS_LABEL }}
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/bypass_label.*static literal/u),
    });
    expect(finding.detail).not.toContain(DETERMINATE_ZERO);
  });
});
