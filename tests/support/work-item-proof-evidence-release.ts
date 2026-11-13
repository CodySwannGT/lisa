/**
 * Shared drivers for the evidence-release publication tests: they configure
 * the disposable host's release keys, publish its coherent record through the
 * actual CLI, and stage a release as absent, existing, or filled to a count.
 * @module tests/support/work-item-proof-evidence-release
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  proofCli,
  proofFixture,
  PROOF_REF,
  setApi,
} from "./work-item-proof-fixture.js";

/** The owned disposable host and controlled provider these drivers act on. */
export type ProofFixture = ReturnType<typeof proofFixture>;

export const REPO = "repos/acme/code";
export const PAGINATE = "--paginate";
const NOT_FOUND = "gh: Not Found (HTTP 404)\n";
const NOTES =
  "Evidence storage only — not a product release. Completion-proof and verification evidence assets, managed by Lisa.";

/**
 * Set evidence-release keys under `verification.completion` in the host config.
 * @param fixture - Owned disposable repository.
 * @param keys - Keys merged into `verification.completion`.
 */
export function configure(
  fixture: ProofFixture,
  keys: Record<string, unknown>
): void {
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
export function writes(fixture: ProofFixture): string[][] {
  return readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

/**
 * Every release tag an upload was attempted to, in order.
 * @param fixture - Owned disposable repository and controlled provider.
 * @returns The uploaded-to tags; empty when nothing was uploaded.
 */
export function uploadedTags(fixture: ProofFixture): string[] {
  return writes(fixture)
    .filter(args => args[0] === "release" && args[1] === "upload")
    .map(args => args[2]!);
}

/**
 * Publish the fixture's coherent accepted record through the actual CLI.
 * @param fixture - Owned disposable repository and controlled provider.
 * @returns The actual spawn result.
 */
export function publish(fixture: ProofFixture) {
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
 * The exact `gh release create` vector the publisher issues for a tag.
 * @param tag - The release being created.
 * @returns The argument vector.
 */
export function createArgs(tag: string): string[] {
  return [
    "release",
    "create",
    tag,
    "--repo",
    "acme/code",
    "--title",
    `Lisa evidence ${tag}`,
    "--notes",
    NOTES,
    "--latest=false",
  ];
}

/**
 * Serve a release that does not exist until `gh release create` runs.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param tag - The release tag.
 * @param id - The native id it gets once created.
 * @returns The exact create argument vector the publisher must issue.
 */
export function absentRelease(
  fixture: ProofFixture,
  tag: string,
  id = 27
): string[] {
  const create = createArgs(tag);
  setApi(fixture, ["api", `${REPO}/releases/tags/${tag}`], {
    sequence: [{ failure: NOT_FOUND }, { json: { id } }],
  });
  setApi(fixture, create, { json: {} });
  setApi(
    fixture,
    ["api", PAGINATE, "--slurp", `${REPO}/releases/${id}/assets?per_page=100`],
    { kind: "assets" }
  );
  return create;
}

/**
 * Make release `id` report `count` existing assets.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param id - The release's native id.
 * @param count - Number of assets already stored.
 */
export function fillRelease(
  fixture: ProofFixture,
  id: number,
  count: number
): void {
  setApi(
    fixture,
    ["api", PAGINATE, "--slurp", `${REPO}/releases/${id}/assets?per_page=100`],
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

/**
 * Serve an existing release holding `count` assets.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param tag - The release tag.
 * @param id - The release's native id.
 * @param count - Number of assets already stored.
 */
export function existingRelease(
  fixture: ProofFixture,
  tag: string,
  id: number,
  count: number
): void {
  setApi(fixture, ["api", `${REPO}/releases/tags/${tag}`], { json: { id } });
  fillRelease(fixture, id, count);
}
