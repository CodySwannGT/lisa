/**
 * The trust checks a Rails push applies to a crystalball map's run before it
 * selects specs from it (CodySwannGT/lisa#4612): this repository's own code,
 * a successful run, and a complete set of pieces recorded by that run at its
 * head commit. End to end in tests/integration/rails-rspec-select-map-trust.
 * @module tests/unit/scripts/rspec-map-trust
 */
import { describe, expect, it } from "vitest";

import {
  mapPiecesRefusal,
  mapRunRefusal,
  rankMapRuns,
} from "../../../all/copy-overwrite/scripts/lib/rspec-selection.mjs";

const REPO = "acme/app";
const BASE = "a".repeat(40);
const HEAD = "c".repeat(40);
const RUN = { runId: "77", baseSha: BASE, headSha: HEAD };
const FOREIGN = "not recorded by run 77";

/**
 * One piece's metadata.
 * @param piece - Zero-based index
 * @param pieces - How many there are
 * @param extra - Overrides
 * @returns Metadata
 */
function piece(
  piece: number,
  pieces: number,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { runId: "77", baseSha: BASE, headSha: HEAD, piece, pieces, ...extra };
}

describe("mapRunRefusal", () => {
  const ours = { conclusion: "success", headSha: HEAD, headRepository: REPO };

  it("accepts this repository's successful run, ignoring case", () => {
    expect(mapRunRefusal(ours, REPO)).toBeNull();
    expect(
      mapRunRefusal({ ...ours, headRepository: "Acme/App" }, REPO)
    ).toBeNull();
  });

  it.each([
    [{ ...ours, headRepository: "someone/fork" }, "came from someone/fork"],
    [{ ...ours, headRepository: undefined }, "an unknown repository"],
    [{ ...ours, conclusion: "failure" }, "did not succeed (failure)"],
    [{ ...ours, conclusion: null }, "did not succeed (still running)"],
    [{ ...ours, headSha: "abc" }, "no head commit"],
    [null, "an unknown repository"],
  ])("refuses %j", (info, reason) => {
    expect(mapRunRefusal(info, REPO)).toContain(reason);
  });
});

describe("mapPiecesRefusal", () => {
  it("accepts an unsharded map and a merge carrying every leg", () => {
    expect(mapPiecesRefusal([piece(0, 1)], RUN)).toBeNull();
    expect(
      mapPiecesRefusal(
        [{ ...piece(0, 2), merged: [piece(1, 2), piece(0, 2)] }],
        RUN
      )
    ).toBeNull();
    expect(mapPiecesRefusal([piece(0, 2), piece(1, 2)], RUN)).toBeNull();
  });

  it.each([
    [[], "hold no map"],
    [[piece(0, 1, { runId: "78" })], FOREIGN],
    [[piece(0, 1, { headSha: "d".repeat(40) })], FOREIGN],
    [[piece(0, 1, { baseSha: "b".repeat(40) })], FOREIGN],
    [[{ runId: "77", baseSha: BASE, headSha: HEAD }], "does not say how many"],
    [[piece(0, 2)], "only 1 of 2"],
    [[piece(0, 2), piece(0, 2)], "only 1 of 2"],
    [[piece(0, 2), piece(1, 3)], "disagree"],
  ])("refuses %j", (metas, reason) => {
    expect(mapPiecesRefusal(metas, RUN)).toContain(reason);
  });
});

describe("rankMapRuns", () => {
  it("lists every run, nearest base first and newest first within it", () => {
    const older = "b".repeat(40);
    const artifacts = [
      {
        name: `crystalball-map-${BASE}-20`,
        baseSha: BASE,
        runId: "20",
        createdAt: "2026-11-02",
      },
      {
        name: `crystalball-map-${BASE}-20-shard-1`,
        baseSha: BASE,
        runId: "20",
        createdAt: "2026-11-02",
      },
      {
        name: `crystalball-map-${BASE}-10-shard-1`,
        baseSha: BASE,
        runId: "10",
        createdAt: "2026-11-01",
      },
      {
        name: `crystalball-map-${older}-30`,
        baseSha: older,
        runId: "30",
        createdAt: "2026-11-03",
      },
    ];
    const ranked = rankMapRuns(artifacts, sha =>
      sha === BASE ? 0 : sha === older ? 2 : undefined
    );
    expect(ranked).toEqual([
      {
        runId: "20",
        baseSha: BASE,
        distance: 0,
        names: [`crystalball-map-${BASE}-20`],
      },
      {
        runId: "10",
        baseSha: BASE,
        distance: 0,
        names: [`crystalball-map-${BASE}-10-shard-1`],
      },
      {
        runId: "30",
        baseSha: older,
        distance: 2,
        names: [`crystalball-map-${older}-30`],
      },
    ]);
  });
});
