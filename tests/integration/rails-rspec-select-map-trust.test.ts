/**
 * Which downloaded crystalball maps a Rails push trusts
 * (CodySwannGT/lisa#4612). A map decides which specs a push skips, and a
 * repository's artifact listing includes fork pull requests' runs and runs
 * that failed or were cancelled part way. So the selector checks each
 * candidate run with GitHub, newest first, and uses a map only from this
 * repository's own successful run whose pieces are all present and name that
 * run, its base and its head commit. When nothing qualifies, the push runs
 * the full suite. The real `lisa-rspec-select.mjs` runs in a throwaway
 * Rails-shaped repository against a stand-in `gh` (see
 * rails-rspec-select-stand-ins.ts).
 * @module tests/integration/rails-rspec-select-map-trust
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  ALWAYS,
  FULL,
  GH_HEAD_SHA,
  GH_REPO,
  POST,
  calls,
  change,
  fixture,
  mapDocument,
  partial,
  removeFixtures,
  select,
  write,
  writeMap,
} from "./rails-rspec-select-fixture.js";

afterAll(removeFixtures);

/** The partial run a trusted map gives a change to {@link POST}. */
const SELECTED = partial(["spec/models/post_spec.rb", ...ALWAYS]);

/** What GitHub reports for this repository's own run at the recorded head. */
const OURS = { headRepository: GH_REPO, headSha: GH_HEAD_SHA };

/** A fork's run. */
const FORK = "someone/fork";

/**
 * A fixture with no map on disk, a change to {@link POST}, and an artifact
 * listing holding one map per run, newest first, each downloading as that
 * run's own map.
 * @param runIds - Run ids, newest first
 * @returns Fixture root and base commit
 */
function listed(...runIds: string[]): { root: string; base: string } {
  const { root, base } = fixture({ map: "none" });
  const now = Date.now();
  const lines = runIds.map(
    (runId, index) =>
      `${JSON.stringify({ name: `crystalball-map-${base}-${runId}`, runId: Number(runId), createdAt: new Date(now - index * 60_000).toISOString(), expired: false })}\n`
  );
  change(root, { [POST]: "class Post\nend\n" });
  write(root, "gh-artifacts.ndjson", lines.join(""));
  for (const runId of runIds) {
    write(
      root,
      `gh-map-${runId}.json`,
      JSON.stringify(mapDocument(base, undefined, runId))
    );
  }
  return { root, base };
}

/**
 * Describe runs to the stand-in `gh`.
 * @param root - Fixture root
 * @param described - Run id to what GitHub reports for it
 */
function describeRuns(
  root: string,
  described: Record<string, Record<string, unknown>>
): void {
  write(root, "gh-runs.json", JSON.stringify(described));
}

/**
 * The run ids whose artifacts were downloaded.
 * @param root - Fixture root
 * @returns Run ids, in order
 */
function downloaded(root: string): string[] {
  return calls(root, ".gh-calls")
    .filter(call => call[0] === "run" && call[1] === "download")
    .map(call => call[2] ?? "");
}

describe("Rails push map trust", () => {
  it("skips a fork's run and a failed run, and selects from the next run of this repository's code that succeeded", () => {
    const { root } = listed("79", "78", "77");
    describeRuns(root, {
      "79": { ...OURS, headRepository: FORK, conclusion: "success" },
      "78": { ...OURS, conclusion: "failure" },
    });
    const result = select(root);
    expect(result.status, result.output).toBe(0);
    expect(result.calls).toEqual([SELECTED]);
    expect(downloaded(root)).toEqual(["77"]);
  });

  it("runs the full suite, naming each refusal, when no candidate run qualifies", () => {
    const { root } = listed("78", "77");
    describeRuns(root, {
      "78": { ...OURS, conclusion: "cancelled" },
      "77": { ...OURS, headRepository: FORK, conclusion: "success" },
    });
    const result = select(root);
    expect(result.calls).toEqual([FULL]);
    expect(downloaded(root)).toEqual([]);
    expect(result.output).toContain("Running the full suite: missing map");
    expect(result.output).toContain(
      "refused run 78 (it did not succeed (cancelled))"
    );
    expect(result.output).toContain(
      `refused run 77 (its code came from ${FORK}, not ${GH_REPO})`
    );
  });

  it("refuses a map recorded at another head commit than GitHub reports for its run", () => {
    const { root } = listed("77");
    describeRuns(root, {
      "77": { ...OURS, conclusion: "success", headSha: "d".repeat(40) },
    });
    const result = select(root);
    expect(result.calls).toEqual([FULL]);
    expect(result.output).toContain("was not recorded by run 77");
  });

  it("refuses a sharded map with a leg missing", () => {
    const { root, base } = listed("77");
    // The merge of a two-leg suite that carries only one leg's map.
    const leg = {
      ...(mapDocument(base).meta as object),
      job: "shard-1",
      piece: 0,
      pieces: 2,
    };
    write(
      root,
      "gh-map-77.json",
      JSON.stringify({ ...mapDocument(base), meta: { ...leg, merged: [leg] } })
    );
    const result = select(root);
    expect(result.calls).toEqual([FULL]);
    expect(result.output).toContain("only 1 of 2 map pieces were recorded");
  });

  it("refuses a map saved before runs were checked, and replaces it with a trusted one", () => {
    const { root, base } = listed("77");
    writeMap(root, base, base);
    // The map on disk as an older selector saved it: no trust marker.
    const saved = path.join(root, ".lisa/crystalball-map/meta.json");
    const { trust: _trust, ...older } = JSON.parse(
      fs.readFileSync(saved, "utf8")
    ) as Record<string, unknown>;
    fs.writeFileSync(saved, JSON.stringify(older));
    const artifacts = path.join(root, "gh-artifacts.ndjson");
    const listing = fs.readFileSync(artifacts, "utf8");

    fs.writeFileSync(artifacts, "");
    const stranded = select(root);
    expect(stranded.calls).toEqual([FULL]);
    expect(stranded.output).toContain("unverified map");

    fs.writeFileSync(artifacts, listing);
    fs.rmSync(path.join(root, ".lisa/crystalball-map/miss.json"), {
      force: true,
    });
    const trusted = select(root);
    expect(trusted.calls.at(-1)).toEqual(SELECTED);
    expect(downloaded(root)).toEqual(["77"]);
  });
});
