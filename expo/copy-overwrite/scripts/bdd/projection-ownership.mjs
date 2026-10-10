// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Refuse ambiguous ownership before writing or removing any generated leaf. */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  FEATURE_PROJECTION_SCHEMA,
  PROJECTION_GENERATOR,
  PROJECTION_DIRECTORIES,
  featureArtifactPaths,
  inspectProjectionPath,
  listProjectionPaths,
  projectionStat,
  refuseProjection,
  validateProjectionCollisions,
} from "./projection-paths.mjs";
import {
  STATIC_ARTIFACTS,
  MATRIX_COMMAND,
  COVERAGE_COMMAND,
  PROJECTION_INDEX_SCHEMA,
  REPORT_COMMAND,
  AGGREGATE_MATRIX_COMMAND,
} from "./projection-render.mjs";

/** Unknown JSON is preserved; desired occupation is rejected separately. */
function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** Structural checks identify the versioned complete-local format. */
function validScenario(row) {
  const arrays = [
    "tags",
    "ownTags",
    "inheritedTags",
    "featureIdTags",
    "platforms",
    "lifecycle",
    "provenance",
    "trackers",
    "primarySteps",
    "mappings",
    "obligations",
    "waivers",
    "retirements",
  ];
  if (
    !row ||
    typeof row !== "object" ||
    !arrays.every(key => Array.isArray(row[key]))
  )
    return false;
  if (
    typeof row.name !== "string" ||
    typeof row.feature !== "string" ||
    typeof row.required !== "boolean"
  )
    return false;
  if (!Number.isInteger(row.line) || !Number.isInteger(row.featureLine))
    return false;
  return (
    row.mappings.every(
      mapping =>
        mapping?.evidenceResolution &&
        typeof mapping.evidenceResolution.ok === "boolean" &&
        typeof mapping.execution?.supplied === "boolean" &&
        Array.isArray(mapping.platforms)
    ) &&
    row.obligations.every(
      value =>
        typeof value?.platform === "string" &&
        [value.covered, value.waived, value.gap].every(
          flag => typeof flag === "boolean"
        )
    )
  );
}

/** A claimed schema is never treated as anonymous handwritten content. */
function jsonOwnership(relative, body) {
  const value = parseJson(body);
  const claimed =
    value?.generator === PROJECTION_GENERATOR ||
    String(value?.schemaVersion ?? "").startsWith(
      "lisa-bdd-feature-projection-"
    );
  if (!claimed) return false;
  if (
    value.schemaVersion !== FEATURE_PROJECTION_SCHEMA ||
    value.generator !== PROJECTION_GENERATOR ||
    !Array.isArray(value.scenarios) ||
    !value.scenarios.every(validScenario)
  ) {
    refuseProjection(`unknown or malformed owned JSON schema: ${relative}`);
  }
  if (featureArtifactPaths(value.sourceFile)[0] !== relative) {
    refuseProjection(`JSON ownership/source path mismatch: ${relative}`);
  }
  return true;
}

/** Markdown markers encode their source and distinguish the two document kinds. */
function markdownOwnership(relative, body) {
  if (!body.startsWith("<!-- lisa-bdd-feature-projection-")) return false;
  const marker =
    /^<!-- (lisa-bdd-feature-projection-[^\s]+) (\S+) source=([^\s]+) -->\n/.exec(
      body
    );
  if (
    !marker ||
    marker[1] !== FEATURE_PROJECTION_SCHEMA ||
    !["matrix", "coverage"].includes(marker[2])
  ) {
    refuseProjection(`unknown or malformed owned Markdown schema: ${relative}`);
  }
  let source;
  try {
    source = decodeURIComponent(marker[3]);
  } catch {
    refuseProjection(`invalid Markdown source encoding: ${relative}`);
  }
  const index = marker[2] === "matrix" ? 1 : 2;
  const title =
    index === 1
      ? "# BDD scenario traceability matrix\n"
      : "# BDD behavior contract — feature coverage burndown\n";
  if (
    featureArtifactPaths(source)[index] !== relative ||
    !body.slice(marker[0].length).startsWith(title)
  ) {
    refuseProjection(`Markdown ownership/source path mismatch: ${relative}`);
  }
  return true;
}

/** Only explicit versioned leaves qualify for obsolete cleanup. */
export function ownedFeatureLeaf(relative, body) {
  return relative.endsWith(".json")
    ? jsonOwnership(relative, body)
    : markdownOwnership(relative, body);
}

/** Recognize the previous aggregate format, never arbitrary JSON at its path. */
function legacyJson(body) {
  const value = parseJson(body);
  const objects = [
    "scenarios",
    "traceability",
    "execution",
    "testInventory",
    "waived",
    "floor",
    "trackers",
  ];
  return (
    value?.schemaVersion === 3 &&
    objects.every(
      key =>
        value[key] &&
        typeof value[key] === "object" &&
        !Array.isArray(value[key])
    ) &&
    Array.isArray(value.gaps)
  );
}

/** Migration is limited to canonical old headings, commands and content signatures. */
function legacyEntrypoint(relative, body) {
  if (relative === "bdd/coverage-report.json") return legacyJson(body);
  if (relative === "docs/bdd-scenario-matrix.md") {
    return (
      body.startsWith("# BDD scenario traceability matrix\n") &&
      body.includes(`Generated by \`${MATRIX_COMMAND}\`; never hand-edited.`) &&
      body.includes("scenarios declared")
    );
  }
  return (
    body.startsWith("# BDD behavior contract — coverage burndown\n") &&
    body.includes(
      "Generated from `bdd/features/*.feature` and `bdd/coverage-map.json`"
    ) &&
    body.includes(
      `Regenerated by \`${COVERAGE_COMMAND}\`; never hand-edited.`
    ) &&
    body.includes("## What each number means\n")
  );
}

/** Known index versions remain refreshable when generated guidance changes. */
function ownedEntrypoint(relative, body) {
  if (relative === "bdd/coverage-report.json") {
    const value = parseJson(body);
    return (
      value?.schemaVersion === PROJECTION_INDEX_SCHEMA &&
      value.generator === PROJECTION_GENERATOR &&
      value.featureReports === "bdd/reports/v1/features/" &&
      value.scenarioMatrices === "docs/bdd-scenario-matrix/" &&
      value.coverageDocuments === "docs/e2e-bdd-coverage/" &&
      value.sourceIdentity ===
        "Full repository-relative bdd/features/*.feature path" &&
      value.commands?.matrix === MATRIX_COMMAND &&
      value.commands?.coverage === COVERAGE_COMMAND &&
      value.aggregateCommands?.matrix === AGGREGATE_MATRIX_COMMAND &&
      value.aggregateCommands?.coverage === REPORT_COMMAND &&
      typeof value.aggregate === "string"
    );
  }
  const matrix = relative === "docs/bdd-scenario-matrix.md";
  const title = matrix
    ? "# BDD scenario traceability matrix\n"
    : "# BDD behavior contract — coverage burndown\n";
  const command = matrix
    ? `Generated by \`${MATRIX_COMMAND}\`; never hand-edited.`
    : `Regenerated by \`${COVERAGE_COMMAND}\`; never hand-edited.`;
  return (
    body.startsWith(title) &&
    body.includes(command) &&
    body.includes("../bdd/reports/v1/features/") &&
    body.includes(
      matrix
        ? "[bdd-scenario-matrix/](bdd-scenario-matrix/)"
        : "[e2e-bdd-coverage/](e2e-bdd-coverage/)"
    ) &&
    body.includes(
      "This entrypoint intentionally stores no feature list or global counts."
    )
  );
}

/** Existing case/NFC aliases in ancestors are unsafe even on a permissive disk. */
function inspectAliases(root, relative) {
  let directory = root;
  for (const component of relative.split("/")) {
    if (!projectionStat(directory)) return;
    const key = component.normalize("NFC").toLowerCase();
    const alias = fs
      .readdirSync(directory)
      .find(
        name =>
          name !== component && name.normalize("NFC").toLowerCase() === key
      );
    if (alias !== undefined)
      refuseProjection(`case/NFC path collision: ${relative} aliases ${alias}`);
    directory = path.join(directory, component);
  }
}

/** Validate existing bytes without mutating desired targets or unknown neighbors. */
export function validateProjectionTarget(root, relative, desired) {
  if (!inspectProjectionPath(root, relative)) return null;
  const body = fs.readFileSync(path.join(root, relative), "utf8");
  if (STATIC_ARTIFACTS.has(relative)) {
    if (
      body !== desired &&
      !legacyEntrypoint(relative, body) &&
      !ownedEntrypoint(relative, body)
    ) {
      refuseProjection(
        `unowned static entrypoint or unsupported schema: ${relative}`
      );
    }
  } else if (!ownedFeatureLeaf(relative, body)) {
    refuseProjection(`unowned content occupies generated path: ${relative}`);
  }
  return body;
}

/** Full safety/ownership inventory precedes all directory and file mutation. */
export function prepareProjectionWrite(root, artifacts) {
  const candidates = PROJECTION_DIRECTORIES.flatMap(directory =>
    listProjectionPaths(root, directory)
  );
  const allPaths = [...artifacts.keys(), ...candidates];
  validateProjectionCollisions(allPaths);
  for (const relative of artifacts.keys()) {
    inspectProjectionPath(root, relative);
    inspectAliases(root, relative);
  }
  const obsolete = [];
  for (const relative of candidates) {
    if (!projectionStat(path.join(root, relative)).isFile()) continue;
    const body = fs.readFileSync(path.join(root, relative), "utf8");
    const owned = ownedFeatureLeaf(relative, body);
    if (owned && !artifacts.has(relative)) obsolete.push({ relative, body });
  }
  const changed = [];
  for (const [relative, body] of artifacts) {
    const previous = validateProjectionTarget(root, relative, body);
    if (previous !== body) changed.push({ relative, body, previous });
  }
  return { changed, obsolete };
}
