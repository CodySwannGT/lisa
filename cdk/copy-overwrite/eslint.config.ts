/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint 9 Flat Config - Main Entry Point (CDK)
 *
 * Thin wrapper around @codyswann/lisa eslint config factory.
 * Customize via eslint.config.local.ts and eslint.thresholds.json.
 *
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module eslint.config
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

import {
  defaultIgnores,
  defaultThresholds,
  getCdkConfig,
} from "@codyswann/lisa/eslint/cdk";

import localConfig from "./eslint.config.local";

const require = createRequire(import.meta.url);
const ignoreConfig = require("./eslint.ignore.config.json");
const thresholdsConfig = require("./eslint.thresholds.json");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default [
  ...getCdkConfig({
    tsconfigRootDir: __dirname,
    ignorePatterns: ignoreConfig.ignores || defaultIgnores,
    thresholds: { ...defaultThresholds, ...thresholdsConfig },
  }),
  ...localConfig,
];
