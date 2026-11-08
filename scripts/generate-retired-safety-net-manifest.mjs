#!/usr/bin/env node
/** Hash ownership for the three retired native safety-net entry points. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  historicalHashes,
  readLedgerSections,
} from "./generate-lisa-owned-hash-ledger.mjs";
import { withOwnershipHeader } from "./materialize-copy-overwrite.mjs";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "scripts/lib/retired-safety-net-manifest.json");
const sources = {
  "parity-safety-net.sh": "plugins/src/base/hooks/parity-safety-net.sh",
  "parity-safety-net.agy.sh": "plugins/src/base/hooks/parity-safety-net.agy.sh",
  "lisa-parity-safety-net.ts":
    "src/opencode/plugin-templates/lisa-parity-safety-net.ts",
};
const previous = (() => {
  try {
    return JSON.parse(readFileSync(output, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
})();
const { ledger } = readLedgerSections(root);
const entries = Object.fromEntries(
  Object.entries(sources).map(([name, source]) => {
    // Keep known hashes under shallow clones, just as the shipping ledger does.
    const hashes = new Set([
      ...(previous[name]?.hashes ?? []),
      ...(ledger?.get(`scripts/lisa-hooks/${name}`) ?? []),
      ...historicalHashes(root, source),
      ...historicalHashes(root, `plugins/lisa/hooks/${name}`),
      ...historicalHashes(root, `plugins/lisa-agy/hooks/${name}`),
    ]);
    const authored = readFileSync(path.join(root, source), "utf8");
    const shim =
      name === "parity-safety-net.sh"
        ? withOwnershipHeader(authored, name)
        : authored;
    hashes.add(createHash("sha256").update(shim).digest("hex"));
    return [name, { source, hashes: [...hashes].sort(), shim }];
  })
);
const rendered = `${JSON.stringify(entries, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== rendered) {
    console.error(
      "Retired safety-net ownership changed; run node scripts/generate-retired-safety-net-manifest.mjs"
    );
    process.exitCode = 1;
  } else console.log("Retired safety-net ownership is current.");
} else writeFileSync(output, rendered);
