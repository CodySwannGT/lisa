/**
 * Cull WORDING entries from the required-phrases manifest
 * (CodySwannGT/lisa#4867).
 * @module scripts/lib/markdown-assertions/manifest-cull
 */
import { MANIFEST_COMMENT } from "../phrase-tests/manifest.mjs";

/** What the culled manifest tells whoever opens it next. */
export const CULLED_COMMENT = Object.freeze([
  ...MANIFEST_COMMENT,
  "Culled by scripts/classify-markdown-assertions.mjs (CodySwannGT/lisa#4867): only STRUCTURAL and MACHINE-TOKEN entries remain; the classification is in tests/phrase-manifest/classification/manifest.json.",
  "Add a phrase here only when shipped code (a script, hook or parser) reads it; guidance prose needs review, not a pin. `manifest --check` fails on any WORDING entry.",
]);

/** The manifest's four phrase arrays and the check each holds. */
const BUCKETS = Object.freeze([
  ["required", "required", "string"],
  ["forbidden", "forbidden", "string"],
  ["requiredPatterns", "required", "pattern"],
  ["forbiddenPatterns", "forbidden", "pattern"],
]);

/**
 * @typedef {import("./classify.mjs").Verdict} Verdict
 * @typedef {import("./classify.mjs").Check} Check
 * @typedef {import("../phrase-tests/manifest.mjs").Manifest} Manifest
 */

/**
 * Classify every manifest entry and drop the WORDING ones.
 * @param {Manifest} manifest - The manifest as it stands.
 * @param {(check: Check) => Verdict} classify - The classifier.
 * @returns {{ evidence: object, culled: Manifest, counts: Record<string, number> }}
 *   The evidence (every entry with its class), the culled manifest, and counts.
 */
export function cullManifest(manifest, classify) {
  /** @type {Record<string, number>} */
  const counts = { total: 0, STRUCTURAL: 0, "MACHINE-TOKEN": 0, WORDING: 0 };
  /** @type {Record<string, object>} */
  const evidenceFiles = {};
  /** @type {Record<string, object>} */
  const culledFiles = {};
  for (const [file, entry] of Object.entries(manifest.files)) {
    /** @type {Record<string, unknown[]>} */
    const kept = {};
    /** @type {{ kept: object[], wording: object[] }} */
    const record = { kept: [], wording: [] };
    for (const [key, polarity, kind] of BUCKETS) {
      const values = /** @type {unknown[]} */ (
        /** @type {Record<string, unknown>} */ (entry)[key] ?? []
      );
      kept[key] = values.filter(value => {
        const verdict = classify(
          /** @type {Check} */ ({ file, polarity, kind, value })
        );
        counts.total = (counts.total ?? 0) + 1;
        counts[verdict.class] = (counts[verdict.class] ?? 0) + 1;
        if (verdict.class === "WORDING") {
          record.wording.push({ polarity, kind, value });
          return false;
        }
        record.kept.push({ polarity, kind, value, ...verdict });
        return true;
      });
    }
    evidenceFiles[file] = record;
    if (BUCKETS.some(([key]) => (kept[key]?.length ?? 0) > 0)) {
      culledFiles[file] = { ...kept, source: entry.source };
    }
  }
  counts.filesBefore = Object.keys(manifest.files).length;
  counts.filesAfter = Object.keys(culledFiles).length;
  return {
    evidence: {
      $comment: [
        "Classification of tests/phrase-manifest/required-phrases.json as it stood before the CodySwannGT/lisa#4867 cull.",
        "Produced by `node scripts/classify-markdown-assertions.mjs manifest --apply`; rules in scripts/lib/markdown-assertions/classify.mjs.",
        "`kept` entries carry their class, reason and (for MACHINE-TOKEN) the code file that reads the token; `wording` entries were deleted.",
      ],
      counts,
      files: evidenceFiles,
    },
    culled: { $comment: CULLED_COMMENT, files: culledFiles },
    counts,
  };
}
