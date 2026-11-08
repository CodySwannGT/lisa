/**
 * End-to-end tests for detect-stale-workflow-inputs.mjs on pinned and
 * unreadable callers (CodySwannGT/lisa#4641).
 *
 * Lisa's pin step rewrites every caller to `uses: …@<sha> # v<version>`. The
 * detector used to find zero callers in such a file and exit 0, so on every
 * pinned host it passed having checked nothing. These cases spawn the real
 * script against committed fixtures and pin the corrected contract:
 *   - a pinned caller is parsed and its stale input reported (exit 1);
 *   - a Lisa caller line the parser cannot read is reported `unparsed`
 *     (exit 1), never counted as a clean scan;
 *   - a project with no Lisa caller at all still exits 0, and says so.
 *
 * @module tests/unit/scripts/detect-stale-workflow-inputs-pinned
 */
import { describe, expect, it } from "vitest";

import {
  CONTRACTS_FLAG,
  CONTRACTS_ROOT,
  EXAMPLE_AGENT_YML,
  findResult,
  PROJECT_FLAG,
  PROJECT_NO_CALLER,
  PROJECT_PINNED_STALE,
  PROJECT_THIRD_PARTY,
  PROJECT_UNPARSED,
  REUSABLE_EXAMPLE_AGENT_YML,
  runDetector,
  runDetectorText,
} from "./detect-stale-workflow-inputs-helpers.js";

const JSON_FLAG = "--json";
const NO_LISA_CALLERS = "no Lisa reusable-workflow callers found";

describe("detect-stale-workflow-inputs on pinned callers", () => {
  it("reports the stale input on a caller pinned with Lisa's version comment (exit 1)", () => {
    const { code, report } = runDetector([
      PROJECT_FLAG,
      PROJECT_PINNED_STALE,
      CONTRACTS_FLAG,
      CONTRACTS_ROOT,
      JSON_FLAG,
    ]);

    expect(code).toBe(1);
    expect(report.summary).toEqual({
      scanned: 1,
      ok: 0,
      stale: 1,
      unknownContract: 0,
      unparsed: 0,
    });
    const result = findResult(report, EXAMPLE_AGENT_YML);
    expect(result?.reusableFile).toBe(REUSABLE_EXAMPLE_AGENT_YML);
    expect(result?.ref).toBe("35d0951f9250572d16872c36b242d679cbc22d72");
    expect(result?.staleInputs).toEqual(["package_manager"]);
    expect(result?.status).toBe("stale");
  });

  it("reports a Lisa caller it cannot read as unparsed (exit 1)", () => {
    const { code, report } = runDetector([
      PROJECT_FLAG,
      PROJECT_UNPARSED,
      CONTRACTS_FLAG,
      CONTRACTS_ROOT,
      JSON_FLAG,
    ]);

    expect(code).toBe(1);
    // An unreadable line was not checked, so it is not a scanned caller job.
    expect(report.summary).toEqual({
      scanned: 0,
      ok: 0,
      stale: 0,
      unknownContract: 0,
      unparsed: 1,
    });
    const result = findResult(report, EXAMPLE_AGENT_YML);
    expect(result?.status).toBe("unparsed");
    expect(result?.line).toBe(12);
    expect(result?.staleInputs).toEqual([]);
  });

  it("names the unparsed row in the human-readable table", () => {
    const { code, stdout } = runDetectorText([
      PROJECT_FLAG,
      PROJECT_UNPARSED,
      CONTRACTS_FLAG,
      CONTRACTS_ROOT,
    ]);

    expect(code).toBe(1);
    expect(stdout).toContain("| unparsed |");
    expect(stdout).toContain(
      "0 of 0 caller jobs have stale inputs (0 unresolvable contract(s)); 1 Lisa caller line(s) could not be read — each Lisa caller line must read `uses: CodySwannGT/lisa/.github/workflows/<file>@<ref>`"
    );
    expect(stdout).not.toContain(NO_LISA_CALLERS);
  });

  it("says no Lisa callers were found when every caller is third-party (exit 0)", () => {
    const { code, stdout } = runDetectorText([
      PROJECT_FLAG,
      PROJECT_THIRD_PARTY,
      CONTRACTS_FLAG,
      CONTRACTS_ROOT,
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain(
      "0 of 1 caller jobs have stale inputs (1 unresolvable contract(s)) — no Lisa reusable-workflow callers found"
    );
  });

  it("does not claim a missing Lisa caller when one was checked", () => {
    const { stdout } = runDetectorText([
      PROJECT_FLAG,
      PROJECT_PINNED_STALE,
      CONTRACTS_FLAG,
      CONTRACTS_ROOT,
    ]);

    expect(stdout).not.toContain(NO_LISA_CALLERS);
  });

  it("says explicitly that a project has no Lisa callers (exit 0)", () => {
    const { code, stdout } = runDetectorText([
      PROJECT_FLAG,
      PROJECT_NO_CALLER,
      CONTRACTS_FLAG,
      CONTRACTS_ROOT,
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain(NO_LISA_CALLERS);
  });
});
