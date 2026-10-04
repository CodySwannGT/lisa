/** Record exact local source/build identity with no shipping identity. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const paths = [
  "src/codex/hooks-installer.ts",
  "dist/codex/hooks-installer.js",
  "src/core/upstream-evidence-manifest.ts",
  "dist/core/upstream-evidence-manifest.js",
];
const hashes = {};
for (const file of paths) {
  hashes[file] = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}
const report = {
  captured_at: new Date().toISOString(),
  shipping_head_sha: null,
  scope: "Final local source/build freeze; shipping identity pending",
  hashes,
};
await writeFile(
  ".lisa/evidence/4335/verify-freeze-hashes.json",
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(JSON.stringify(report, null, 2));
