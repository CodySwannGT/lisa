/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint 9 Flat Config
 *
 * Thin wrapper around @codyswann/lisa Phaser config factory.
 * Customize via eslint.config.local.ts and eslint.thresholds.json.
 *
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module eslint.config
 */
import path from "path";
import { fileURLToPath } from "url";

import {
  defaultPhaserIgnores,
  defaultThresholds,
  getPhaserConfig,
} from "@codyswann/lisa/eslint/phaser";

import ignoreConfig from "./eslint.ignore.config.json" with { type: "json" };
import thresholdsConfig from "./eslint.thresholds.json" with { type: "json" };
import localConfig from "./eslint.config.local";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default [
  ...getPhaserConfig({
    tsconfigRootDir: __dirname,
    ignorePatterns: [...defaultPhaserIgnores, ...(ignoreConfig.ignores || [])],
    thresholds: { ...defaultThresholds, ...thresholdsConfig },
  }),
  ...localConfig,
];
