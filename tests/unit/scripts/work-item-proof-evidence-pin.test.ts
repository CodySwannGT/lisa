/**
 * `publish-completion-proof` uploads to the release `LISA_EVIDENCE_RELEASE`
 * pins, exactly as `evidence-release` prints it, and a full pin is refused
 * rather than rolled over (CodySwannGT/lisa#4838).
 *
 * The publisher used to resolve the current-month release itself and ignore
 * the pin, so an operator who pinned a release with room still hit the full
 * one and no work item could complete. Driven through the actual canonical CLI
 * against the controlled local provider; no real tracker or GitHub write.
 * @module tests/unit/scripts/work-item-proof-evidence-pin
 */
import { readFileSync } from "node:fs";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
} from "../../support/work-item-cli.js";
import {
  absentRelease,
  configure,
  existingRelease,
  publish,
  uploadedTags,
  writes,
} from "../../support/work-item-proof-evidence-release.js";
import {
  proofCli,
  proofCliSpawned,
  proofFixture,
  PROOF_REF,
} from "../../support/work-item-proof-fixture.js";

// The controlled provider answers in-process (work-item-inprocess-gh.ts), so a
// case no longer starts a Node process per provider call. The cases on
// proofCliSpawned keep the guard and provider as real processes, which is this
// suite's real-boundary proof (CodySwannGT/lisa#4616, audit unit row 25).
vi.mock("node:child_process", async original =>
  (await import("../../support/work-item-inprocess-gh.js")).routeFakeGh(
    await original()
  )
);

const ROTATING = "pr-assets-{YYYY-MM}";
const OVERRIDE = "LISA_EVIDENCE_RELEASE";
const PINNED = "pr-assets-2026-10";

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

describe("publish-completion-proof with LISA_EVIDENCE_RELEASE", () => {
  it("uploads to the pinned release, reads it back from there, and the proof completes", () => {
    const fixture = proofFixture();
    configure(fixture, { evidenceRelease: ROTATING });
    fixture.env[OVERRIDE] = PINNED;
    expect(proofCliSpawned(fixture, ["evidence-release"]).stdout.trim()).toBe(
      PINNED
    );
    const create = absentRelease(fixture, PINNED);
    const result = publish(fixture);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const published = JSON.parse(result.stdout);
    expect(published.category).toBe("published");
    expect(writes(fixture)[0]).toEqual(create);
    expect(uploadedTags(fixture)).toEqual([PINNED]);
    const stored = JSON.parse(
      readFileSync(fixture.env.FAKE_GH_ASSET_INDEX!, "utf8")
    ).find((asset: { id: number }) => asset.id === published.asset_id);
    expect(stored.browser_download_url).toContain(
      `/releases/download/${PINNED}/`
    );
    const completed = proofCliSpawned(fixture, [
      "complete",
      "--ref",
      PROOF_REF,
    ]);
    expect(completed.stderr).toBe("");
    expect(completed.stdout).toContain("work-item completed:");
    expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe("");
  });

  it.each([PINNED, `${PINNED}-2`])(
    "finish accepts proof published earlier to %s once the pin is gone",
    earlier => {
      // The release is staged absent, not full: a release staged at a count
      // serves a fixed listing, so an upload to it could not be read back.
      const fixture = proofFixture();
      configure(fixture, { evidenceRelease: ROTATING });
      fixture.env[OVERRIDE] = earlier;
      absentRelease(fixture, earlier);
      const published = publish(fixture);
      expect(published.stderr).toBe("");
      expect(uploadedTags(fixture)).toEqual([earlier]);
      delete fixture.env[OVERRIDE];
      expect(proofCli(fixture, ["evidence-release"]).stdout.trim()).not.toBe(
        earlier
      );
      const finished = proofCli(fixture, ["finish", "--ref", PROOF_REF]);
      expect(finished.stderr).toBe("");
      expect(finished.stdout).toContain("work-item completed:");
    }
  );

  it("refuses a pin that is not one of this project's releases, before any write", () => {
    const fixture = proofFixture();
    fixture.env[OVERRIDE] = "v1.0.0";
    const result = publish(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid-config");
    expect(result.stderr).toContain(OVERRIDE);
    expect(writes(fixture)).toEqual([]);
  });

  it("refuses a full pinned release and never rolls it over", () => {
    const fixture = proofFixture();
    configure(fixture, { evidenceRelease: ROTATING });
    fixture.env[OVERRIDE] = PINNED;
    existingRelease(fixture, PINNED, 41, 960);
    const result = publish(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("write-error");
    expect(result.stderr).toContain(`\`${PINNED}\``);
    expect(result.stderr).toContain("holds 960 of GitHub's 1000-file limit");
    expect(result.stderr).toContain(OVERRIDE);
    expect(writes(fixture)).toEqual([]);
  });
});
