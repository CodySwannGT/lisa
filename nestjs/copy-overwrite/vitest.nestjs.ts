/**
 * This file is managed by Lisa and IS replaced on each `lisa` run.
 * Do not edit directly — durable changes belong upstream in Lisa.
 */

/**
 * Vitest Configuration - NestJS Stack
 *
 * Re-exports NestJS-specific Vitest configuration from @codyswann/lisa.
 * This file exists as a local sibling for projects that import stack
 * config from a relative path.
 *
 * @see https://vitest.dev/config/
 * @module vitest.nestjs
 */
export {
  defaultCoverageExclusions,
  defaultThresholds,
  getNestjsVitestConfig,
  mapThresholds,
  mergeThresholds,
  mergeVitestConfigs,
} from "@codyswann/lisa/vitest/nestjs";

export type { PortableThresholds } from "@codyswann/lisa/vitest/nestjs";
