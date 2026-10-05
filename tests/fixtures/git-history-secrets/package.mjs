/**
 * @file package.mjs
 * @description Emit shared core source without claiming package or Rails adoption.
 * @module history-secrets-fixtures
 */
import { mkdirSync, cpSync } from "node:fs";
import { join } from "node:path";
export const emitArtifacts = harness => {
  if (harness.archive)
    throw new Error(
      "Immutable package apply/reapply qualification requires the managed route and a released package; this journey qualifies shared core source only."
    );
  if (harness.args.includes("--lefthook"))
    throw new Error(
      "Generated Rails hook qualification requires the managed route; this journey qualifies shared core source only."
    );
  mkdirSync(harness.emitted, { mode: 0o700 });
  cpSync(
    join(harness.upstream, "all/copy-overwrite/scripts"),
    join(harness.emitted, "scripts"),
    { recursive: true }
  );
};
