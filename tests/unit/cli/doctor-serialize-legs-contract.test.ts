/**
 * The `serialize_platform_legs` opt-in is a three-part contract that FAILS OPEN.
 *
 * Measured 2026-08-17: `actions: read` declared at job level instead of
 * workflow level produced HTTP 403 → warning annotation → job concluded
 * `success` → both platform legs still started within the same second. The
 * suite behaved exactly as it had before the opt-in, and reported green.
 *
 * These pin the two properties that decide whether the check is worth having:
 * it must fire on an incomplete opt-in, and it must stay SILENT on a caller
 * that never opted in — serialization is off by default on purpose, and a check
 * that fires on correct configuration is one nobody reads.
 */
import {
  isIncompleteOptIn,
  missingParts,
  readContract,
  type SerializeContract,
} from "../../../src/cli/doctor-serialize-legs-contract.js";

const COMPLETE: SerializeContract = {
  optedIn: true,
  forwardsToken: true,
  grantsActionsRead: true,
};

describe("missingParts", () => {
  it("reports nothing for a complete opt-in", () => {
    expect(missingParts(COMPLETE)).toEqual([]);
  });

  it("stays silent for a caller that never opted in", () => {
    // Not an oversight to leave serialization off. A project whose legs
    // authenticate as separate personas gets its suite in the length of its
    // slowest leg and should keep that. Reporting every non-adopter would be
    // advocacy rather than a health check.
    expect(
      missingParts({
        optedIn: false,
        forwardsToken: false,
        grantsActionsRead: false,
      })
    ).toEqual([]);
  });

  it("names the missing token", () => {
    expect(missingParts({ ...COMPLETE, forwardsToken: false })).toEqual([
      "LEG_ORDER_TOKEN (secrets:)",
    ]);
  });

  it("names the missing actions scope", () => {
    // This is the one that bit in production, and the one the runtime can only
    // surface as an HTTP 403 inside its own degrade path.
    expect(missingParts({ ...COMPLETE, grantsActionsRead: false })).toEqual([
      "actions: read (permissions:)",
    ]);
  });

  it("names both when both are absent", () => {
    expect(
      missingParts({
        optedIn: true,
        forwardsToken: false,
        grantsActionsRead: false,
      })
    ).toHaveLength(2);
  });
});

describe("isIncompleteOptIn", () => {
  it("is false for a complete opt-in", () => {
    expect(isIncompleteOptIn(COMPLETE)).toBe(false);
  });

  it("is false for a caller that never opted in", () => {
    expect(
      isIncompleteOptIn({
        optedIn: false,
        forwardsToken: false,
        grantsActionsRead: false,
      })
    ).toBe(false);
  });

  it("is true when the opt-in cannot take effect", () => {
    expect(isIncompleteOptIn({ ...COMPLETE, grantsActionsRead: false })).toBe(
      true
    );
  });
});

/**
 * The measured bug was PLACEMENT, not absence: `actions: read` declared at job
 * level instead of workflow level. A check keyed on the string alone calls that
 * configuration complete and misses the exact defect it exists to catch, so
 * these two fixtures differ only in where the scope sits.
 */
describe("checkSerializeLegsContract placement", () => {
  const workflow = (permissionsBlock: string, jobBlock: string): string =>
    [
      "name: t",
      "on:",
      "  schedule:",
      '    - cron: "0 9 * * *"',
      permissionsBlock,
      "jobs:",
      "  maestro:",
      jobBlock,
      "    uses: CodySwannGT/lisa/.github/workflows/maestro-native-e2e.yml@main",
      "    with:",
      "      serialize_platform_legs: true",
      "    secrets:",
      "      LEG_ORDER_TOKEN: x",
    ].join("\n");

  const JOB_LEVEL = workflow(
    "permissions:\n  contents: read",
    "    permissions:\n      contents: read\n      actions: read"
  );
  const WORKFLOW_LEVEL = workflow(
    "permissions:\n  contents: read\n  actions: read",
    ""
  );

  it("flags actions: read declared at JOB level", () => {
    expect(readContract(JOB_LEVEL).grantsActionsRead).toBe(false);
  });

  it("accepts actions: read declared at WORKFLOW level", () => {
    expect(readContract(WORKFLOW_LEVEL).grantsActionsRead).toBe(true);
  });
});
