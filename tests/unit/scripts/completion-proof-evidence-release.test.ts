/**
 * The evidence release is configurable and rotatable (CodySwannGT/lisa#4692).
 *
 * GitHub caps a release at 1000 assets. With the release hardcoded to
 * `pr-assets`, a host filled it in about five days and every completion then
 * stopped on a raw HTTP 422. These cases pin the tag resolution, the template
 * validation, and the validator's acceptance set: rotated tags validate, the
 * legacy `pr-assets` release keeps validating after rotation, and anything
 * outside the accepted set or outside the implementation repository is refused.
 * @module tests/unit/scripts/completion-proof-evidence-release
 */
import { describe, expect, it } from "vitest";

import {
  EVIDENCE_RELEASE_ASSET_LIMIT,
  EVIDENCE_RELEASE_NEAR_FULL,
  githubProofTransport,
  isAcceptedEvidenceRelease,
  resolveEvidenceRelease,
} from "../../../all/copy-overwrite/scripts/lib/completion-proof-github.mjs";

const ROTATING = "pr-assets-{YYYY-MM}";
const NOVEMBER = new Date("2026-11-08T12:00:00Z");
const REPOSITORY = "acme/code";
const NOVEMBER_TAG = "pr-assets-2026-11";
const FIXED_NAME = "lisa-evidence";
const INVALID_PROOF = "invalid-proof";
const ASSET_BYTES = Buffer.from('{"fixture":true}\n');

/**
 * A native-shaped asset read served by a stub `gh`, so no network is touched.
 * @param downloadUrl - The `browser_download_url` the stub reports.
 * @param policy - The `verification.completion` policy under test.
 * @returns The validator's outcome: the asset or the thrown refusal.
 */
function readAsset(downloadUrl: string, policy: Record<string, unknown> = {}) {
  const run = (_command: string, args: string[]) =>
    args.includes("Accept: application/octet-stream")
      ? { status: 0, stdout: ASSET_BYTES, stderr: "" }
      : {
          status: 0,
          stdout: JSON.stringify({
            id: 5,
            name: "record.json",
            state: "uploaded",
            size: ASSET_BYTES.length,
            browser_download_url: downloadUrl,
          }),
          stderr: "",
        };
  try {
    return { asset: githubProofTransport(run, REPOSITORY, policy).asset(5) };
  } catch (error) {
    return { error: error as Error & { category?: string } };
  }
}

describe("resolveEvidenceRelease", () => {
  it("defaults to the legacy pr-assets release", () => {
    expect(resolveEvidenceRelease({}, NOVEMBER)).toBe("pr-assets");
    expect(resolveEvidenceRelease(undefined, NOVEMBER)).toBe("pr-assets");
  });

  it("resolves {YYYY-MM} to the current UTC year-month", () => {
    expect(
      resolveEvidenceRelease({ evidenceRelease: ROTATING }, NOVEMBER)
    ).toBe(NOVEMBER_TAG);
    expect(
      resolveEvidenceRelease(
        { evidenceRelease: ROTATING },
        new Date("2027-01-01T00:30:00+02:00")
      )
    ).toBe("pr-assets-2026-12");
  });

  it("returns a fixed name unchanged", () => {
    expect(
      resolveEvidenceRelease({ evidenceRelease: FIXED_NAME }, NOVEMBER)
    ).toBe(FIXED_NAME);
  });

  it.each([
    ["an unknown placeholder", "pr-assets-{YYYY}"],
    ["a stray brace", "pr-assets-{"],
    ["a slash", "pr/assets"],
    ["a leading dash", "-pr-assets"],
    ["an empty name", ""],
    ["a non-string", 7],
    ["an over-long name", `a${"b".repeat(100)}`],
    ["a double dot", "pr..assets"],
    ["a trailing dot", "pr-assets."],
    ["a .lock ending", "pr-assets.lock"],
  ])("refuses %s with an invalid-config error", (_label, value) => {
    let refusal: (Error & { category?: string }) | undefined;
    try {
      resolveEvidenceRelease({ evidenceRelease: value }, NOVEMBER);
    } catch (error) {
      refusal = error as Error & { category?: string };
    }
    expect(refusal?.category).toBe("invalid-config");
    expect(refusal?.message).toContain(
      "verification.completion.evidenceRelease"
    );
    expect(refusal?.message).toContain("{YYYY-MM}");
  });
});

describe("isAcceptedEvidenceRelease", () => {
  it("always accepts the legacy pr-assets release", () => {
    expect(isAcceptedEvidenceRelease({}, "pr-assets")).toBe(true);
    expect(
      isAcceptedEvidenceRelease({ evidenceRelease: ROTATING }, "pr-assets")
    ).toBe(true);
  });

  it("accepts every month of a rotating template, and no other shape", () => {
    const policy = { evidenceRelease: ROTATING };
    expect(isAcceptedEvidenceRelease(policy, NOVEMBER_TAG)).toBe(true);
    expect(isAcceptedEvidenceRelease(policy, "pr-assets-2025-01")).toBe(true);
    expect(isAcceptedEvidenceRelease(policy, "pr-assets-2026-13")).toBe(false);
    expect(isAcceptedEvidenceRelease(policy, "pr-assets-2026-1")).toBe(false);
    expect(isAcceptedEvidenceRelease(policy, "pr-assets-2026-11x")).toBe(false);
    expect(isAcceptedEvidenceRelease(policy, "xpr-assets-2026-11")).toBe(false);
  });

  it("accepts the -2 … -99 overflow releases of every accepted name (#4838)", () => {
    const policy = { evidenceRelease: ROTATING };
    expect(isAcceptedEvidenceRelease(policy, `${NOVEMBER_TAG}-2`)).toBe(true);
    expect(isAcceptedEvidenceRelease(policy, `${NOVEMBER_TAG}-10`)).toBe(true);
    expect(isAcceptedEvidenceRelease(policy, `${NOVEMBER_TAG}-99`)).toBe(true);
    expect(isAcceptedEvidenceRelease(policy, "pr-assets-2")).toBe(true);
    expect(
      isAcceptedEvidenceRelease(
        { evidenceRelease: FIXED_NAME },
        `${FIXED_NAME}-3`
      )
    ).toBe(true);
  });

  it.each([
    `${NOVEMBER_TAG}-0`,
    `${NOVEMBER_TAG}-1`,
    `${NOVEMBER_TAG}-02`,
    `${NOVEMBER_TAG}-100`,
    `${NOVEMBER_TAG}-2-2`,
    `${NOVEMBER_TAG}-2x`,
    "pr-assets-2026",
    "pr-assets-1",
  ])("refuses %s, which is not an overflow release", tag => {
    expect(isAcceptedEvidenceRelease({ evidenceRelease: ROTATING }, tag)).toBe(
      false
    );
  });

  it("treats template punctuation literally", () => {
    const policy = { evidenceRelease: "lisa.evidence-{YYYY-MM}" };
    expect(isAcceptedEvidenceRelease(policy, "lisa.evidence-2026-11")).toBe(
      true
    );
    expect(isAcceptedEvidenceRelease(policy, "lisaXevidence-2026-11")).toBe(
      false
    );
  });

  it("refuses an unconfigured release when nothing rotates", () => {
    expect(isAcceptedEvidenceRelease({}, NOVEMBER_TAG)).toBe(false);
    expect(isAcceptedEvidenceRelease({}, "v1.0.0")).toBe(false);
  });

  it("keeps validating releases listed in acceptedEvidenceReleases", () => {
    const policy = {
      evidenceRelease: "evidence-{YYYY-MM}",
      acceptedEvidenceReleases: ["old-evidence", "pr-assets-{YYYY-MM}"],
    };
    expect(isAcceptedEvidenceRelease(policy, "old-evidence")).toBe(true);
    expect(isAcceptedEvidenceRelease(policy, "pr-assets-2026-10")).toBe(true);
    expect(isAcceptedEvidenceRelease(policy, "evidence-2026-11")).toBe(true);
    expect(isAcceptedEvidenceRelease(policy, "other-evidence")).toBe(false);
  });

  it("refuses an acceptedEvidenceReleases value that is not a list of names", () => {
    expect(() =>
      isAcceptedEvidenceRelease(
        { acceptedEvidenceReleases: "pr-assets-old" },
        "pr-assets"
      )
    ).toThrow(/acceptedEvidenceReleases/);
    expect(() =>
      isAcceptedEvidenceRelease(
        { acceptedEvidenceReleases: ["bad name"] },
        "pr-assets"
      )
    ).toThrow(/acceptedEvidenceReleases/);
  });
});

describe("the completion-proof validator's release check", () => {
  it("accepts an asset in the rotated release", () => {
    const outcome = readAsset(
      `https://github.com/${REPOSITORY}/releases/download/${NOVEMBER_TAG}/record.json`,
      { evidenceRelease: ROTATING }
    );
    expect(outcome.error).toBeUndefined();
    expect(outcome.asset?.bytes.equals(ASSET_BYTES)).toBe(true);
  });

  it("accepts an asset in an overflow release (#4838)", () => {
    const outcome = readAsset(
      `https://github.com/${REPOSITORY}/releases/download/${NOVEMBER_TAG}-2/record.json`,
      { evidenceRelease: ROTATING }
    );
    expect(outcome.error).toBeUndefined();
    expect(outcome.asset?.bytes.equals(ASSET_BYTES)).toBe(true);
  });

  it("still accepts proof in an earlier month's overflow release", () => {
    const outcome = readAsset(
      `https://github.com/${REPOSITORY}/releases/download/pr-assets-2026-10-3/record.json`,
      { evidenceRelease: ROTATING }
    );
    expect(outcome.error).toBeUndefined();
  });

  it("still accepts a legacy pr-assets asset after rotation", () => {
    const outcome = readAsset(
      `https://github.com/${REPOSITORY}/releases/download/pr-assets/record.json`,
      { evidenceRelease: ROTATING }
    );
    expect(outcome.error).toBeUndefined();
  });

  it("refuses a release outside the accepted set and names the accepted ones", () => {
    const outcome = readAsset(
      `https://github.com/${REPOSITORY}/releases/download/v1.0.0/record.json`,
      { evidenceRelease: ROTATING }
    );
    expect(outcome.error?.category).toBe(INVALID_PROOF);
    expect(outcome.error?.message).toContain("pr-assets");
    expect(outcome.error?.message).toContain(ROTATING);
  });

  it("refuses a matching release that lives in another repository", () => {
    const outcome = readAsset(
      `https://github.com/acme/other/releases/download/${NOVEMBER_TAG}/record.json`,
      { evidenceRelease: ROTATING }
    );
    expect(outcome.error?.category).toBe(INVALID_PROOF);
  });

  it("refuses a non-GitHub origin and a nested path", () => {
    expect(
      readAsset(
        `https://example.com/${REPOSITORY}/releases/download/pr-assets/record.json`
      ).error?.category
    ).toBe(INVALID_PROOF);
    expect(
      readAsset(
        `https://github.com/${REPOSITORY}/releases/download/pr-assets/nested/record.json`
      ).error?.category
    ).toBe(INVALID_PROOF);
  });

  it("refuses before GitHub's cap, never at or past it", () => {
    expect(EVIDENCE_RELEASE_NEAR_FULL).toBeLessThan(
      EVIDENCE_RELEASE_ASSET_LIMIT
    );
  });
});
