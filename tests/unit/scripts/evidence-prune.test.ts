/**
 * The dry-run-first evidence prune (CodySwannGT/lisa#4720).
 *
 * GitHub caps a release at 1000 files, and a full evidence release stops every
 * completion. The prune moves evidence nothing still depends on into a monthly
 * archive release and only then deletes it. These cases pin the safety rules:
 * proof a completion record names is never touched, recent or not-yet-superseded
 * evidence is kept, a dry run writes nothing, a copy is confirmed byte-for-byte
 * before its original is deleted, and any incomplete information stops the run
 * before anything changes. Driven through the CLI's exported `main` against an
 * in-memory GitHub; nothing touches the network.
 * @module tests/unit/scripts/evidence-prune
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  archiveReleaseTag,
  collectPins,
  planPrune,
} from "../../../all/copy-overwrite/scripts/lib/evidence-prune.mjs";
import {
  fakeGitHub,
  REPOSITORY,
  sha256,
} from "../../support/evidence-prune-fake-gh.js";
import {
  APPLY,
  ARCHIVE,
  cleanupProjects,
  JSON_FLAG,
  MONTHLY,
  NEARLY_FULL,
  NOW,
  OLD,
  project,
  prune,
  RECORD_AT,
  RECORD_NAME,
  RELEASE,
  seed,
  STALE,
} from "../../support/evidence-prune-harness.js";

const byName = (a: string, b: string) => a.localeCompare(b);

afterEach(cleanupProjects);

describe("evidence prune planning", () => {
  it("collects asset ids and 64-hex digests from anywhere in a record", () => {
    const pins = collectPins([
      { a: { b: [{ asset_id: 7 }] }, c: `sha256:${"A".repeat(64)}` },
      { supersedes: "b".repeat(64), asset_id: "9" },
    ]);
    expect([...pins.assetIds].sort((a, b) => a - b)).toEqual([7, 9]);
    expect(pins.digests.has("a".repeat(64))).toBe(true);
    expect(pins.digests.has("b".repeat(64))).toBe(true);
  });

  it("names the archive for the run's UTC month", () => {
    expect(archiveReleaseTag(MONTHLY, new Date("2026-11-30T23:59:59Z"))).toBe(
      `${MONTHLY}-archive-2026-11`
    );
  });

  it("has no candidates when the release holds no completion record", () => {
    const plan = planPrune({
      release: RELEASE,
      assets: [
        { id: 1, name: "a.txt", size: 1, created_at: OLD, digest: null },
      ],
      records: [],
      now: NOW,
      minAgeDays: 14,
      hashOf: () => "e".repeat(64),
    });
    expect(plan.candidates).toEqual([]);
  });
});

describe("dry run (the default)", () => {
  it("reports the plan and makes no writes", async () => {
    const gh = fakeGitHub();
    seed(gh);
    const { code, output } = await prune(gh);
    expect(code).toBe(0);
    expect(output).toContain(`Evidence release: ${RELEASE}`);
    expect(output).toContain("Total files: 6");
    expect(output).toContain("Pinned: 3");
    expect(output).toContain("Prune candidates: 1");
    expect(output).toContain(ARCHIVE);
    expect(output).toMatch(new RegExp(`${STALE}.*bytes.*2026-10-01`));
    expect(gh.writes()).toEqual([]);
    expect(gh.releases.has(ARCHIVE)).toBe(false);
  });

  it("prints the same report as JSON", async () => {
    const gh = fakeGitHub();
    const { stale } = seed(gh);
    const { code, output } = await prune(gh, [JSON_FLAG]);
    expect(code).toBe(0);
    const report = JSON.parse(output);
    expect(report).toMatchObject({
      release: RELEASE,
      repository: REPOSITORY,
      total: 6,
      pinned: 3,
      archiveRelease: ARCHIVE,
      applied: false,
    });
    expect(report.candidates.map((row: { id: number }) => row.id)).toEqual([
      stale.id,
    ]);
  });

  it("hashes a file without a digest before trusting it is unpinned", async () => {
    const gh = fakeGitHub({ noDigests: true });
    seed(gh);
    const { output } = await prune(gh, [JSON_FLAG]);
    expect(
      JSON.parse(output).candidates.map((row: { name: string }) => row.name)
    ).toEqual([STALE]);
  });
});

describe("--apply", () => {
  it("keeps pinned, recent and not-yet-superseded files", async () => {
    const gh = fakeGitHub();
    seed(gh);
    const { code } = await prune(gh, [APPLY]);
    expect(code).toBe(0);
    expect(gh.names(RELEASE).sort(byName)).toEqual(
      [
        "after-record.txt",
        RECORD_NAME,
        "log-by-sha.txt",
        "screenshot-by-id.png",
        "young.txt",
      ].sort(byName)
    );
  });

  it("archives with the same name and sha256 before deleting the original", async () => {
    const gh = fakeGitHub();
    const { stale } = seed(gh);
    const { code } = await prune(gh, [APPLY]);
    expect(code).toBe(0);
    const copy = gh.releases
      .get(ARCHIVE)
      ?.assets.find(row => row.name === STALE);
    expect(copy && sha256(copy.bytes)).toBe(sha256(stale.bytes));
    const order = gh.calls.map(call => call.args.join(" "));
    const created = order.findIndex(line =>
      line.startsWith(`release create ${ARCHIVE}`)
    );
    const uploaded = order.findIndex(line =>
      line.includes("uploads.github.com")
    );
    const readBack = order.findIndex(
      (line, index) =>
        index > uploaded &&
        line === `api repos/${REPOSITORY}/releases/assets/${copy?.id}`
    );
    const deleted = order.findIndex(line =>
      line.includes(`DELETE repos/${REPOSITORY}/releases/assets/${stale.id}`)
    );
    expect(created).toBeGreaterThan(-1);
    expect(created).toBeLessThan(uploaded);
    expect(uploaded).toBeLessThan(readBack);
    expect(readBack).toBeLessThan(deleted);
    expect(order).toContain(
      `release create ${ARCHIVE} --repo ${REPOSITORY} --target main --title ${ARCHIVE} --notes Archived Lisa evidence --latest=false`
    );
  });

  it("does not delete when the archive read-back does not match", async () => {
    const gh = fakeGitHub({ corruptUploads: true });
    const { stale } = seed(gh);
    const { code, output } = await prune(gh, [APPLY]);
    expect(code).not.toBe(0);
    expect(output).toContain(STALE);
    expect(output).toContain(sha256(stale.bytes));
    expect(output).toContain(
      sha256(Buffer.concat([stale.bytes, Buffer.from("!")]))
    );
    expect(gh.names(RELEASE)).toContain(STALE);
    expect(gh.calls.some(call => call.args.includes("DELETE"))).toBe(false);
  });

  it("stops at the archive's 950-file ceiling", async () => {
    const gh = fakeGitHub();
    seed(gh);
    Array.from({ length: 940 }, (_, index) =>
      gh.addAsset(ARCHIVE, `held-${index}.txt`, OLD)
    );
    Array.from({ length: 29 }, (_, index) =>
      gh.addAsset(RELEASE, `extra-${index}.txt`, OLD)
    );
    const { code, output } = await prune(gh, [APPLY]);
    expect(code).not.toBe(0);
    expect(output).toContain(NEARLY_FULL);
    expect(gh.names(ARCHIVE)).toHaveLength(950);
    expect(gh.names(RELEASE)).toHaveLength(6 + 29 - 10);
    expect(gh.calls.filter(call => call.args.includes("DELETE"))).toHaveLength(
      10
    );
    expect(output).toContain(`Not archived (still in ${RELEASE}): 20`);
    expect(output).toMatch(/^ {2}extra-28\.txt$/m);
  });

  it("refuses without push access, before reading the release", async () => {
    const gh = fakeGitHub({ push: false });
    seed(gh);
    const { code, output } = await prune(gh, [APPLY]);
    expect(code).not.toBe(0);
    expect(output).toMatch(/write access/);
    expect(gh.writes()).toEqual([]);
    expect(
      gh.calls.some(call => call.args.some(arg => arg.includes("/releases")))
    ).toBe(false);
  });
});

describe("incomplete information stops the run", () => {
  it("refuses a truncated listing", async () => {
    const gh = fakeGitHub({ truncateListing: true });
    seed(gh);
    Array.from({ length: 120 }, (_, index) =>
      gh.addAsset(RELEASE, `f-${index}.txt`, OLD)
    );
    const { code, output } = await prune(gh, [APPLY]);
    expect(code).not.toBe(0);
    expect(output).toMatch(/incomplete/i);
    expect(gh.writes()).toEqual([]);
  });

  it("refuses an unparseable completion record", async () => {
    const gh = fakeGitHub();
    seed(gh);
    gh.addAsset(
      RELEASE,
      `completion-ff-r2-${"f".repeat(64)}.json`,
      RECORD_AT,
      "{not json"
    );
    const { code, output } = await prune(gh, [APPLY]);
    expect(code).not.toBe(0);
    expect(output).toContain(`completion-ff-r2-${"f".repeat(64)}.json`);
    expect(output).toMatch(/nothing was changed/i);
    expect(gh.writes()).toEqual([]);
  });

  it("refuses when gh is not signed in", async () => {
    const gh = fakeGitHub({ authenticated: false });
    seed(gh);
    const { code, output } = await prune(gh);
    expect(code).not.toBe(0);
    expect(output).toMatch(/gh auth login/);
  });

  it("names a release that does not exist", async () => {
    const gh = fakeGitHub();
    seed(gh);
    const cwd = project({
      verification: { completion: { evidenceRelease: "pr-assets-{YYYY-MM}" } },
    });
    const { code, output } = await prune(
      gh,
      ["--release", "pr-assets-2026-01"],
      cwd
    );
    expect(code).not.toBe(0);
    expect(output).toContain("pr-assets-2026-01");
    expect(output).toMatch(/not found/);
  });
});

describe("release selection", () => {
  it("follows the configured evidence release", async () => {
    const gh = fakeGitHub();
    seed(gh, MONTHLY);
    const cwd = project({
      verification: { completion: { evidenceRelease: MONTHLY } },
    });
    const { code, output } = await prune(gh, [JSON_FLAG], cwd);
    expect(code).toBe(0);
    expect(JSON.parse(output)).toMatchObject({
      release: MONTHLY,
      archiveRelease: `${MONTHLY}-archive-2026-11`,
    });
  });

  it("honours --archive-release", async () => {
    const gh = fakeGitHub();
    seed(gh);
    const { code } = await prune(gh, [
      APPLY,
      "--archive-release",
      "evidence-cold",
    ]);
    expect(code).toBe(0);
    expect(gh.names("evidence-cold")).toEqual([STALE]);
  });
});
