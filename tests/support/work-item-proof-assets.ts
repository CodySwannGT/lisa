/** Exact controlled native resources and immutable attachment bytes. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { git, type Fixture } from "./work-item-cli.js";
const PAGINATE = "--paginate";
export const PUBLISHER = { id: 993, login: "fixture-publisher", type: "User" };
export const digest = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
/** Stable source identities around the actual disposable Git merge. */
export interface ProofFacts {
  repository: string;
  number: number;
  sourceRef: string;
  branch: string;
  before: string;
  prHead: string;
  merge: string;
  now: string;
  body: string;
}
/**
 * Register exact argv resources, so an unsupported endpoint never passes silently.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param args - Exact provider or CLI argument vector.
 * @param response - Explicit native-shaped response registered for this argument vector.
 */
export function setApi(
  fixture: Fixture,
  args: string[],
  response: unknown
): void {
  const file = fixture.env.FAKE_GH_API_FILE!;
  const table = JSON.parse(readFileSync(file, "utf8"));
  table[JSON.stringify(args)] = response;
  writeFileSync(file, JSON.stringify(table));
}

/**
 * Register real fixture Git comparison facts as a fully paginated native reply.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param base - Observed ancestor commit.
 * @param head - Observed descendant commit.
 */
export function setCompare(fixture: Fixture, base: string, head: string): void {
  const REPO = `repos/${fixture.env.FAKE_GH_REPOSITORY ?? "acme/code"}`;
  const shas = git(
    fixture.root,
    ["rev-list", "--reverse", `${base}..${head}`],
    fixture.env
  )
    .split("\n")
    .filter(Boolean);
  setApi(
    fixture,
    [
      "api",
      PAGINATE,
      "--slurp",
      `${REPO}/compare/${base}...${head}?per_page=100`,
    ],
    {
      json: [
        {
          status: base === head ? "identical" : "ahead",
          total_commits: shas.length,
          merge_base_commit: {
            sha: git(fixture.root, ["merge-base", base, head], fixture.env),
          },
          commits: shas.map(sha => ({
            sha,
            commit: {
              message: git(
                fixture.root,
                ["show", "-s", "--format=%B", sha],
                fixture.env
              ),
            },
          })),
        },
      ],
    }
  );
}

/**
 * Store actual attachment bytes and native release metadata in the owned fixture.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param id - Native fixture asset identifier.
 * @param value - Actual captured fixture bytes or structured value.
 * @returns Exact native asset pointer and byte digest.
 */
export function putAsset(fixture: Fixture, id: number, value: unknown) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(JSON.stringify(value));
  const file = fixture.env.FAKE_GH_ASSET_INDEX!;
  const assets = JSON.parse(readFileSync(file, "utf8"));
  const metadata = {
    id,
    name: `fixture-${id}.json`,
    state: "uploaded",
    size: bytes.length,
    created_at: new Date().toISOString(),
    uploader: PUBLISHER,
    browser_download_url: `https://github.com/${fixture.env.FAKE_GH_REPOSITORY ?? "acme/code"}/releases/download/pr-assets/fixture-${id}.json`,
  };
  writeFileSync(
    path.join(fixture.env.FAKE_GH_ASSET_DIRECTORY!, `${id}.bin`),
    bytes
  );
  writeFileSync(
    file,
    JSON.stringify([
      ...assets.filter((row: { id: number }) => row.id !== id),
      metadata,
    ])
  );
  return { asset_id: id, sha256: digest(bytes), bytes: bytes.length };
}
