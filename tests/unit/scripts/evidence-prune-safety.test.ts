/**
 * Safety rules of the evidence prune that span more than one release or more
 * than one moment (CodySwannGT/lisa#4720).
 *
 * The validator accepts proof from every accepted evidence release, so after a
 * project rotates its release a record in this month's release can depend on a
 * file in last month's. Pins therefore come from every accepted release, and
 * are re-read before each delete in case a record was published mid-run. A
 * same-named file already in the archive is either the copy an earlier run left
 * (reused) or a different file (skipped, never a reason to stop the month).
 * @module tests/unit/scripts/evidence-prune-safety
 */
import { afterEach, describe, expect, it } from "vitest";

import { planPrune } from "../../../all/copy-overwrite/scripts/lib/evidence-prune.mjs";
import { fakeGitHub, sha256 } from "../../support/evidence-prune-fake-gh.js";
import {
  APPLY,
  ARCHIVE,
  cleanupProjects,
  MONTHLY,
  NOW,
  OLD,
  project,
  prune,
  RECORD_AT,
  recordBody,
  RELEASE,
  ROTATING,
  seed,
  STALE,
} from "../../support/evidence-prune-harness.js";

const ROTATED = { verification: { completion: { evidenceRelease: ROTATING } } };
const PRUNE_LEGACY = [APPLY, "--release", RELEASE];
const SECOND = "second.txt";
const LATE_RECORD = `completion-99-r1-${"9".repeat(64)}.json`;

afterEach(cleanupProjects);

/** Count recorded calls whose arguments include `marker`. */
function count(gh: ReturnType<typeof fakeGitHub>, marker: string): number {
  return gh.calls.filter(call => call.args.some(arg => arg.includes(marker)))
    .length;
}

/**
 * Last month's release with no record of its own, and this month's release
 * whose record depends on two of last month's files.
 * @param gh - The fake GitHub to seed.
 * @returns The seeded assets by role.
 */
function rotated(gh: ReturnType<typeof fakeGitHub>) {
  const byId = gh.addAsset(RELEASE, "old-by-id.png", OLD);
  const bySha = gh.addAsset(RELEASE, "old-by-sha.txt", OLD);
  const stale = gh.addAsset(RELEASE, STALE, OLD);
  gh.addAsset(
    MONTHLY,
    `completion-ab-r1-${"a".repeat(64)}.json`,
    RECORD_AT,
    recordBody([byId.id], [sha256(bySha.bytes)])
  );
  return { byId, bySha, stale };
}

describe("pins come from every accepted evidence release", () => {
  it("keeps files a record in another accepted release depends on", async () => {
    const gh = fakeGitHub();
    rotated(gh);
    const { code } = await prune(gh, PRUNE_LEGACY, project(ROTATED));
    expect(code).toBe(0);
    expect(gh.names(RELEASE)).toEqual(["old-by-id.png", "old-by-sha.txt"]);
    expect(gh.names(ARCHIVE)).toEqual([STALE]);
  });

  it("stops when the repository's release listing is incomplete", async () => {
    const gh = fakeGitHub({ truncateReleases: true });
    rotated(gh);
    const { code, output } = await prune(gh, PRUNE_LEGACY, project(ROTATED));
    expect(code).not.toBe(0);
    expect(output).toMatch(/incomplete/i);
    expect(gh.writes()).toEqual([]);
  });

  it("stops when a record in another accepted release cannot be parsed", async () => {
    const gh = fakeGitHub();
    rotated(gh);
    gh.addAsset(MONTHLY, LATE_RECORD, RECORD_AT, "{oops");
    const { code, output } = await prune(gh, PRUNE_LEGACY, project(ROTATED));
    expect(code).not.toBe(0);
    expect(output).toContain(LATE_RECORD);
    expect(gh.writes()).toEqual([]);
  });
});

describe("a record published during the run", () => {
  it("is read before the delete, and a file it now pins is kept", async () => {
    const gh = fakeGitHub({
      onUpload: () =>
        gh.addAsset(RELEASE, LATE_RECORD, RECORD_AT, recordBody([stale.id])),
    });
    const { stale } = seed(gh);
    const { code, output } = await prune(gh, [APPLY]);
    expect(code).toBe(0);
    expect(gh.names(RELEASE)).toContain(STALE);
    expect(gh.names(ARCHIVE)).toEqual([STALE]);
    expect(count(gh, "DELETE")).toBe(0);
    expect(output).toMatch(/stale\.txt.*now depends on it/);
  });

  it("stops without deleting when the new record cannot be read", async () => {
    const gh = fakeGitHub({
      onUpload: () => gh.addAsset(RELEASE, LATE_RECORD, RECORD_AT, "{oops"),
    });
    seed(gh);
    const { code, output } = await prune(gh, [APPLY]);
    expect(code).not.toBe(0);
    expect(output).toContain(LATE_RECORD);
    expect(count(gh, "DELETE")).toBe(0);
  });
});

describe("a same-named file already in the archive", () => {
  it("is skipped, not fatal, when its bytes differ", async () => {
    const gh = fakeGitHub();
    seed(gh);
    gh.addAsset(ARCHIVE, STALE, OLD, "an unrelated file reusing the name");
    gh.addAsset(RELEASE, SECOND, OLD);
    const { code, output } = await prune(gh, [APPLY]);
    expect(code).toBe(0);
    expect(gh.names(RELEASE)).toContain(STALE);
    expect(gh.names(RELEASE)).not.toContain(SECOND);
    expect(output).toContain(
      `a different file named ${STALE} is already in ${ARCHIVE}; kept in ${RELEASE}`
    );
  });

  it("is reused without an upload or a capacity charge when identical", async () => {
    const gh = fakeGitHub();
    const { stale } = seed(gh);
    Array.from({ length: 948 }, (_, index) =>
      gh.addAsset(ARCHIVE, `held-${index}.txt`, OLD)
    );
    gh.addAsset(ARCHIVE, STALE, OLD, stale.bytes);
    gh.addAsset(RELEASE, SECOND, OLD);
    const { code } = await prune(gh, [APPLY]);
    expect(code).toBe(0);
    expect(count(gh, "uploads.github.com")).toBe(1);
    expect(count(gh, "DELETE")).toBe(2);
    expect(gh.names(ARCHIVE)).toHaveLength(950);
  });
});

describe("reporting and access", () => {
  it("does not treat a file as superseded by an older record", () => {
    const plan = planPrune({
      release: RELEASE,
      assets: [
        {
          id: 1,
          name: "late.txt",
          size: 1,
          created_at: "2026-10-05T00:00:00Z",
        },
        { id: 2, name: "completion-x.json", size: 2, created_at: OLD },
      ],
      records: [{}],
      now: NOW,
      minAgeDays: 14,
      hashOf: () => "e".repeat(64),
    });
    expect(plan.candidates).toEqual([]);
  });

  it("reports a file archived but not deleted on its own line", async () => {
    const gh = fakeGitHub({ failDelete: true });
    seed(gh);
    const { code, output } = await prune(gh, [APPLY]);
    expect(code).not.toBe(0);
    expect(output).toContain(`Archived to ${ARCHIVE} but not removed: 1`);
    expect(output).toContain(`Not archived (still in ${RELEASE}): 0`);
  });

  it("says gh was not found when it is not installed", async () => {
    const gh = fakeGitHub({ ghMissing: true });
    const { code, output } = await prune(gh, [], project({ github: {} }));
    expect(code).not.toBe(0);
    expect(output).toMatch(/gh was not found/);
  });

  it("checks sign-in before it needs the repository", async () => {
    const gh = fakeGitHub({ authenticated: false });
    const { output } = await prune(gh, [], project({ github: {} }));
    expect(output).toMatch(/gh auth login/);
    expect(gh.calls.map(call => call.args[0])).toEqual(["auth"]);
  });

  it("does not blame --archive-release when it was not passed", async () => {
    const gh = fakeGitHub();
    const long = `r${"x".repeat(90)}`;
    const cwd = project({
      verification: { completion: { evidenceRelease: long } },
    });
    const { code, output } = await prune(gh, [], cwd);
    expect(code).not.toBe(0);
    expect(output).not.toContain("--archive-release");
    expect(output).toContain(long);
  });

  it("archives a configured release into its own monthly archive", async () => {
    const gh = fakeGitHub();
    seed(gh, MONTHLY);
    const cwd = project({
      verification: { completion: { evidenceRelease: MONTHLY } },
    });
    const { code } = await prune(gh, [APPLY], cwd);
    expect(code).toBe(0);
    expect(gh.names(`${MONTHLY}-archive-2026-11`)).toEqual([STALE]);
    expect(gh.names(MONTHLY)).not.toContain(STALE);
  });
});

describe("review follow-ups", () => {
  it("re-reads the release LISA_EVIDENCE_RELEASE pins, even one created mid-run", async () => {
    const pinned = "pr-assets-2026-12";
    const gh = fakeGitHub({
      onUpload: () =>
        gh.addAsset(pinned, LATE_RECORD, RECORD_AT, recordBody([stale.id])),
    });
    const { stale } = seed(gh);
    const { code, output } = await prune(
      gh,
      [APPLY, "--release", RELEASE],
      project(ROTATED),
      { LISA_EVIDENCE_RELEASE: pinned }
    );
    expect(code).toBe(0);
    expect(gh.names(RELEASE)).toContain(STALE);
    expect(count(gh, "DELETE")).toBe(0);
    expect(output).toMatch(/stale\.txt.*now depends on it/);
  });

  it("stops on a half-finished upload in the archive, naming it", async () => {
    const gh = fakeGitHub();
    seed(gh);
    const stray = gh.addAsset(ARCHIVE, STALE, OLD, "partial");
    stray.state = "starter";
    const { code, output } = await prune(gh, [APPLY]);
    expect(code).not.toBe(0);
    expect(output).toContain(
      `${STALE} in ${ARCHIVE} is a half-finished upload (state "starter"); delete it from ${ARCHIVE} and re-run.`
    );
    expect(count(gh, "DELETE")).toBe(0);
    expect(count(gh, "uploads.github.com")).toBe(0);
  });

  it("refuses a malformed accepted-release history before any gh call", async () => {
    const gh = fakeGitHub();
    const cwd = project({
      verification: { completion: { acceptedEvidenceReleases: "pr-old" } },
    });
    const { code, output } = await prune(gh, [], cwd);
    expect(code).not.toBe(0);
    expect(output).toContain("acceptedEvidenceReleases");
    expect(gh.calls).toEqual([]);
  });
});
