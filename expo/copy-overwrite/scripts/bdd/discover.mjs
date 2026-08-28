// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Test-file DISCOVERY for the BDD gate.
 *
 * Validating what a manifest DECLARES can only ever find defects in the
 * declarations. A test file nobody declared is invisible to that check, which
 * is precisely how undeclared end-to-end specs came to sit on default branches
 * with a green gate above them. This module walks the project's own declared
 * roots, extracts each test's evidence string, and hands the caller the specs
 * that no mapping and no exclusion accounts for.
 *
 * Nothing here names a runner, a directory, or a file extension: roots,
 * extensions and the evidence grammar are per-runner CONTRACT DATA
 * (`testDiscovery` in the coverage map), and the runner→platform pairing is
 * derived from `runnerPlatforms`. A gate with `e2e/` compiled into it cannot
 * see a project that keeps its flows anywhere else — the exact reason a
 * subflow directory was structurally invisible to the fork this replaces.
 *
 * @module scripts/bdd/discover
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { byCodeUnit } from "./contract.mjs";
import { listFiles, posix, resolveInsideRepo } from "./parse.mjs";

/**
 * A path without its trailing slashes.
 *
 * An index scan rather than `.replace(/\/+$/, "")`. A quantified class pinned
 * to `$` is re-attempted from every position before it can fail, which is
 * super-linear in the path's length — S5852. Walking back from the end is one
 * pass and cannot backtrack.
 * @param {string} value - A repo-relative path or prefix.
 * @returns {string} The same path with every trailing `/` removed.
 */
const withoutTrailingSlashes = value => {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
};

/**
 * Normalize a repo-relative path or path prefix to one comparable spelling.
 *
 * `./e2e/`, `e2e`, and `e2e/` all name the same directory, and the repo root
 * is spelled `.` in a `roots` list but never appears in a repo-relative file
 * path at all. Comparing the raw strings made those spellings disagree.
 * @param {string} value - A repo-relative path or prefix.
 * @returns {string} Its canonical form; the empty string means the repo root.
 */
const canonicalPath = value =>
  withoutTrailingSlashes(posix(String(value)).replace(/^\.\/+/, "")).replace(
    /^\.$/,
    ""
  );

/**
 * Whether a repo-relative path lies at or under a path prefix, SEGMENT-WISE.
 *
 * A raw `startsWith` treats a prefix as a character prefix, so an ignore entry
 * of `e2e/live` also swallowed `e2e/live-personas/…` — silently hiding a whole
 * directory of undeclared tests, which is the one thing discovery exists to
 * find. Matching is therefore on path segments: `e2e/live` covers `e2e/live`
 * and `e2e/live/…` and nothing else.
 * @param {string} relative - A repo-relative path.
 * @param {string} prefix - A repo-relative path prefix.
 * @returns {boolean} Whether the path is covered by the prefix.
 */
export function isUnderPrefix(relative, prefix) {
  const target = canonicalPath(relative);
  const root = canonicalPath(prefix);
  if (root === "") return true;
  return target === root || target.startsWith(`${root}/`);
}

/**
 * Build one defect record, always naming the entity it is about.
 * @param {string} code - Stable machine-readable defect code.
 * @param {string} message - Operator-readable description.
 * @param {string} subject - The entity the finding is about.
 * @returns {{code: string, message: string, subject: string}} The defect.
 */
const defect = (code, message, subject) => ({ code, message, subject });

/** Defect / evidence code, named once. */
const CALL_TITLE = "call-title";

/** Defect / evidence code, named once. */
const EXCLUSION_STALE = "exclusion-stale";

/**
 * The evidence grammars a project may choose from, as SOURCE CONSTANTS.
 *
 * An allowlist, never a project-supplied regular expression: the coverage map
 * is repo data an author edits, and compiling a pattern out of it would hand
 * that author the gate's own execution. `call-title` reads a titled test call
 * (`test("...")`, `it.skip('...')`); `line-field` reads a leading document
 * field (`name: ...`), which is how flow-style runners title a file.
 */
export const EVIDENCE_KINDS = Object.freeze([CALL_TITLE, "line-field"]);

/** A JavaScript identifier, the only shape a declared function name may take. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Member calls that still declare an executable test rather than a suite/helper. */
const TEST_DECLARATION_MODIFIERS = Object.freeze([
  "concurrent",
  "fail",
  "fixme",
  "only",
  "skip",
  "todo",
]);

/**
 * Replace JavaScript comments with whitespace before looking for test calls.
 *
 * The discovery grammar intentionally stays dependency-free, but matching the
 * raw source lets prose such as `the unit test (`fixture`) covers this branch`
 * masquerade as an executable `test(...)` declaration. Preserve strings and
 * newlines exactly so real evidence remains verbatim and line structure stays
 * stable; only line and block comment bodies are hidden from the matcher.
 * @param {string} source - JavaScript or TypeScript source.
 * @returns {string} Source with comment characters replaced by whitespace.
 */
function withoutComments(source) {
  const output = source.split("");
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === "\n" || current === "\r") lineComment = false;
      else output[index] = " ";
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        output[index] = " ";
        output[index + 1] = " ";
        blockComment = false;
        index += 1;
      } else if (current !== "\n" && current !== "\r") {
        output[index] = " ";
      }
      continue;
    }
    if (quote !== null) {
      if (current === "\\") index += 1;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === '"' || current === "'" || current === "`") {
      quote = current;
    } else if (current === "/" && next === "/") {
      output[index] = " ";
      output[index + 1] = " ";
      lineComment = true;
      index += 1;
    } else if (current === "/" && next === "*") {
      output[index] = " ";
      output[index + 1] = " ";
      blockComment = true;
      index += 1;
    }
  }
  return output.join("");
}

/** A document field name, the only shape a declared field may take. */
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * True for a plain JSON object.
 * @param {unknown} value - Candidate.
 * @returns {boolean} Whether it is a non-array object.
 */
const isObject = value =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * True for a non-empty array whose every entry passes a test.
 * @param {unknown} value - Candidate.
 * @param {(entry: unknown) => boolean} predicate - Entry test.
 * @returns {boolean} Whether the array is usable.
 */
const isListOf = (value, predicate) =>
  Array.isArray(value) && value.length > 0 && value.every(predicate);

/**
 * The problems that make one runner's discovery block unusable.
 *
 * Every one of these is refused rather than skipped. Skipping a malformed
 * block would silently disable discovery for that runner — the same
 * one-character fail-open the coverage floor already refuses.
 * @param {string} runner - Runner name the block is keyed under.
 * @param {unknown} config - The raw block.
 * @param {object} contract - Parsed coverage map.
 * @returns {string[]} Reasons, empty when the block is usable.
 */
function configProblems(runner, config, contract) {
  if (!contract.runnerPlatforms?.[runner]) {
    return [`names runner ${runner}, which runnerPlatforms does not declare`];
  }
  if (!isObject(config)) return ["is not a JSON object"];
  return [
    ...rootProblems(config.roots),
    ...(isListOf(config.extensions, entry => isExtension(entry))
      ? []
      : ['extensions must be a non-empty array of suffixes like ".spec.ts"']),
    ...(config.ignore === undefined ||
    (Array.isArray(config.ignore) &&
      config.ignore.every(entry => typeof entry === "string"))
      ? []
      : ["ignore must be an array of repo-relative path prefixes"]),
    ...evidenceProblems(config.evidence),
  ];
}

/**
 * Whether a declared extension is a usable suffix.
 * @param {unknown} entry - Candidate extension.
 * @returns {boolean} Whether it is a dot-prefixed suffix.
 */
function isExtension(entry) {
  return typeof entry === "string" && entry.startsWith(".") && entry.length > 1;
}

/**
 * Reject unusable or escaping roots.
 * @param {unknown} roots - Declared roots.
 * @returns {string[]} Reasons, empty when usable.
 */
function rootProblems(roots) {
  if (
    !isListOf(roots, entry => typeof entry === "string" && entry.length > 0)
  ) {
    return ["roots must be a non-empty array of repo-relative directories"];
  }
  return roots
    .filter(
      root =>
        path.isAbsolute(root) ||
        /^[a-zA-Z]:/.test(root) ||
        root.split(/[\\/]/).includes("..")
    )
    .map(root => `root ${root} must be repo-relative and must not traverse up`);
}

/**
 * Reject an evidence grammar the gate does not implement, or one whose
 * parameters would end up inside a regular expression unvalidated.
 * @param {unknown} evidence - Declared evidence grammar.
 * @returns {string[]} Reasons, empty when usable.
 */
function evidenceProblems(evidence) {
  if (!isObject(evidence)) return ["evidence must be a JSON object"];
  if (!EVIDENCE_KINDS.includes(evidence.kind)) {
    return [
      `evidence.kind ${JSON.stringify(evidence.kind)} is not one of ${EVIDENCE_KINDS.join(", ")}`,
    ];
  }
  if (evidence.kind === CALL_TITLE) {
    return isListOf(
      evidence.functions,
      entry => typeof entry === "string" && IDENTIFIER.test(entry)
    )
      ? []
      : ["evidence.functions must be a non-empty array of function names"];
  }
  return typeof evidence.field === "string" && FIELD_NAME.test(evidence.field)
    ? []
    : ["evidence.field must be a document field name"];
}

/**
 * Read and validate the whole `testDiscovery` block.
 * @param {object} contract - Parsed coverage map.
 * @returns {{configs: Map<string, object>, defects: object[]}} Usable configs and refusals.
 */
function readDiscovery(contract) {
  const raw = contract.testDiscovery;
  const configs = new Map();
  const subject = "coverage-map.testDiscovery";
  if (raw === undefined) return { configs, defects: [] };
  if (!isObject(raw)) {
    return {
      configs,
      defects: [
        defect(
          "discovery-invalid",
          `${subject} must be a JSON object keyed by runner`,
          subject
        ),
      ],
    };
  }
  const defects = [];
  for (const [runner, config] of Object.entries(raw)) {
    if (runner.startsWith("_")) continue;
    const problems = configProblems(runner, config, contract);
    for (const problem of problems) {
      defects.push(
        defect(
          "discovery-invalid",
          `${subject}.${runner} ${problem}`,
          `${subject}.${runner}`
        )
      );
    }
    if (problems.length === 0) configs.set(runner, config);
  }
  return { configs, defects };
}

/**
 * Every titled test call in a source file, with the title taken VERBATIM from
 * the source.
 *
 * A template-literal title is kept exactly as written — `${error.name}` and
 * all. Rewriting or truncating it is how the fork this replaces produced
 * evidence strings that matched nothing, which authors then had to paper over
 * with exclusions for artifacts of the parser rather than of the repo. The
 * verbatim text is a real substring of the file, so a mapping or exclusion
 * naming it stays falsifiable exactly like any other evidence string.
 * @param {string} source - File contents.
 * @param {readonly string[]} functions - Declared test-function names.
 * @returns {{evidence: string, dynamic: boolean}[]} Discovered titles in source order.
 */
function callTitles(source, functions) {
  const modifiers = TEST_DECLARATION_MODIFIERS.join("|");
  const pattern = new RegExp(
    String.raw`\b(?:${functions.join("|")})(?:\.(?:${modifiers}))*\s*\(\s*` +
      String.raw`(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|\x60([^\x60]*)\x60)`,
    "g"
  );
  const found = [];
  for (const match of withoutComments(source).matchAll(pattern)) {
    // Exactly one of the three quoting alternatives participates in any match,
    // so the others are genuinely `undefined` here. The tests are written by
    // TYPE rather than against `undefined`: the intent is "did this call carry
    // a usable title" and "did that title come from a template literal", and
    // stating it that way is both what the code means and unambiguous to a
    // static analyser reading the declared `string` element type.
    const template = match[3];
    const evidence = match[1] ?? match[2] ?? template;
    if (typeof evidence !== "string" || evidence.length === 0) continue;
    found.push({
      evidence,
      dynamic: typeof template === "string" && template.includes("${"),
    });
  }
  return found;
}

/**
 * The leading document field a flow-style runner titles a file with.
 *
 * When the field is absent the file itself is the discovered unit and carries
 * NO evidence — inventing a title from the filename would fabricate a string
 * that appears nowhere in the file, which is the opposite of falsifiable.
 * @param {string} source - File contents.
 * @param {string} field - Declared field name.
 * @returns {{evidence: string|null, dynamic: boolean}[]} Exactly one entry.
 */
function lineField(source, field) {
  const match = new RegExp(String.raw`^\s*${field}:\s*(\S.*?)\s*$`, "m").exec(
    source
  );
  return [{ evidence: match ? match[1] : null, dynamic: false }];
}

/**
 * Walk one runner's declared roots and extract its tests.
 * @param {object} input - Root, runner, its config, and the contract.
 * @returns {object[]} Discovered specs.
 */
function discoverRunner({ root, runner, config, contract }) {
  const platforms = [...(contract.runnerPlatforms?.[runner] ?? [])].sort(
    byCodeUnit
  );
  const ignore = config.ignore ?? [];
  const specs = [];
  for (const declaredRoot of config.roots) {
    for (const file of filesUnder(root, declaredRoot, config)) {
      const relative = posix(path.relative(root, file));
      if (ignore.some(prefix => isUnderPrefix(relative, prefix))) continue;
      const source = fs.readFileSync(file, "utf8");
      for (const found of extract(source, config.evidence)) {
        specs.push({ runner, platforms, file: relative, ...found });
      }
    }
  }
  return specs;
}

/**
 * Extract evidence from one file under the declared grammar.
 * @param {string} source - File contents.
 * @param {object} evidence - The declared evidence grammar.
 * @returns {{evidence: string|null, dynamic: boolean}[]} Discovered entries.
 */
function extract(source, evidence) {
  return evidence.kind === CALL_TITLE
    ? callTitles(source, evidence.functions)
    : lineField(source, evidence.field);
}

/**
 * List candidate files under one declared root.
 *
 * A root that does not exist yet is not an error — a project may declare where
 * its flows WILL live. A root that resolves outside the repo is refused, on
 * the same reasoning as a mapping path: repo data must never be able to read
 * the runner's filesystem.
 * @param {string} root - Repo root.
 * @param {string} declaredRoot - One declared root.
 * @param {object} config - The runner's discovery config.
 * @returns {string[]} Absolute paths.
 */
function filesUnder(root, declaredRoot, config) {
  const directory = path.join(root, declaredRoot);
  if (!fs.existsSync(directory)) return [];
  if (!resolveInsideRepo(root, declaredRoot).path) return [];
  return listFiles(directory, file =>
    config.extensions.some(extension => file.endsWith(extension))
  );
}

/**
 * Discover every test file the project's own configuration points at.
 * @param {object} input - Repo root and the parsed contract.
 * @returns {object} Specs, configured runners, declared roots, and refusals.
 */
export function discoverSpecs({ root, contract }) {
  const { configs, defects } = readDiscovery(contract);
  const specs = [];
  const roots = [];
  for (const [runner, config] of configs) {
    roots.push(...config.roots.map(canonicalPath));
    specs.push(...discoverRunner({ root, runner, config, contract }));
  }
  return {
    specs: specs.sort((a, b) =>
      `${a.file}${a.evidence ?? ""}`.localeCompare(
        `${b.file}${b.evidence ?? ""}`
      )
    ),
    runners: [...configs.keys()].sort(byCodeUnit),
    roots: [...new Set(roots)].sort(byCodeUnit),
    defects,
  };
}

/**
 * Whether one map entry accounts for one discovered spec.
 *
 * An entry accounts for a spec when it names the same file AND its evidence
 * string CONTAINS that spec's title. Containment in that direction is
 * deliberate: an author may map `test("title"` or the bare title, but one
 * short string can never come to account for every test in a file — which
 * would rebuild the fail-open this check exists to close. A file-level entry
 * (an exclusion with no evidence) accounts for the whole file, and so does any
 * entry naming a file whose discovered unit has no title of its own.
 * @param {object} entry - A mapping or exclusion.
 * @param {object} spec - A discovered spec.
 * @param {boolean} fileLevelAllowed - Whether a missing evidence string covers the file.
 * @returns {boolean} Whether the spec is accounted for.
 */
function accountsFor(entry, spec, fileLevelAllowed) {
  if (entry.file !== spec.file) return false;
  if (typeof entry.evidence !== "string" || entry.evidence.length === 0) {
    return fileLevelAllowed;
  }
  return spec.evidence === null || entry.evidence.includes(spec.evidence);
}

/**
 * Whether any mapping or exclusion discloses a discovered spec.
 * @param {object} spec - A discovered spec.
 * @param {object} contract - Parsed coverage map.
 * @returns {boolean} Whether it is disclosed.
 */
export function isDisclosed(spec, contract) {
  return (
    (contract.mappings ?? []).some(mapping =>
      accountsFor(mapping, spec, false)
    ) ||
    (contract.exclusions ?? []).some(exclusion =>
      accountsFor(exclusion, spec, true)
    )
  );
}

/**
 * Defects for every discovered spec the contract never mentions.
 * @param {readonly object[]} specs - Discovered specs.
 * @param {object} contract - Parsed coverage map.
 * @returns {object[]} Defects found.
 */
function undisclosedDefects(specs, contract) {
  return specs
    .filter(spec => !isDisclosed(spec, contract))
    .map(spec =>
      defect(
        "spec-undisclosed",
        `${spec.file}${spec.evidence === null ? "" : ` :: ${JSON.stringify(spec.evidence)}`} is discovered by runner ${spec.runner} but named by no mapping and no exclusion. Map it to a scenario, or record an exclusion with a reason.`,
        spec.file
      )
    );
}

/**
 * Defects for exclusions that no longer excuse anything.
 *
 * An exclusion is a standing claim that a real test aligns to no product
 * behavior. Once its file is gone, its title has been renamed, or no
 * configured root even covers it, the claim is about nothing — and a pile of
 * such claims is how "unmapped test" stops meaning anything.
 * @param {object} input - Root, contract, and the discovery result.
 * @returns {object[]} Defects found.
 */
function exclusionDefects({ root, contract, discovery }) {
  const defects = [];
  for (const [index, exclusion] of (contract.exclusions ?? []).entries()) {
    const at = `coverage-map.exclusions[${index}]`;
    const subject = typeof exclusion.file === "string" ? exclusion.file : at;
    defects.push(...exclusionMetadata(exclusion, at, subject));
    if (typeof exclusion.file !== "string" || exclusion.file.length === 0) {
      continue;
    }
    defects.push(
      ...exclusionStale({ root, exclusion, discovery, at, subject })
    );
  }
  return defects;
}

/**
 * The bookkeeping an exclusion owes whoever has to re-litigate it.
 * @param {object} exclusion - Raw exclusion entry.
 * @param {string} at - Location label.
 * @param {string} subject - Finding subject.
 * @returns {object[]} Defects found.
 */
function exclusionMetadata(exclusion, at, subject) {
  const defects = [];
  if (typeof exclusion.file !== "string" || exclusion.file.length === 0) {
    defects.push(defect("exclusion-metadata", `${at}: names no file`, subject));
  }
  if (typeof exclusion.reason !== "string" || exclusion.reason.trim() === "") {
    defects.push(
      defect(
        "exclusion-metadata",
        `${at}: has no reason; an exclusion with no stated reason is an undisclosed test with extra steps`,
        subject
      )
    );
  }
  return defects;
}

/**
 * The three ways an exclusion outlives what it excused.
 * @param {object} input - Root, the exclusion, discovery, and labels.
 * @returns {object[]} Defects found.
 */
function exclusionStale({ root, exclusion, discovery, at, subject }) {
  const resolved = resolveInsideRepo(root, exclusion.file);
  if (!resolved.path) {
    return [
      defect(
        EXCLUSION_STALE,
        `${at}: ${exclusion.file} — ${resolved.error}; retire the exclusion or restore the file`,
        subject
      ),
    ];
  }
  if (!discovery.roots.some(entry => isUnderPrefix(exclusion.file, entry))) {
    return [
      defect(
        EXCLUSION_STALE,
        `${at}: ${exclusion.file} is covered by no configured discovery root (${discovery.roots.map(entry => entry || ".").join(", ") || "none declared"}), so the exclusion suppresses nothing`,
        subject
      ),
    ];
  }
  return discovery.specs.some(spec => accountsFor(exclusion, spec, true))
    ? []
    : [
        defect(
          EXCLUSION_STALE,
          `${at}: no discovered test in ${exclusion.file} matches ${JSON.stringify(exclusion.evidence)}`,
          subject
        ),
      ];
}

/**
 * Every disclosure defect: undeclared specs and dead exclusions.
 * @param {object} input - Root, contract, and the discovery result.
 * @returns {object[]} Defects found.
 */
export function disclosureDefects({ root, contract, discovery }) {
  return [
    ...undisclosedDefects(discovery.specs, contract),
    ...exclusionDefects({ root, contract, discovery }),
  ];
}

/**
 * The runners that declared a platform but no way to find their tests.
 *
 * Reported only where absence must fail, exactly like a missing coverage
 * floor: a runner with no discovery block contributes nothing to the
 * inventory, and a silent zero there is indistinguishable from a clean repo.
 * @param {object} contract - Parsed coverage map.
 * @param {object} discovery - The discovery result.
 * @returns {object[]} Defects found.
 */
export function missingDiscoveryDefects(contract, discovery) {
  return Object.keys(contract.runnerPlatforms ?? {})
    .filter(runner => !runner.startsWith("_"))
    .filter(runner => !discovery.runners.includes(runner))
    .sort(byCodeUnit)
    .map(runner =>
      defect(
        "discovery-missing",
        `enforced mode: runner ${runner} declares platforms but testDiscovery says nothing about where its tests live, so no undeclared test of that runner can ever be found`,
        `coverage-map.testDiscovery.${runner}`
      )
    );
}
