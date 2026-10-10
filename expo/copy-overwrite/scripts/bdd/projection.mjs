// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Shared canonical writers emit one complete, feature-local projection set. */
import { buildFeatureModels } from "./projection-model.mjs";
import {
  STATIC_ARTIFACTS,
  renderFeatureArtifacts,
} from "./projection-render.mjs";
import { validateProjectionTargets } from "./projection-paths.mjs";
import { writeProjectionArtifacts } from "./projection-write.mjs";

export { FEATURE_PROJECTION_SCHEMA } from "./projection-paths.mjs";
export { PROJECTION_INDEX_SCHEMA } from "./projection-render.mjs";

/** Reads actual evidence; building the artifact map itself never writes files. */
export function buildFeatureArtifacts(root, inputs) {
  const artifacts = new Map(STATIC_ARTIFACTS);
  for (const model of buildFeatureModels(root, inputs)) {
    for (const [relative, body] of renderFeatureArtifacts(model))
      artifacts.set(relative, body);
  }
  validateProjectionTargets(artifacts.keys());
  return artifacts;
}

/** Preflight every desired/obsolete path, then write changed canonical bytes. */
export function writeFeatureArtifacts(root, inputs) {
  return writeProjectionArtifacts(root, buildFeatureArtifacts(root, inputs));
}
