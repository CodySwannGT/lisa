/**
 * Jest Configuration - Project-Local Customizations
 *
 * Add project-specific Jest settings here. This file is create-only,
 * meaning Lisa will create it but never overwrite your customizations.
 *
 * Example:
 * ```ts
 * import type { Config } from "jest";
 *
 * const config: Config = {
 *   moduleNameMapper: {
 *     "^@/(.*)$": "<rootDir>/src/$1",
 *   },
 *   setupFiles: ["<rootDir>/jest.setup.ts"],
 * };
 *
 * export default config;
 * ```
 *
 * @see https://jestjs.io/docs/configuration
 * @module jest.config.local
 */
import type { Config } from "jest";

const config: Config = {
  // Add project-specific settings here
};

export default config;
