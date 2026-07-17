/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint 9 Flat Config
 *
 * Thin wrapper around @codyswann/lisa Harper/Fabric config factory.
 * Customize via eslint.config.local.ts, eslint.thresholds.json, and the
 * optional (create-only) eslint.ignore.config.local.json — its `ignores` are
 * merged into the ignore list so host customizations survive the
 * copy-overwrite of eslint.ignore.config.json on each Lisa update.
 *
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module eslint.config
 */
import { existsSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

import {
  defaultHarperFabricIgnores,
  defaultThresholds,
  getHarperFabricConfig,
} from "@codyswann/lisa/eslint/harper-fabric";

import ignoreConfig from "./eslint.ignore.config.json" with { type: "json" };
import thresholdsConfig from "./eslint.thresholds.json" with { type: "json" };
import localConfig from "./eslint.config.local";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Merge the optional project-owned eslint.ignore.config.local.json (create-only,
// never copy-overwritten) so host ignore customizations are not wiped when Lisa
// overwrites eslint.ignore.config.json on update.
const localIgnores: string[] = existsSync(
  path.join(__dirname, "eslint.ignore.config.local.json")
)
  ? (require("./eslint.ignore.config.local.json").ignores ?? [])
  : [];

// Annotate with the factory's return type so `tsc --noEmit` under
// `declaration: true` does not surface @eslint/core's `RulesConfig` in the
// emitted declaration (TS2883). Do NOT import `Linter` from "eslint" directly —
// that trips knip's unlisted-dependency check.
const config: ReturnType<typeof getHarperFabricConfig> = [
  ...getHarperFabricConfig({
    tsconfigRootDir: __dirname,
    ignorePatterns: [
      ...defaultHarperFabricIgnores,
      ...(ignoreConfig.ignores || []),
      ...localIgnores,
    ],
    thresholds: { ...defaultThresholds, ...thresholdsConfig },
  }),
  ...localConfig,
];

export default config;
