/**
 * This file is managed by Lisa and IS replaced on each `lisa` run.
 * Do not edit directly — durable changes belong upstream in Lisa.
 */

/**
 * Vitest Configuration - CDK Stack
 *
 * Re-exports CDK-specific Vitest configuration from @codyswann/lisa.
 * This file exists as a local sibling for projects that import stack
 * config from a relative path.
 *
 * @see https://vitest.dev/config/
 * @module vitest.cdk
 */
export {
  defaultCoverageExclusions,
  defaultThresholds,
  getCdkVitestConfig,
  mapThresholds,
  mergeThresholds,
  mergeVitestConfigs,
} from "@codyswann/lisa/vitest/cdk";

export type { PortableThresholds } from "@codyswann/lisa/vitest/cdk";
