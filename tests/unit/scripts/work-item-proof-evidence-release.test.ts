/**
 * The publisher writes to the configured evidence release, creates it when
 * absent, and refuses a nearly full release in plain words before uploading
 * (CodySwannGT/lisa#4692). Driven through the actual canonical CLI against the
 * controlled local provider; no real tracker or GitHub write happens.
 * @module tests/unit/scripts/work-item-proof-evidence-release
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

const REPO = "repos/acme/code";
const PAGINATE = "--paginate";
const ROTATING = "pr-assets-{YYYY-MM}";
const COMMAND = "evidence-release";
const NOT_FOUND = "gh: Not Found (HTTP 404)\n";
const FULL_MESSAGE = "GitHub's 1000-file limit";
const CONFIG_HINT = "verification.completion.evidenceRelease";

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

type ProofFixture = ReturnType<typeof proofFixture>;

/** The tag a rotating template resolves to for this run. */
const rotatedTag = () => `pr-assets-${new Date().toISOString().slice(0, 7)}`;

/**
 * Set evidence-release keys under `verification.completion` in the host config.
 * @param fixture - Owned disposable repository.
 * @param keys - Keys merged into `verification.completion`.
 */
function configure(fixture: ProofFixture, keys: Record<string, unknown>) {
  const file = path.join(fixture.root, ".lisa.config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  Object.assign(config.verification.completion, keys);
  writeFileSync(file, JSON.stringify(config));
}

/**
 * Every provider write the CLI attempted, in order.
 * @param fixture - Owned disposable repository and controlled provider.
 * @returns Parsed write argument vectors.
 */
function writes(fixture: ProofFixture): string[][] {
  return readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line));
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
 * Serve a rotated release that does not exist until `gh release create` runs.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param tag - The resolved rotated tag.
 * @returns The exact create argument vector the publisher must issue.
 */
function absentRelease(fixture: ProofFixture, tag: string): string[] {
  setApi(fixture, ["api", `${REPO}/releases/tags/${tag}`], {
    sequence: [{ failure: NOT_FOUND }, { json: { id: 27 } }],
  });
  const create = [
    "release",
    "create",
    tag,
    "--repo",
    "acme/code",
    "--title",
    `Lisa evidence ${tag}`,
    "--notes",
    "Completion-proof and verification evidence assets (managed by Lisa).",
    "--latest=false",
  ];
  setApi(fixture, create, { json: {} });
  setApi(
    fixture,
    ["api", PAGINATE, "--slurp", `${REPO}/releases/27/assets?per_page=100`],
    { kind: "assets" }
  );
  return create;
}

/**
 * Make the legacy release report `count` existing assets.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param count - Number of assets already stored.
 */
function fillLegacyRelease(fixture: ProofFixture, count: number) {
  setApi(
    fixture,
    ["api", PAGINATE, "--slurp", `${REPO}/releases/19/assets?per_page=100`],
    {
      json: [
        Array.from({ length: count }, (_, index) => ({
          id: 5000 + index,
          name: `old-${index}.json`,
        })),
      ],
    }
  );
}

describe("completion-proof publication to the configured evidence release", () => {
  it("creates the missing rotated release, uploads there, and the proof completes", () => {
    const fixture = proofFixture();
    configure(fixture, { evidenceRelease: ROTATING });
    const tag = rotatedTag();
    const create = absentRelease(fixture, tag);
    const result = publish(fixture);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).category).toBe("published");
    const attempted = writes(fixture);
    expect(attempted[0]).toEqual(create);
    const upload = attempted.find(
      args => args[0] === "release" && args[1] === "upload"
    );
    expect(upload?.[2]).toBe(tag);
    const stored = JSON.parse(
      readFileSync(fixture.env.FAKE_GH_ASSET_INDEX!, "utf8")
    ).find((asset: { id: number }) => asset.id === 101);
    expect(stored.browser_download_url).toContain(`/releases/download/${tag}/`);
    const completed = proofCli(fixture, ["complete", "--ref", PROOF_REF]);
    expect(completed.stderr).toBe("");
    expect(completed.stdout).toContain("work-item completed:");
    expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe("");
  });

  it("refuses a nearly full release with a plain message and uploads nothing", () => {
    const fixture = proofFixture();
    fillLegacyRelease(fixture, 950);
    const result = publish(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("write-error");
    expect(result.stderr).toContain("`pr-assets`");
    expect(result.stderr).toContain(`holds 950 of ${FULL_MESSAGE}`);
    expect(result.stderr).toContain(CONFIG_HINT);
    expect(result.stderr).toContain(ROTATING);
    expect(
      writes(fixture).some(
        args => args[0] === "release" && args[1] === "upload"
      )
    ).toBe(false);
  });

  it("still uploads below the near-full threshold", () => {
    const fixture = proofFixture();
    fillLegacyRelease(fixture, 949);
    const result = publish(fixture);
    expect(result.stderr).not.toContain(FULL_MESSAGE);
    expect(
      writes(fixture).some(
        args =>
          args[0] === "release" &&
          args[1] === "upload" &&
          args[2] === "pr-assets"
      )
    ).toBe(true);
  });

  it("maps GitHub's raw 422 asset-limit upload failure to the same plain message", () => {
    const fixture = proofFixture();
    fixture.env.FAKE_GH_UPLOAD_FAILURE =
      "HTTP 422: Validation Failed (https://uploads.github.com/...)\nrelease_asset limit reached\n";
    const result = publish(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("write-error");
    expect(result.stderr).toContain(FULL_MESSAGE);
    expect(result.stderr).toContain(CONFIG_HINT);
  });

  it("keeps the generic failure for an upload that fails for another reason", () => {
    const fixture = proofFixture();
    fixture.env.FAKE_GH_UPLOAD_FAILURE = "HTTP 503: Service Unavailable\n";
    const result = publish(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Immutable completion-proof upload failed");
    expect(result.stderr).not.toContain(FULL_MESSAGE);
  });

  it("refuses an invalid evidenceRelease template before any write", () => {
    const fixture = proofFixture();
    configure(fixture, { evidenceRelease: "pr-assets-{YYYY}" });
    const result = publish(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid-config");
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
    expect(result.stdout.trim()).toBe(rotatedTag());
    const log = fixture.env.FAKE_GH_LOG!;
    expect(existsSync(log) ? readFileSync(log, "utf8") : "").not.toContain(
      "release"
    );
  });

  it("--ensure creates the missing release and prints its tag", () => {
    const fixture = proofFixture();
    configure(fixture, { evidenceRelease: ROTATING });
    const tag = rotatedTag();
    const create = absentRelease(fixture, tag);
    const result = proofCli(fixture, [COMMAND, "--ensure"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(tag);
    expect(writes(fixture)).toEqual([create]);
  });

  it("--ensure fails clearly when the release is nearly full", () => {
    const fixture = proofFixture();
    fillLegacyRelease(fixture, 999);
    const result = proofCli(fixture, [COMMAND, "--ensure"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`holds 999 of ${FULL_MESSAGE}`);
    expect(result.stderr).toContain(CONFIG_HINT);
  });

  it("refuses an invalid template", () => {
    const fixture = proofFixture();
    configure(fixture, { evidenceRelease: "bad/name" });
    const result = proofCli(fixture, [COMMAND]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid-config");
  });
});
