/**
 * The publisher writes to the configured evidence release, creates it when
 * absent, and refuses a nearly full release in plain words before uploading
 * (CodySwannGT/lisa#4692). Driven through the actual canonical CLI against the
 * controlled local provider; no real tracker or GitHub write happens.
 * @module tests/unit/scripts/work-item-proof-evidence-release
 */
import { existsSync, readFileSync } from "node:fs";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
} from "../../support/work-item-cli.js";
import {
  absentRelease,
  configure,
  fillRelease,
  publish,
  REPO,
  uploadedTags,
  writes,
  type ProofFixture,
} from "../../support/work-item-proof-evidence-release.js";
import {
  proofFixture,
  proofCli,
  PROOF_REF,
  setApi,
} from "../../support/work-item-proof-fixture.js";

const PAGINATE = "--paginate";
const ROTATING = "pr-assets-{YYYY-MM}";
const COMMAND = "evidence-release";
const NOT_FOUND = "gh: Not Found (HTTP 404)\n";
const FULL_MESSAGE = "GitHub's 1000-file limit";
const CONFIG_HINT = "verification.completion.evidenceRelease";
const UPLOAD_FAILED = "Immutable completion-proof upload failed";
const OVERFLOW = "pr-assets-2";

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

const MONTHLY_TAG = /^pr-assets-\d{4}-(?:0[1-9]|1[0-2])$/;
const OVERRIDE = "LISA_EVIDENCE_RELEASE";
const PINNED = "pr-assets-2026-10";
const INVALID_CONFIG = "invalid-config";

/**
 * The tag the CLI itself resolves for this fixture, read once and reused, so
 * the test never recomputes the month on its own clock.
 * @param fixture - Owned disposable repository with its config written.
 * @returns The resolved concrete tag.
 */
function rotatedTag(fixture: ProofFixture): string {
  const tag = proofCli(fixture, [COMMAND]).stdout.trim();
  expect(tag).toMatch(MONTHLY_TAG);
  return tag;
}

/**
 * Make the legacy release report `count` existing assets.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param count - Number of assets already stored.
 */
function fillLegacyRelease(fixture: ProofFixture, count: number) {
  fillRelease(fixture, 19, count);
}

describe("completion-proof publication to the configured evidence release", () => {
  it("creates the missing rotated release, uploads there, and the proof completes", () => {
    const fixture = proofFixture();
    configure(fixture, { evidenceRelease: ROTATING });
    const tag = rotatedTag(fixture);
    const create = absentRelease(fixture, tag);
    const result = publish(fixture);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).category).toBe("published");
    const attempted = writes(fixture);
    expect(attempted[0]).toEqual(create);
    expect(uploadedTags(fixture)).toEqual([tag]);
    const stored = JSON.parse(
      readFileSync(fixture.env.FAKE_GH_ASSET_INDEX!, "utf8")
    ).find((asset: { id: number }) => asset.id === 101);
    expect(stored.browser_download_url).toContain(`/releases/download/${tag}/`);
    const completed = proofCli(fixture, ["complete", "--ref", PROOF_REF]);
    expect(completed.stderr).toBe("");
    expect(completed.stdout).toContain("work-item completed:");
    expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe("");
  });

  it("rolls a nearly full release over to its first overflow release, and the proof completes", () => {
    const fixture = proofFixture();
    fillLegacyRelease(fixture, 950);
    const create = absentRelease(fixture, OVERFLOW);
    const result = publish(fixture);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(writes(fixture)[0]).toEqual(create);
    expect(uploadedTags(fixture)).toEqual([OVERFLOW]);
    const completed = proofCli(fixture, ["complete", "--ref", PROOF_REF]);
    expect(completed.stderr).toBe("");
    expect(completed.stdout).toContain("work-item completed:");
  });

  it("still uploads below the near-full threshold", () => {
    const fixture = proofFixture();
    fillLegacyRelease(fixture, 949);
    const result = publish(fixture);
    expect(result.stderr).not.toContain(FULL_MESSAGE);
    expect(uploadedTags(fixture)).toEqual(["pr-assets"]);
  });

  it("rolls over once when GitHub's raw 422 names the asset limit, then gives the plain message", () => {
    const fixture = proofFixture();
    absentRelease(fixture, OVERFLOW);
    fixture.env.FAKE_GH_UPLOAD_FAILURE =
      "HTTP 422: Validation Failed (https://uploads.github.com/...)\nrelease_asset limit reached\n";
    const result = publish(fixture);
    expect(result.status).toBe(1);
    expect(uploadedTags(fixture)).toEqual(["pr-assets", OVERFLOW]);
    expect(result.stderr).toContain("write-error");
    expect(result.stderr).toContain(`\`${OVERFLOW}\``);
    expect(result.stderr).toContain(FULL_MESSAGE);
    expect(result.stderr).toContain(CONFIG_HINT);
  });

  it("keeps the generic failure for an upload that fails for another reason", () => {
    const fixture = proofFixture();
    fixture.env.FAKE_GH_UPLOAD_FAILURE = "HTTP 503: Service Unavailable\n";
    const result = publish(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(UPLOAD_FAILED);
    expect(result.stderr).toContain("HTTP 503: Service Unavailable");
    expect(result.stderr).not.toContain(FULL_MESSAGE);
  });

  it("does not call a duplicate-name 422 a full release", () => {
    const fixture = proofFixture();
    fixture.env.FAKE_GH_UPLOAD_FAILURE =
      "HTTP 422: Validation Failed\nname already_exists\n";
    const result = publish(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(UPLOAD_FAILED);
    expect(result.stderr).toContain("already_exists");
    expect(result.stderr).not.toContain(FULL_MESSAGE);
  });

  it("rolls over when an unexplained 422 comes from a release that filled up meanwhile", () => {
    const fixture = proofFixture();
    const assets = (count: number) => [
      Array.from({ length: count }, (_, index) => ({
        id: 5000 + index,
        name: `old-${index}.json`,
      })),
    ];
    setApi(
      fixture,
      ["api", PAGINATE, "--slurp", `${REPO}/releases/19/assets?per_page=100`],
      { sequence: [{ json: assets(10) }, { json: assets(999) }] }
    );
    absentRelease(fixture, OVERFLOW);
    fixture.env.FAKE_GH_UPLOAD_FAILURE = "HTTP 422: Validation Failed\n";
    const result = publish(fixture);
    expect(result.status).toBe(1);
    expect(uploadedTags(fixture)).toEqual(["pr-assets", OVERFLOW]);
    // The overflow release has room, so its 422 is not a full release.
    expect(result.stderr).toContain(UPLOAD_FAILED);
  });

  it("does not roll a pinned release over when its upload hits the limit", () => {
    const fixture = proofFixture();
    fixture.env[OVERRIDE] = "pr-assets";
    fixture.env.FAKE_GH_UPLOAD_FAILURE =
      "HTTP 422: Validation Failed\nrelease_asset limit reached\n";
    const result = publish(fixture);
    expect(result.status).toBe(1);
    expect(uploadedTags(fixture)).toEqual(["pr-assets"]);
    expect(result.stderr).toContain(FULL_MESSAGE);
    expect(result.stderr).toContain(OVERRIDE);
  });

  it("uses a release a concurrent publisher created first", () => {
    const fixture = proofFixture();
    configure(fixture, { evidenceRelease: ROTATING });
    const tag = rotatedTag(fixture);
    const create = absentRelease(fixture, tag);
    setApi(fixture, create, {
      failure: "a release with the same tag name already exists\n",
    });
    const result = publish(fixture);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(uploadedTags(fixture)).toEqual([tag]);
  });

  it("names GitHub's reason when the release cannot be created", () => {
    const fixture = proofFixture();
    configure(fixture, { evidenceRelease: ROTATING });
    const tag = rotatedTag(fixture);
    const create = absentRelease(fixture, tag);
    setApi(fixture, ["api", `${REPO}/releases/tags/${tag}`], {
      failure: NOT_FOUND,
    });
    setApi(fixture, create, {
      failure: "HTTP 403: Resource not accessible by integration\n",
    });
    const result = publish(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not be created");
    expect(result.stderr).toContain("Resource not accessible by integration");
    expect(uploadedTags(fixture)).toEqual([]);
  });

  it("refuses a release lookup that fails for a reason other than 404, without creating", () => {
    const fixture = proofFixture();
    setApi(fixture, ["api", `${REPO}/releases/tags/pr-assets`], {
      failure: "HTTP 500: Internal Server Error\n",
    });
    const result = publish(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("read-error");
    expect(writes(fixture)).toEqual([]);
  });

  it("refuses an invalid evidenceRelease template before any write", () => {
    const fixture = proofFixture();
    configure(fixture, { evidenceRelease: "pr-assets-{YYYY}" });
    const result = publish(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(INVALID_CONFIG);
    expect(result.stderr).toContain(CONFIG_HINT);
    expect(writes(fixture)).toEqual([]);
  });
});

describe("lisa-work-item.mjs evidence-release", () => {
  it("prints the legacy default when nothing is configured", () => {
    const fixture = proofFixture();
    const result = proofCli(fixture, [COMMAND]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("pr-assets");
    expect(writes(fixture)).toEqual([]);
  });

  it("prints the resolved rotated tag without touching GitHub", () => {
    const fixture = proofFixture();
    configure(fixture, { evidenceRelease: ROTATING });
    const result = proofCli(fixture, [COMMAND]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(MONTHLY_TAG);
    const log = fixture.env.FAKE_GH_LOG!;
    expect(existsSync(log) ? readFileSync(log, "utf8") : "").not.toContain(
      "release"
    );
  });

  it("--ensure creates the missing release and prints its tag", () => {
    const fixture = proofFixture();
    configure(fixture, { evidenceRelease: ROTATING });
    const tag = rotatedTag(fixture);
    const create = absentRelease(fixture, tag);
    const result = proofCli(fixture, [COMMAND, "--ensure"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(tag);
    expect(writes(fixture)).toEqual([create]);
  });

  it("--ensure rolls a nearly full release over and prints the overflow release", () => {
    const fixture = proofFixture();
    fillLegacyRelease(fixture, 999);
    const create = absentRelease(fixture, OVERFLOW);
    const result = proofCli(fixture, [COMMAND, "--ensure"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(OVERFLOW);
    expect(writes(fixture)).toEqual([create]);
  });

  it("honours LISA_EVIDENCE_RELEASE when it names an accepted release", () => {
    const fixture = proofFixture();
    configure(fixture, { evidenceRelease: ROTATING });
    fixture.env[OVERRIDE] = PINNED;
    const result = proofCli(fixture, [COMMAND]);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(PINNED);
  });

  it("--ensure creates and capacity-checks the LISA_EVIDENCE_RELEASE override", () => {
    const fixture = proofFixture();
    configure(fixture, { evidenceRelease: ROTATING });
    fixture.env[OVERRIDE] = PINNED;
    const create = absentRelease(fixture, PINNED);
    const result = proofCli(fixture, [COMMAND, "--ensure"]);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(PINNED);
    expect(writes(fixture)).toEqual([create]);
  });

  it("--ensure refuses a full LISA_EVIDENCE_RELEASE override and never rolls it over", () => {
    const fixture = proofFixture();
    fixture.env[OVERRIDE] = "pr-assets";
    fillLegacyRelease(fixture, 960);
    const result = proofCli(fixture, [COMMAND, "--ensure"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`holds 960 of ${FULL_MESSAGE}`);
    expect(result.stderr).toContain(OVERRIDE);
    expect(writes(fixture)).toEqual([]);
  });

  it.each(["v1.0.0", "bad/name", "pr-assets-{YYYY-MM}"])(
    "refuses a LISA_EVIDENCE_RELEASE of %s that is not an accepted concrete release",
    value => {
      const fixture = proofFixture();
      fixture.env[OVERRIDE] = value;
      const result = proofCli(fixture, [COMMAND]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(INVALID_CONFIG);
      expect(result.stderr).toContain(OVERRIDE);
    }
  );

  it("refuses an invalid template", () => {
    const fixture = proofFixture();
    configure(fixture, { evidenceRelease: "bad/name" });
    const result = proofCli(fixture, [COMMAND]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(INVALID_CONFIG);
  });
});
