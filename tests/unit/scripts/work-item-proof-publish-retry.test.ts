/**
 * A completion-proof publish survives a transient GitHub read, and a re-run
 * after a publish that died between its upload and its locator adopts the
 * record it already uploaded instead of stranding it (CodySwannGT/lisa#4733).
 *
 * In a caller repo, one publish lost a read after `gh release upload`. The
 * record asset stayed in the release with no locator pointing at it, and the
 * next run, whose fresh `captured_at` gave it a different digest and so a
 * different asset name, uploaded a second copy. Driven through the actual
 * canonical CLI against the controlled local provider; no real tracker or
 * GitHub write happens.
 * @module tests/unit/scripts/work-item-proof-publish-retry
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
} from "../../support/work-item-cli.js";
import {
  proofFixture,
  proofCli,
  PROOF_REF,
  setApi,
} from "../../support/work-item-proof-fixture.js";

const MARKER = "[lisa-completion-authorization]\n";
const LISTING = [
  "api",
  "--paginate",
  "--slurp",
  "repos/acme/code/releases/19/assets?per_page=100",
];

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

type ProofFixture = ReturnType<typeof proofFixture>;

interface Asset {
  id: number;
  name: string;
  size: number;
}

/**
 * Publish the fixture's coherent accepted record through the actual CLI.
 * @param fixture - Owned disposable repository and controlled provider.
 * @returns The actual spawn result.
 */
function publish(fixture: ProofFixture) {
  const file = path.join(fixture.root, "record-input.json");
  writeFileSync(file, JSON.stringify(fixture.record));
  return proofCli(fixture, [
    "publish-completion-proof",
    "--ref",
    PROOF_REF,
    "--record",
    file,
  ]);
}

/**
 * Every `gh release upload` the CLI ran, across every publish so far.
 * @param fixture - Owned disposable repository and controlled provider.
 * @returns The upload argument vectors, in order.
 */
function uploads(fixture: ProofFixture): string[][] {
  return readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line) as string[])
    .filter(args => args[0] === "release" && args[1] === "upload");
}

/**
 * The release's assets as the controlled provider holds them.
 * @param fixture - Owned disposable repository and controlled provider.
 * @returns Native-shaped asset metadata.
 */
function assets(fixture: ProofFixture): Asset[] {
  return JSON.parse(readFileSync(fixture.env.FAKE_GH_ASSET_INDEX!, "utf8"));
}

/**
 * The locators the tracker holds, parsed.
 * @param fixture - Owned disposable repository and controlled provider.
 * @returns Every completion locator posted so far.
 */
function locators(fixture: ProofFixture) {
  const state = JSON.parse(
    readFileSync(fixture.env.FAKE_GH_STATE_FILE!, "utf8")
  );
  return (state.comments as { body: string }[])
    .filter(row => row.body.startsWith(MARKER))
    .map(row => JSON.parse(row.body.slice(MARKER.length)));
}

/**
 * Remove every locator, as if the publish that uploaded the record had died
 * before posting one: the asset stays, nothing points at it.
 * @param fixture - Owned disposable repository and controlled provider.
 */
function strandUpload(fixture: ProofFixture) {
  const file = fixture.env.FAKE_GH_STATE_FILE!;
  const state = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(
    file,
    JSON.stringify({
      ...state,
      comments: (state.comments as { body: string }[]).filter(
        row => !row.body.startsWith(MARKER)
      ),
    })
  );
}

/**
 * Publish once, then strand that upload; the asset is returned.
 * @param fixture - Owned disposable repository and controlled provider.
 * @returns The stranded record asset.
 */
function strandedRecord(fixture: ProofFixture): Asset {
  const first = publish(fixture);
  expect(first.stderr).toBe("");
  expect(first.status).toBe(0);
  const recordId = JSON.parse(first.stdout).record_id;
  strandUpload(fixture);
  const stranded = assets(fixture).filter(asset =>
    asset.name.startsWith(`${recordId}-r1-`)
  );
  expect(stranded).toHaveLength(1);
  return stranded[0]!;
}

describe("publish-completion-proof under transient GitHub reads", () => {
  it("recovers from a dropped release listing and publishes revision 1 once", () => {
    const fixture = proofFixture();
    setApi(fixture, LISTING, {
      sequence: [
        {
          failure:
            "Get https://api.github.com/: net/http: TLS handshake timeout\n",
        },
        { kind: "assets" },
      ],
    });
    const result = publish(fixture);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const publication = JSON.parse(result.stdout);
    expect(publication.category).toBe("published");
    expect(publication.revision).toBe(1);
    expect(uploads(fixture)).toHaveLength(1);
    expect(locators(fixture)).toHaveLength(1);
  });
});

describe("publish-completion-proof after a stranded upload", () => {
  it("adopts the byte-identical record already uploaded instead of uploading again", () => {
    const fixture = proofFixture();
    const stranded = strandedRecord(fixture);
    const result = publish(fixture);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const publication = JSON.parse(result.stdout);
    expect(publication.revision).toBe(1);
    expect(publication.asset_id).toBe(stranded.id);
    expect(stranded.name).toContain(publication.sha256);
    expect(uploads(fixture)).toHaveLength(1);
    const posted = locators(fixture);
    expect(posted).toHaveLength(1);
    expect(posted[0].asset_id).toBe(stranded.id);
    expect(posted[0].revision).toBe(1);
  });

  it("uploads normally when the record already there differs", () => {
    const fixture = proofFixture();
    const stranded = strandedRecord(fixture);
    const file = path.join(
      fixture.env.FAKE_GH_ASSET_DIRECTORY!,
      `${stranded.id}.bin`
    );
    const other = Buffer.from(
      `${JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), branch: "elsewhere" }, null, 2)}\n`
    );
    writeFileSync(file, other);
    writeFileSync(
      fixture.env.FAKE_GH_ASSET_INDEX!,
      JSON.stringify(
        assets(fixture).map(asset =>
          asset.id === stranded.id ? { ...asset, size: other.length } : asset
        )
      )
    );
    const result = publish(fixture);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const publication = JSON.parse(result.stdout);
    expect(publication.revision).toBe(1);
    expect(publication.asset_id).not.toBe(stranded.id);
    expect(uploads(fixture)).toHaveLength(2);
    expect(locators(fixture)[0].asset_id).toBe(publication.asset_id);
  });
});
