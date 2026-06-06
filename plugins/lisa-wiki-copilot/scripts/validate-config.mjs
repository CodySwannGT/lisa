#!/usr/bin/env node
/**
 * validate-config.mjs — dependency-free validator for wiki/lisa-wiki.config.json.
 *
 * Enforces the constraints described in schema/lisa-wiki-config.schema.json without
 * requiring a JSON-Schema runtime, so it is portable to any downstream repo that
 * installs the lisa-wiki plugin (no ajv / node_modules assumptions).
 *
 * Usage: node validate-config.mjs [path-to-config]
 *   default path: wiki/lisa-wiki.config.json (relative to cwd)
 * Exit code 0 = valid, 1 = invalid or unreadable.
 */
import fs from "node:fs";
import path from "node:path";

const MODES = ["embedded", "wrapper", "standalone", "subdir"];
const SIDE_EFFECTS = ["read-only-ingest", "repo-write", "external-write"];
const RETENTION = [
  "raw-ok",
  "sanitized-note-only",
  "metadata-only",
  "external-pointer-only",
];
const SENSITIVITY = ["public", "internal", "confidential", "restricted"];
const REDACTION_ENTITIES = [
  "api_key",
  "bank_account",
  "credit_card",
  "oauth_token",
  "password",
  "private_key",
  "routing_number",
  "ssn",
];
const REDACTION_SCANNERS = ["builtin", "gitleaks", "presidio"];
const SOURCE_LAYOUT = ["by-system", "by-category"];
const README_MODE = ["rich", "stub", "preserve"];

const configPath = path.resolve(
  process.argv[2] ?? "wiki/lisa-wiki.config.json"
);
const errors = [];
const err = msg => errors.push(msg);

function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStringArray(v) {
  return Array.isArray(v) && v.every(x => typeof x === "string");
}
function checkEnum(value, allowed, label) {
  if (value !== undefined && !allowed.includes(value)) {
    err(`${label}: "${String(value)}" is not one of ${allowed.join(" | ")}`);
  }
}
function checkType(value, type, label) {
  if (value !== undefined && typeof value !== type) {
    err(
      `${label}: expected ${type}, got ${Array.isArray(value) ? "array" : typeof value}`
    );
  }
}

if (!fs.existsSync(configPath)) {
  console.error(`✗ config not found: ${configPath}`);
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch (e) {
  console.error(`✗ config is not valid JSON: ${e.message}`);
  process.exit(1);
}

if (!isObject(config)) {
  console.error("✗ config must be a JSON object");
  process.exit(1);
}

// Required
for (const key of ["schemaVersion", "org", "mode", "wikiRoot", "categories"]) {
  if (config[key] === undefined) err(`missing required field: ${key}`);
}
checkType(config.schemaVersion, "string", "schemaVersion");
checkType(config.org, "string", "org");
checkType(config.displayName, "string", "displayName");
checkType(config.purpose, "string", "purpose");
checkEnum(config.mode, MODES, "mode");
checkType(config.wikiRoot, "string", "wikiRoot");
if (
  typeof config.wikiRoot === "string" &&
  (path.isAbsolute(config.wikiRoot) ||
    config.wikiRoot.split(/[\\/]/).includes(".."))
) {
  err(
    'wikiRoot: must be a relative path inside the repo (no absolute paths, no ".." traversal)'
  );
}
checkType(config.frontmatter, "boolean", "frontmatter");
if (
  config.categories !== undefined &&
  !(isStringArray(config.categories) && config.categories.length > 0)
) {
  err("categories: must be a non-empty array of strings");
}
checkEnum(config.sourceRetention, RETENTION, "sourceRetention");
checkType(config.contaminationTerms, "object", "contaminationTerms");
if (
  config.contaminationTerms !== undefined &&
  !isStringArray(config.contaminationTerms)
) {
  err("contaminationTerms: must be an array of strings");
}

if (config.sources !== undefined) {
  if (!isObject(config.sources)) err("sources: must be an object");
  else checkEnum(config.sources.layout, SOURCE_LAYOUT, "sources.layout");
}
if (config.git !== undefined) {
  if (!isObject(config.git)) err("git: must be an object");
  else {
    checkType(config.git.prPerIngestion, "boolean", "git.prPerIngestion");
    checkType(config.git.autoMerge, "boolean", "git.autoMerge");
    checkType(config.git.targetBranch, "string", "git.targetBranch");
    checkType(config.git.branchPrefix, "string", "git.branchPrefix");
  }
}
if (config.readme !== undefined) {
  if (!isObject(config.readme)) err("readme: must be an object");
  else checkEnum(config.readme.mode, README_MODE, "readme.mode");
}
if (config.sensitivity !== undefined) {
  if (!isObject(config.sensitivity)) err("sensitivity: must be an object");
  else {
    checkType(config.sensitivity.enabled, "boolean", "sensitivity.enabled");
    checkEnum(config.sensitivity.default, SENSITIVITY, "sensitivity.default");
    if (config.sensitivity.redaction !== undefined) {
      if (!isObject(config.sensitivity.redaction)) {
        err("sensitivity.redaction: must be an object");
      } else {
        const redaction = config.sensitivity.redaction;
        checkType(
          redaction.enabled,
          "boolean",
          "sensitivity.redaction.enabled"
        );
        checkType(
          redaction.failClosed,
          "boolean",
          "sensitivity.redaction.failClosed"
        );
        checkType(
          redaction.requireReview,
          "boolean",
          "sensitivity.redaction.requireReview"
        );
        if (
          redaction.scanners !== undefined &&
          !(isStringArray(redaction.scanners) && redaction.scanners.length > 0)
        ) {
          err(
            "sensitivity.redaction.scanners: must be a non-empty array of strings"
          );
        }
        for (const scanner of redaction.scanners ?? []) {
          checkEnum(
            scanner,
            REDACTION_SCANNERS,
            "sensitivity.redaction.scanners[]"
          );
        }
        for (const key of ["allowedEntities", "blockedEntities"]) {
          if (redaction[key] !== undefined && !isStringArray(redaction[key])) {
            err(`sensitivity.redaction.${key}: must be an array of strings`);
          }
          for (const entity of redaction[key] ?? []) {
            checkEnum(
              entity,
              REDACTION_ENTITIES,
              `sensitivity.redaction.${key}[]`
            );
          }
        }
      }
    }
  }
}
if (config.documentation !== undefined) {
  if (!isObject(config.documentation)) err("documentation: must be an object");
  else {
    checkType(config.documentation.absorb, "boolean", "documentation.absorb");
    if (
      config.documentation.keepInPlace !== undefined &&
      !isStringArray(config.documentation.keepInPlace)
    ) {
      err("documentation.keepInPlace: must be an array of strings");
    }
  }
}
if (config.onboarding !== undefined) {
  if (!isObject(config.onboarding)) err("onboarding: must be an object");
  else
    checkType(
      config.onboarding.allowAudienceNote,
      "boolean",
      "onboarding.allowAudienceNote"
    );
}

if (config.connectors !== undefined) {
  if (!isObject(config.connectors))
    err("connectors: must be an object (name -> connector config)");
  else {
    for (const [name, c] of Object.entries(config.connectors)) {
      if (!isObject(c)) {
        err(`connectors.${name}: must be an object`);
        continue;
      }
      checkType(c.enabled, "boolean", `connectors.${name}.enabled`);
      if (c.sideEffects === undefined) {
        err(
          `connectors.${name}: missing required field "sideEffects" (every connector must declare its side-effect class so full ingest can skip external-write)`
        );
      } else {
        checkEnum(
          c.sideEffects,
          SIDE_EFFECTS,
          `connectors.${name}.sideEffects`
        );
      }
    }
  }
}

if (config.customConnectors !== undefined) {
  if (!Array.isArray(config.customConnectors))
    err("customConnectors: must be an array");
  else {
    config.customConnectors.forEach((c, i) => {
      if (!isObject(c)) {
        err(`customConnectors[${i}]: must be an object`);
        return;
      }
      for (const k of ["name", "skill", "sourceSystem", "sideEffects"]) {
        if (c[k] === undefined)
          err(`customConnectors[${i}]: missing required field "${k}"`);
      }
      checkEnum(
        c.sideEffects,
        SIDE_EFFECTS,
        `customConnectors[${i}].sideEffects`
      );
    });
  }
}

if (config.staff !== undefined) {
  if (!Array.isArray(config.staff)) err("staff: must be an array");
  else {
    config.staff.forEach((s, i) => {
      if (!isObject(s)) {
        err(`staff[${i}]: must be an object`);
        return;
      }
      for (const k of ["id", "role"]) {
        if (s[k] === undefined)
          err(`staff[${i}]: missing required field "${k}"`);
      }
      checkEnum(s.sensitivity, SENSITIVITY, `staff[${i}].sensitivity`);
      if (s.owns !== undefined) {
        if (!isObject(s.owns)) err(`staff[${i}].owns: must be an object`);
        else {
          for (const ok of ["categories", "connectors", "skills"]) {
            if (s.owns[ok] !== undefined && !isStringArray(s.owns[ok])) {
              err(`staff[${i}].owns.${ok}: must be an array of strings`);
            }
          }
        }
      }
    });
  }
}

if (errors.length > 0) {
  console.error(`✗ ${path.relative(process.cwd(), configPath)} is invalid:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`✓ ${path.relative(process.cwd(), configPath)} is valid.`);
