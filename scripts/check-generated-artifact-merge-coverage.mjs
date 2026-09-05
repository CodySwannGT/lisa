#!/usr/bin/env node
/**
 * Prove every generated artifact is either merge-driver covered or declared
 * unsupported for a reason that is still true (issue CodySwannGT/lisa#3932).
 *
 * ## The gap this closes
 *
 * Lisa ships a merge driver for its checked-in generated artifacts, and
 * `.gitattributes` maps two of them to it. It maps **two of four**. Nothing
 * said so: an artifact joins the unregistered set by being written, and the
 * only way to notice was to enumerate `.gitattributes` by hand and compare it
 * against a list of artifacts that exists nowhere.
 *
 * ## Why the obvious repair is wrong, measured
 *
 * "Register the other two" looks free and is not. Run the driver's own parser
 * over all four:
 *
 * ```
 * src/core/upstream-evidence-manifest.ts               parse=OK  roundtrip=EXACT
 * src/core/lisa-owned-hash-ledger.ts                   parse=OK  roundtrip=EXACT
 * scripts/two-channel-couplings.json                   PARSE-FAIL: mixed indentation
 * src/core/nightly-e2e-guard-behavior-certificate.ts   PARSE-FAIL: mixed indentation
 * ```
 *
 * The parser handles a **flat** one-level `"key": scalar` map, which is what
 * the manifest and the ledger are. The other two are **nested** —
 * `two-channel-couplings.json` carries `ratified` / `inspected` / `counts`
 * sub-objects, and the certificate nests a `contractVersion` /
 * `packageVersions` / `provenances` record under each digest. Mapping them
 * would make the driver run, fail to parse, exit 1 and leave the conflict
 * exactly where it was — a control announcing coverage it does not have.
 *
 * So the unregistered set is a **capability boundary**, not an oversight, and
 * this guard's job is to hold that distinction rather than to erase it.
 *
 * ## The tripwire, which is the part worth having
 *
 * An artifact declared `unsupported` is asserted to STILL fail the parser. The
 * day somebody teaches the driver nested shapes, this guard goes red and names
 * the artifact that can now be registered. A declaration that only recorded
 * "unsupported" would quietly stay wrong forever — the failure mode of every
 * comment that was true when written.
 *
 * CLI:
 *   node scripts/check-generated-artifact-merge-coverage.mjs [--root <dir>]
 *
 * Exit codes:
 *   0 — every artifact's declared merge status matches reality.
 *   1 — a declaration is wrong, an artifact is undeclared, or a mapping is
 *       missing or unsupported.
 *   2 — operational error: `--root` missing its value, or a file unreadable.
 *
 * @module scripts/check-generated-artifact-merge-coverage
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import { parseArtifact, renderArtifact } from "./merge-generated-artifact.mjs";

/** The driver name `.gitattributes` maps an artifact to. */
export const DRIVER = "lisa-generated-artifact";

/** The npm script that runs every generated-artifact check in one go. */
export const AGGREGATE_CHECK = "check:artifacts";

/** Merge dispositions an artifact may declare. */
export const DISPOSITION = Object.freeze({
  DRIVER: "driver",
  UNSUPPORTED: "unsupported",
});

/**
 * Every checked-in generated artifact, with the npm check that regenerates it
 * and the merge disposition it claims.
 *
 * The `check` field is not decoration: {@link undeclaredChecks} reads it so a
 * fifth artifact cannot join `check:artifacts` without also appearing here.
 */
export const GENERATED_ARTIFACTS = Object.freeze([
  Object.freeze({
    path: "src/core/upstream-evidence-manifest.ts",
    check: "check:upstream-evidence-manifest",
    disposition: DISPOSITION.DRIVER,
    reason: "",
  }),
  Object.freeze({
    path: "src/core/lisa-owned-hash-ledger.ts",
    check: "check:lisa-owned-hash-ledger",
    disposition: DISPOSITION.DRIVER,
    reason: "",
  }),
  Object.freeze({
    path: "scripts/two-channel-couplings.json",
    check: "check:two-channel-couplings",
    disposition: DISPOSITION.UNSUPPORTED,
    reason:
      "nested: `ratified` / `inspected` / `counts` sub-objects, which the driver's flat one-level parser rejects",
  }),
  Object.freeze({
    path: "src/core/nightly-e2e-guard-behavior-certificate.ts",
    check: "check:nightly-guard-certificate",
    disposition: DISPOSITION.UNSUPPORTED,
    reason:
      "nested: a contractVersion / packageVersions / provenances record under each digest, which the driver's flat one-level parser rejects",
  }),
]);

/**
 * Checks named by `check:artifacts` that own no generated artifact.
 *
 * `check:deletion-basis` reads the hand-authored `deletions.json` files. There
 * is no generator behind it and therefore nothing for a merge driver to
 * reconstruct, so it is out of this guard's subject rather than undeclared.
 */
export const NON_ARTIFACT_CHECKS = Object.freeze([
  "check:deletion-basis",
  // This guard itself. It runs inside `check:artifacts` and generates nothing;
  // it was the first thing its own undeclared-check arm caught, which is the
  // arm working rather than a special case being carved out for it.
  "check:merge-coverage",
]);

/**
 * Whether `.gitattributes` maps a path to the generated-artifact driver.
 * @param {string} attributes - Contents of `.gitattributes`
 * @param {string} artifactPath - Repository-relative artifact path
 * @returns {boolean} True when a line maps exactly that path to the driver.
 */
export function mapsToDriver(attributes, artifactPath) {
  return attributes
    .split("\n")
    .map(line => line.trim())
    .includes(`${artifactPath} merge=${DRIVER}`);
}

/**
 * Whether the driver can actually structure an artifact.
 *
 * Three conditions, and the third is the one that took measuring:
 *
 * 1. it parses;
 * 2. re-emitting the parse reproduces the bytes, because the driver writes
 *    back what it read and a lossy parse would corrupt the file;
 * 3. **it yields at least one structured entry.** The parser passes
 *    unrecognised regions through verbatim as opaque text, so conditions 1 and
 *    2 alone are nearly unfalsifiable — measured, a hash ledger with every
 *    leading indent stripped still parsed and still round-tripped exactly,
 *    while structuring **0** entries. A mapping over a file the driver
 *    structures nothing in is inert: it would merge no entry pointwise and
 *    fall back to picking a side.
 *
 * ## What this deliberately does NOT claim
 *
 * It is a floor, not a proof of fidelity. Measured, reindenting a single entry
 * left the count unchanged at 148, and appending a stray line *raised* it to
 * 149 by structuring the stray as an entry. So this catches total structural
 * collapse and an unparseable shape; it does not catch an artifact the parser
 * structures slightly wrong. Saying so here rather than letting a future
 * reader infer a stronger guarantee from a passing check.
 * @param {string} text - The artifact's contents
 * @returns {{ok: boolean, reason: string, entries: number}} Verdict, why not, and the entry count.
 */
export function driverCanStructure(text) {
  const parsed = parseArtifact(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, entries: 0 };
  if (renderArtifact(parsed.chunks) !== text)
    return {
      ok: false,
      reason: "parsed, but re-emitting it changed the bytes",
      entries: 0,
    };
  const entries = parsed.chunks.reduce(
    (total, chunk) =>
      total + (chunk.entries instanceof Map ? chunk.entries.size : 0),
    0
  );
  return entries > 0
    ? { ok: true, reason: "", entries }
    : {
        ok: false,
        reason: "parsed and round-tripped, but structured ZERO entries",
        entries: 0,
      };
}

/**
 * Checks wired into `check:artifacts` that no artifact declares.
 * @param {string} packageJson - Contents of `package.json`
 * @returns {string[]} Check names present in the script and undeclared here.
 */
export function undeclaredChecks(packageJson) {
  const script = JSON.parse(packageJson).scripts?.[AGGREGATE_CHECK] ?? "";
  const known = new Set([
    // The aggregate names itself in its own failure message, so it appears in
    // its own body. Excluding it here rather than in the regex keeps the regex
    // a plain "find every check" and puts the reason next to the exclusion.
    AGGREGATE_CHECK,
    ...GENERATED_ARTIFACTS.map(entry => entry.check),
    ...NON_ARTIFACT_CHECKS,
  ]);
  const referenced = [...script.matchAll(/\bcheck:[a-z0-9-]+/gu)].map(
    match => match[0]
  );
  return [...new Set(referenced)].filter(name => !known.has(name));
}

/**
 * Judge one artifact against its declaration.
 * @param {object} entry - One {@link GENERATED_ARTIFACTS} record
 * @param {string} attributes - Contents of `.gitattributes`
 * @param {string} text - The artifact's contents
 * @returns {string[]} Human-readable violations; empty when the declaration holds.
 */
export function judgeArtifact(entry, attributes, text) {
  const mapped = mapsToDriver(attributes, entry.path);
  const { ok, reason } = driverCanStructure(text);
  const wantsDriver = entry.disposition === DISPOSITION.DRIVER;

  if (wantsDriver && !mapped)
    return [
      `${entry.path}: declared \`driver\` but .gitattributes does not map it. Add:\n    ${entry.path} merge=${DRIVER}`,
    ];
  if (wantsDriver && !ok)
    return [
      `${entry.path}: declared \`driver\` and mapped, but the driver cannot structure it (${reason}). The mapping is inert — git falls back to a text merge and says nothing about the driver having done nothing.`,
    ];
  if (!wantsDriver && mapped)
    return [
      `${entry.path}: declared \`unsupported\` yet .gitattributes maps it to ${DRIVER}. The driver will run, fail, and leave the conflict while appearing to have handled it.`,
    ];
  if (!wantsDriver && ok)
    return [
      `${entry.path}: declared \`unsupported\` — reason recorded as "${entry.reason}" — but the driver can now structure it. The boundary moved: map it in .gitattributes and change its disposition to \`driver\`.`,
    ];
  return [];
}

/**
 * Read one repository-relative file.
 * @param {string} root - Repository root
 * @param {string} relative - Repository-relative path
 * @returns {string} File contents.
 */
function read(root, relative) {
  return readFileSync(path.join(root, relative), "utf8");
}

/**
 * Run the whole check against a checkout.
 * @param {string} root - Repository root
 * @returns {{violations: string[], checked: number}} What failed, and how many artifacts were read.
 */
export function inspectGeneratedArtifacts(root) {
  const attributes = read(root, ".gitattributes");
  const undeclared = undeclaredChecks(read(root, "package.json")).map(
    name =>
      `${name} runs in \`check:artifacts\` but no entry in GENERATED_ARTIFACTS declares it. A generated artifact that nothing declares cannot be told from one that needs no merge driver — add it, or list it in NON_ARTIFACT_CHECKS with the reason it owns no artifact.`
  );
  const perArtifact = GENERATED_ARTIFACTS.flatMap(entry =>
    judgeArtifact(entry, attributes, read(root, entry.path))
  );
  return {
    violations: [...undeclared, ...perArtifact],
    checked: GENERATED_ARTIFACTS.length,
  };
}

/**
 * CLI entry point.
 * @param {string[]} argv - Arguments after the script name
 * @returns {number} Process exit code.
 */
export function main(argv) {
  const flag = argv.indexOf("--root");
  if (flag !== -1 && argv[flag + 1] === undefined) {
    console.error("--root requires a directory");
    return 2;
  }
  const root = flag === -1 ? process.cwd() : argv[flag + 1];

  const { violations, checked } = inspectGeneratedArtifacts(root);
  if (violations.length === 0) {
    const driven = GENERATED_ARTIFACTS.filter(
      entry => entry.disposition === DISPOSITION.DRIVER
    ).length;
    console.log(
      `generated-artifact merge coverage: ${String(checked)} artifact(s) declared, ${String(driven)} merge-driver covered, ${String(checked - driven)} declared unsupported and still unparseable by the driver.`
    );
    return 0;
  }
  const detail = violations.map(line => `  - ${line}`).join("\n");
  console.error(`generated-artifact merge coverage FAILED:\n${detail}`);
  return 1;
}

if (invokedAsScript(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
