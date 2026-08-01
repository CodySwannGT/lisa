#!/usr/bin/env node
/**
 * Write the provider's current view to the two files a materializing surface
 * reads.
 *
 * Only surfaces that cannot read through live use this. A remote agent
 * container prepares itself during setup — before any task exists, and often
 * before network policy would permit a provider call from the task itself — so
 * files written at that moment are the only channel available. Everywhere else
 * this is forbidden, because a value on disk is a copy that can drift and leak.
 *
 * Both files are written atomically from one provider response, so values and
 * notes always describe the same revision. A rename within the destination
 * directory is atomic on the same filesystem; a temporary file elsewhere would
 * not be.
 *
 * Usage:
 *   materialize-secrets.mjs [--dry-run]
 * @module materialize-secrets
 */

import {
  chmodSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { renderEnv, renderNotes } from "./envfile.mjs";
import { fetchAll } from "./providers.mjs";
import { materializedPaths, readConfig } from "./surfaces.mjs";

/**
 * Write one file to a temporary sibling, then move it into place.
 *
 * The mode is set before the rename so the file is never briefly readable by
 * anyone else, and the temporary sibling is removed on any failure so a partial
 * write cannot be mistaken for a complete one.
 * @param {string} destination Final path.
 * @param {string} contents File body.
 */
function writeAtomic(destination, contents) {
  const temporary = `${destination}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, destination);
  } catch (err) {
    rmSync(temporary, { force: true });
    throw err;
  }
}

/**
 * Materialize the configured provider view for the current surface.
 * @param {object} [cfg] Resolved configuration.
 * @returns {{count: number, dir: string}} What was written, and where.
 */
export function materialize(cfg = readConfig()) {
  if (!cfg.capabilities.mayWriteValues) {
    throw new Error(
      `surface "${cfg.surface}" may not write secret values to disk.\n` +
        `It can read through to the provider, so a copy on disk would add drift ` +
        `and exposure without adding capability.`
    );
  }

  const selected = fetchAll(cfg);
  if (!selected.size) {
    throw new Error(
      "no exportable secrets matched the configured boundary.\n" +
        "Check the machine account's project grants and any narrowing filters."
    );
  }

  const { dir, valuesFile, notesFile } = materializedPaths(cfg.namespace);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  writeAtomic(valuesFile, renderEnv(selected));
  writeAtomic(notesFile, renderNotes(selected));
  return { count: selected.size, dir };
}

function main() {
  const cfg = readConfig();
  if (process.argv.includes("--dry-run")) {
    const selected = fetchAll(cfg);
    const { dir } = materializedPaths(cfg.namespace);
    console.log(`would write ${selected.size} secret(s) to ${dir}`);
    console.log([...selected.keys()].sort().join("\n"));
    return;
  }
  const { count, dir } = materialize(cfg);
  console.log(`materialized ${count} secret(s) and their notes into ${dir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
