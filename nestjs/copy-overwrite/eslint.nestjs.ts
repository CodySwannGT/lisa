/**
 * This file is managed by Lisa and IS replaced on each `lisa` run.
 * Do not edit directly — durable changes belong upstream in Lisa.
 */

/**
 * ESLint 9 Flat Config - NestJS Stack
 *
 * Re-exports the NestJS ESLint configuration from @codyswann/lisa. This file
 * exists as a local sibling for projects that import stack config from a
 * relative path. It used to carry its own copy of the configuration built on
 * a local ./eslint.typescript, which Lisa deletes from every project, so it
 * could not compile; the published factory is the one eslint.config.ts uses.
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module eslint.nestjs
 */
export {
  defaultIgnores,
  defaultThresholds,
  getBaseConfigs,
  getBaseLanguageOptions,
  getNestjsConfig,
  getSharedRules,
} from "@codyswann/lisa/eslint/nestjs";
