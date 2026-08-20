/**
 * This file is managed by Lisa and IS replaced on each `lisa` run.
 * Do not edit directly — durable changes belong upstream in Lisa.
 */

/**
 * ESLint 9 Flat Config - Main Entry Point (Expo)
 *
 * Thin wrapper around @codyswann/lisa eslint config factory.
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
  defaultIgnores,
  defaultThresholds,
  getExpoConfig,
  readTypedAxes,
} from "@codyswann/lisa/eslint/expo";

import ignoreConfig from "./eslint.ignore.config.json" with { type: "json" };
import thresholdsConfig from "./eslint.thresholds.json" with { type: "json" };
import localConfig from "./eslint.config.local";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Auto-detect the Expo SDK 55+/56 `/src` convention so the component-structure,
// ui-standards, and view-memo overrides target `src/...` instead of the root.
const sourceRoot = existsSync(path.join(__dirname, "src", "app")) ? "src/" : "";

// Merge the optional project-owned eslint.ignore.config.local.json (create-only,
// never copy-overwritten) so host ignore customizations are not wiped when Lisa
// overwrites eslint.ignore.config.json on update.
const localIgnores: string[] = existsSync(
  path.join(__dirname, "eslint.ignore.config.local.json")
)
  ? (require("./eslint.ignore.config.local.json").ignores ?? [])
  : [];

// Arm ui-standards/no-unbound-design-value from `design.tokens.axes` in
// .lisa.config.json. Declaring an axis is what arms the rule; declaring none
// leaves it silent. Read here, at config load, exactly like
// eslint.thresholds.json and eslint.ignore.config.json above — so there is no
// generation step and nothing that can go stale against the config (#2807).
const typedAxes = readTypedAxes(__dirname);

// Type only the managed factory result, then trust project-owned additions at
// their spread boundary. The double assertion is intentional: one custom-plugin
// entry can be structurally different enough for a direct cast to raise TS2352,
// and annotating an array that spreads `localConfig` RAW force-conforms the
// host's local config to the managed factory's return type. Asserting at the
// spread itself keeps the host's config out of that annotation while the array
// stays a literal — assembling it by pushing instead would mutate it, which the
// `functional/immutable-data` rule shipped in this very profile rejects. Do not
// import `Linter` from "eslint" directly either; that trips knip's
// unlisted-dependency check.
const config: ReturnType<typeof getExpoConfig> = [
  ...getExpoConfig({
    tsconfigRootDir: __dirname,
    ignorePatterns: [
      ...(ignoreConfig.ignores || defaultIgnores),
      ...localIgnores,
    ],
    thresholds: { ...defaultThresholds, ...thresholdsConfig },
    sourceRoot,
    typedAxes,
  }),
  ...(localConfig as unknown as ReturnType<typeof getExpoConfig>),
];

export default config;
