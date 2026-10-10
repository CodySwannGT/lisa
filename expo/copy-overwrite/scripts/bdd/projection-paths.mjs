// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Portable identities and filesystem boundaries for committed BDD leaves. */
import * as fs from "node:fs";
import * as path from "node:path";
import { byCodeUnit } from "./contract.mjs";

export const FEATURE_PROJECTION_SCHEMA = "lisa-bdd-feature-projection-v1";
export const PROJECTION_GENERATOR = "lisa-bdd-feature-projection";
export const PROJECTION_DIRECTORIES = Object.freeze([
  "bdd/reports/v1/features",
  "docs/bdd-scenario-matrix",
  "docs/e2e-bdd-coverage",
]);

/** Refuse an unsafe or ambiguous plan with an operator-readable diagnosis. */
export function refuseProjection(message) {
  throw new Error(`BDD projection: ${message}`);
}

/** Validate untrusted relative paths before normalization can hide traversal. */
export function relativeProjectionPath(value) {
  if (typeof value !== "string" || value.length === 0) {
    refuseProjection("path is missing");
  }
  if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    refuseProjection(`path must be repository-relative: ${value}`);
  }
  if (/[/\\]$|\\|[\u0000-\u001f\u007f]/.test(value)) {
    refuseProjection(`unsafe path spelling: ${value}`);
  }
  const parts = value.split("/");
  if (parts.some(part => !part || part === "." || part === "..")) {
    refuseProjection(`path contains empty or traversal components: ${value}`);
  }
  return value.normalize("NFC");
}

/** Full source identity, independent of its display Feature title. */
export function projectionSourceFile(value) {
  const normalized = relativeProjectionPath(value);
  if (
    !normalized.startsWith("bdd/features/") ||
    !normalized.endsWith(".feature")
  ) {
    refuseProjection(`source must be a bdd/features .feature path: ${value}`);
  }
  return normalized;
}

/** Retain the complete repository-relative source path in every suffix. */
export function featureArtifactPaths(sourceFile) {
  const source = projectionSourceFile(sourceFile);
  return PROJECTION_DIRECTORIES.map(
    (directory, index) =>
      `${directory}/${source}.${index === 0 ? "json" : "md"}`
  );
}

/** Refuse both leaf and ancestor case/NFC aliases before any mutation. */
export function validateProjectionCollisions(paths) {
  const spellings = new Map();
  for (const value of paths) {
    relativeProjectionPath(value);
    const components = value.split("/");
    for (let count = 1; count <= components.length; count += 1) {
      const prefix = components.slice(0, count).join("/");
      const key = prefix.normalize("NFC").toLowerCase();
      const previous = spellings.get(key);
      if (previous !== undefined && previous !== prefix) {
        refuseProjection(`case/NFC path collision: ${previous} and ${prefix}`);
      }
      spellings.set(key, prefix);
    }
  }
}

/** A planned file may not also be an ancestor directory of another file. */
export function validateProjectionTargets(paths) {
  const targets = new Set(paths);
  validateProjectionCollisions(targets);
  for (const relative of targets) {
    const parts = relative.split("/");
    for (let count = 1; count < parts.length; count += 1) {
      const ancestor = parts.slice(0, count).join("/");
      if (targets.has(ancestor)) {
        refuseProjection(
          `planned file/directory collision: ${ancestor} and ${relative}`
        );
      }
    }
  }
}

/** lstat without following a final symlink, including dangling ones. */
export function projectionStat(absolute) {
  try {
    return fs.lstatSync(absolute);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Validate every existing ancestor and target, refusing any symlink. */
export function inspectProjectionPath(root, relative, kind = "file") {
  relativeProjectionPath(relative);
  const parts = relative.split("/");
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const stat = projectionStat(current);
    if (!stat) return null;
    if (stat.isSymbolicLink()) refuseProjection(`symlink refused: ${relative}`);
    const directory = index < parts.length - 1 || kind === "directory";
    if (directory ? !stat.isDirectory() : !stat.isFile()) {
      refuseProjection(`file/directory or special-file collision: ${relative}`);
    }
  }
  return projectionStat(current);
}

/** List regular leaf candidates without following generated-directory links. */
export function listProjectionPaths(root, directory) {
  if (!inspectProjectionPath(root, directory, "directory")) return [];
  const result = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(path.join(root, current), {
      withFileTypes: true,
    })) {
      const relative = `${current}/${entry.name}`;
      result.push(relative);
      if (entry.isDirectory()) {
        inspectProjectionPath(root, relative, "directory");
        pending.push(relative);
      } else {
        inspectProjectionPath(root, relative);
      }
    }
  }
  return result.sort(byCodeUnit);
}

/** Preserve raw disk spelling while selecting regular ownership candidates. */
export function listProjectionFiles(root, directory) {
  return listProjectionPaths(root, directory).filter(relative =>
    projectionStat(path.join(root, relative)).isFile()
  );
}
