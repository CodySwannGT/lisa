// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Compatibility exports retain bounded IO and native npm/owner APIs through one-way implementation dependencies. */
export {
  candidateEnvironment,
  withPrivateRoot,
  readBytes,
  readJson,
  writeJson,
  replaceJson,
  phaseDirectory,
  runProcess,
} from "./npm-update-process-core.mjs";
export { runNpm, effectiveEngineStrict } from "./npm-update-npm.mjs";
export { releasedLisaIdentity } from "./npm-update-owner.mjs";
