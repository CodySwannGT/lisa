// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Apply a preflighted ownership plan with no recursive deletions. */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import {
  inspectProjectionPath,
  refuseProjection,
} from "./projection-paths.mjs";
import {
  ownedFeatureLeaf,
  prepareProjectionWrite,
  validateProjectionTarget,
} from "./projection-ownership.mjs";

/** Create each missing parent only after the complete plan has passed. */
function ensureParents(root, relative) {
  const parts = relative.split("/").slice(0, -1);
  for (let count = 1; count <= parts.length; count += 1) {
    const directory = parts.slice(0, count).join("/");
    if (!inspectProjectionPath(root, directory, "directory")) {
      fs.mkdirSync(path.join(root, directory));
    }
  }
}

/** Refuse changed ownership before replacing an individually prepared target. */
function checkUnchanged(root, entry) {
  const previous = validateProjectionTarget(root, entry.relative, entry.body);
  if (previous !== entry.previous)
    refuseProjection(`target changed after preflight: ${entry.relative}`);
}

/** Exclusive same-directory temporaries avoid following or replacing foreign files. */
function replaceLeaf(root, entry) {
  ensureParents(root, entry.relative);
  checkUnchanged(root, entry);
  const absolute = path.join(root, entry.relative);
  const temporary = `${absolute}.lisa-bdd-${randomBytes(12).toString("hex")}.tmp`;
  let created = false;
  try {
    fs.writeFileSync(temporary, entry.body, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    created = true;
    checkUnchanged(root, entry);
    fs.renameSync(temporary, absolute);
    created = false;
  } finally {
    if (created) fs.unlinkSync(temporary);
  }
}

/** Recheck the exact owned bytes before removing one obsolete regular leaf. */
function removeObsolete(root, entry) {
  if (!inspectProjectionPath(root, entry.relative)) {
    refuseProjection(
      `obsolete leaf changed after preflight: ${entry.relative}`
    );
  }
  const absolute = path.join(root, entry.relative);
  const body = fs.readFileSync(absolute, "utf8");
  if (body !== entry.body || !ownedFeatureLeaf(entry.relative, body)) {
    refuseProjection(
      `obsolete ownership changed after preflight: ${entry.relative}`
    );
  }
  fs.unlinkSync(absolute);
}

/** Return actual writes; a byte-identical repeat returns zero and touches nothing. */
export function writeProjectionArtifacts(root, artifacts) {
  const canonicalRoot = fs.realpathSync(root);
  if (!fs.statSync(canonicalRoot).isDirectory())
    refuseProjection("repository root is not a directory");
  const plan = prepareProjectionWrite(canonicalRoot, artifacts);
  for (const entry of plan.changed) replaceLeaf(canonicalRoot, entry);
  for (const entry of plan.obsolete) removeObsolete(canonicalRoot, entry);
  return plan.changed.length;
}
