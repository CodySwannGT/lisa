/** Exact public CLI reference for testing an unreleased verification controller. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

assert.equal(process.argv.length, 3, "Supply one fresh output directory");
const output = path.resolve(process.argv[2]);
mkdirSync(output, { mode: 0o700 });
// The pin must be a release the candidate driver's assertions hold for: 4.90.1
// still shipped parity-safety-net.sh, which the driver now asserts is absent
// (CodySwannGT/lisa#4803), so the job failed on every PR (#4822).
const version = "4.106.2";
const head = "86346999701eb99f26e42136a47074abcc1fe94e";
const url = "https://registry.npmjs.org/@codyswann/lisa/-/lisa-4.106.2.tgz";
const metadataResponse = await fetch(
  `https://registry.npmjs.org/@codyswann%2Flisa/${version}`,
  { signal: AbortSignal.timeout(60_000) }
);
assert.equal(metadataResponse.status, 200);
const metadata = await metadataResponse.json();
assert.equal(metadata.version, version);
assert.equal(metadata.gitHead, head);
assert.equal(metadata.lisaReleaseCommit, head);
assert.equal(metadata.dist.tarball, url);
const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
assert.equal(response.status, 200);
const bytes = Buffer.from(await response.arrayBuffer());
const sha256 = createHash("sha256").update(bytes).digest("hex");
assert.equal(
  sha256,
  "9e194848834a715055e15ee082f00f3f97cdb7287d4e9be78d5124683b59b4a7"
);
const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
assert.equal(integrity, metadata.dist.integrity);
writeFileSync(path.join(output, "reference.tgz"), bytes, {
  mode: 0o644,
  flag: "wx",
});
const identity = {
  version,
  git_head: head,
  archive_url: url,
  sha256,
  integrity,
  bytes: bytes.length,
  captured_at: new Date().toISOString(),
  scope:
    "Published CLI input to the separately identified candidate controller. This does not establish an unreleased candidate CLI apply; repeat with the exact new public package after release.",
};
writeFileSync(
  path.join(output, "identity.json"),
  `${JSON.stringify(identity, null, 2)}\n`,
  { mode: 0o600, flag: "wx" }
);
console.log(JSON.stringify(identity));
