/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint 9 Flat Config - Slow Rules Only
 *
 * Thin wrapper around @codyswann/lisa slow eslint config factory.
 * Run periodically via `lint:slow` rather than on every lint pass.
 * @see https://github.com/import-js/eslint-plugin-import
 * @module eslint.slow.config
 */
import { getSlowConfig } from "@codyswann/lisa/eslint/slow";
import ignoreConfig from "./eslint.ignore.config.json" with { type: "json" };

export default getSlowConfig({ ignorePatterns: ignoreConfig.ignores || [] });
