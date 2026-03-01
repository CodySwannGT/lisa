/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint 9 Flat Config - Slow Rules Only (CDK)
 *
 * Thin wrapper around @codyswann/lisa slow eslint config factory.
 * Run periodically via `lint:slow` rather than on every lint pass.
 *
 * @see https://github.com/import-js/eslint-plugin-import
 * @module eslint.slow.config
 */
import { createRequire } from "module";

import { getSlowConfig } from "@codyswann/lisa/eslint/slow";

const require = createRequire(import.meta.url);
const ignoreConfig = require("./eslint.ignore.config.json");

export default getSlowConfig({ ignorePatterns: ignoreConfig.ignores || [] });
