/**
 * @file doctor-nightly-e2e-reporter-cli.test.ts
 * @description Built-CLI recognition for Lisa's reporting-only reusable
 * @module tests/integration/doctor-nightly-e2e-reporter-cli.test
 */
import { describe, expect, it } from "vitest";

import { doctorNightlyGuard as doctor } from "./doctor-nightly-e2e-guard-cli-helper.js";

const DETERMINATE_ZERO = "determinate zero";
const REPORTER = "CodySwannGT/lisa/.github/workflows/nightly-e2e-report.yml@";

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
