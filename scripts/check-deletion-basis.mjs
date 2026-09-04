#!/usr/bin/env node
/**
 * Refuse a `deletions.json` that declares a path without saying why it may go.
 *
 * This is the AUTHORING gate. `Lisa.processDeletionsFile` has its own runtime
 * fail-safe that keeps an unclassified path in a consumer's repository; the two
 * are deliberately separate mechanisms. The runtime rule protects a consumer
 * whatever manifest they happen to have, including one authored before either
 * existed. This one stops an unclassified path being written here in the first
 * place, so the manifest cannot silently regrow the problem the moment somebody
 * adds entry 256.
 *
 * Without this, the whole change is a one-time sweep. With it, it is a standing
 * property.
 *
 * Also reports the outstanding `needs-review` count, because that number is the
 * debt this change deliberately took on and it should be visible on every run
 * rather than discovered later.
 *
 * Usage: node scripts/check-deletion-basis.mjs
 * @module scripts/check-deletion-basis
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const MANIFESTS = [
  "all",
  "typescript",
  "expo",
  "rails",
  "nestjs",
  "cdk",
  "phaser",
  "harper-fabric",
];

const NEEDS_REVIEW = "needs-review";
const OWNED = "owned";
const LEGACY_PREFIX = "legacy:";

/**
 * Whether one declared path carries a usable basis.
 *
 * Mirrors `resolveDeletionBasis` in `src/core/deletion-basis.ts`. Kept as plain
 * ESM so this check runs with no build step — a gate that needs `dist/` cannot
 * run in a pre-commit hook on a tree that does not compile.
 * @param {object} manifest - Parsed deletions.json.
 * @param {string} declaredPath - The declared path.
 * @returns {boolean} True when the manifest says why the path may be removed.
 */
function isClassified(manifest, declaredPath) {
  const forced = manifest.force?.[declaredPath];
  if (typeof forced === "string" && forced.trim() !== "") return true;
  const declared = manifest.basis?.[declaredPath];
  if (typeof declared !== "string") return false;
  const value = declared.trim();
  if (value === NEEDS_REVIEW || value === OWNED) return true;
  // A `legacy` basis with no prose is unclassified in substance: the point of
  // the kind is that somebody wrote down WHY.
  if (value.startsWith(LEGACY_PREFIX))
    return value.slice(LEGACY_PREFIX.length).trim() !== "";
  return false;
}

let unclassified = 0;
let needsReview = 0;
let classified = 0;

for (const stack of MANIFESTS) {
  const file = path.join(REPO_ROOT, stack, "deletions.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") continue;
    console.error(
      `${stack}/deletions.json could not be read: ${error.message}`
    );
    process.exitCode = 1;
    continue;
  }
  const keep = new Set(manifest.keep ?? []);
  for (const declaredPath of manifest.paths ?? []) {
    if (keep.has(declaredPath)) continue;
    if (!isClassified(manifest, declaredPath)) {
      if (unclassified === 0)
        console.error(
          "Declared for deletion with no basis — say why each may be removed:\n"
        );
      console.error(`  ${stack}/deletions.json  ${declaredPath}`);
      unclassified++;
      continue;
    }
    classified++;
    if (manifest.basis?.[declaredPath]?.trim() === NEEDS_REVIEW) needsReview++;
  }
}

if (unclassified > 0) {
  console.error(
    `\n${unclassified} declared path(s) carry no basis.\n\n` +
      "Add one to that manifest's `basis` map:\n" +
      '  "owned"                    Lisa installs this path today\n' +
      '  "legacy: <reason>"         Lisa shipped it once and no longer does\n' +
      '  "needs-review"             declared before the basis field; debt, but countable\n' +
      "or a `force` entry when the removal is a ruling that must reach an edited copy.\n\n" +
      "An unclassified path is KEPT at apply time rather than deleted, so leaving\n" +
      "it unclassified does not merely fail this check — it stops the removal\n" +
      "reaching consumers at all."
  );
  process.exitCode = 1;
} else {
  console.log(
    `deletion basis: ${classified} declared path(s) classified, of which ${needsReview} still carry \`${NEEDS_REVIEW}\`.`
  );
  if (needsReview > 0)
    console.log(
      `  ${needsReview} reason(s) remain unwritten. Each one replaced by \`legacy: <reason>\` is a path whose removal somebody has justified in writing.`
    );
}
