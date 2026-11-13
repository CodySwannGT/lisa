/**
 * A full monthly evidence release rolls over to `<release>-2`, `-3`, … so a
 * busy month no longer blocks every completion (CodySwannGT/lisa#4838).
 *
 * `pr-assets-2026-11` filled in under two weeks; with no roll-over no work item
 * could be marked done until the month turned. Driven through the actual
 * canonical CLI against the controlled local provider; no real tracker or
 * GitHub write happens.
 * @module tests/unit/scripts/work-item-proof-evidence-overflow
 */
import { readFileSync } from "node:fs";

import { afterAll, afterEach, describe, expect, it } from "vitest";

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
  type ProofFixture,
} from "../../support/work-item-proof-evidence-release.js";
import {
  proofCli,
  proofFixture,
  PROOF_REF,
} from "../../support/work-item-proof-fixture.js";

const ROTATING = "pr-assets-{YYYY-MM}";
const COMMAND = "evidence-release";

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * A rotating host whose current month's release and first overflow are full.
 * @param fixture - Owned disposable repository and controlled provider.
 * @returns The current month's resolved release name.
 */
function fullMonth(fixture: ProofFixture): string {
  configure(fixture, { evidenceRelease: ROTATING });
  const tag = proofCli(fixture, [COMMAND]).stdout.trim();
  existingRelease(fixture, tag, 31, 950);
  existingRelease(fixture, `${tag}-2`, 32, 999);
  return tag;
}

describe("evidence release overflow roll-over", () => {
  it("publishes to the first overflow release with room, and finish completes the item", () => {
    const fixture = proofFixture();
    const tag = fullMonth(fixture);
    const create = absentRelease(fixture, `${tag}-3`);
    const result = publish(fixture);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const published = JSON.parse(result.stdout);
    expect(writes(fixture)[0]).toEqual(create);
    expect(uploadedTags(fixture)).toEqual([`${tag}-3`]);
    const stored = JSON.parse(
      readFileSync(fixture.env.FAKE_GH_ASSET_INDEX!, "utf8")
    ).find((asset: { id: number }) => asset.id === published.asset_id);
    expect(stored.browser_download_url).toContain(
      `/releases/download/${tag}-3/`
    );
    const finished = proofCli(fixture, ["finish", "--ref", PROOF_REF]);
    expect(finished.stderr).toBe("");
    expect(finished.stdout).toContain("work-item completed:");
    expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe("");
  });

  it("--ensure prints the overflow release with room and creates nothing when it exists", () => {
    const fixture = proofFixture();
    const tag = fullMonth(fixture);
    existingRelease(fixture, `${tag}-3`, 33, 12);
    const result = proofCli(fixture, [COMMAND, "--ensure"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(`${tag}-3`);
    expect(writes(fixture)).toEqual([]);
  });

  it("plain evidence-release still prints the period's first release", () => {
    const fixture = proofFixture();
    const tag = fullMonth(fixture);
    expect(proofCli(fixture, [COMMAND]).stdout.trim()).toBe(tag);
    expect(writes(fixture)).toEqual([]);
  });
});
