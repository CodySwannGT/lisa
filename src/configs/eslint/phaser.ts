/**
 * ESLint 9 Flat Config - Phaser Stack
 *
 * Extends Lisa's TypeScript config with Phaser 4 enforcement: bans Phaser 3
 * rendering idioms that were removed in v4 and non-deterministic randomness
 * in game code.
 * @module configs/eslint/phaser
 */
import type { Linter } from "eslint";
import {
  defaultIgnores,
  defaultThresholds,
  getTypescriptConfig,
} from "./typescript.js";

export { defaultIgnores, defaultThresholds };

/**
 * Default ignore patterns for Phaser projects.
 */
export const defaultPhaserIgnores = [
  ...defaultIgnores,
  "*.config.local.ts",
  "public/assets/**",
  ".vite/**",
];

/**
 * Phaser 3 idioms removed in Phaser 4, banned with pointers to the v4
 * replacement. Kept in sync with the phaser-v3-migration skill table.
 */
const PHASER_3_IDIOM_BANS: readonly {
  readonly selector: string;
  readonly message: string;
}[] = [
  {
    selector: "CallExpression[callee.property.name='setPipeline']",
    message:
      "Phaser 4 removed pipelines. Custom rendering is a RenderNode (render.renderNodes); 'Light2D' is gameObject.setLighting(true).",
  },
  {
    selector: "CallExpression[callee.property.name='setPostPipeline']",
    message:
      "Phaser 4 removed post pipelines. Use the unified Filter system (gameObject.filters / camera.filters).",
  },
  {
    selector: "CallExpression[callee.property.name='resetPipeline']",
    message:
      "Phaser 4 removed pipelines. There is nothing to reset — delete this call.",
  },
  {
    selector: "CallExpression[callee.property.name='setTintFill']",
    message:
      "Phaser 4 removed setTintFill. Use setTint(color) + setTintMode(Phaser.TintModes.FILL).",
  },
  {
    selector: "MemberExpression[property.name='preFX']",
    message:
      "Phaser 4 removed preFX. Use the unified Filter system (Filters work on any GameObject and on cameras).",
  },
  {
    selector: "MemberExpression[property.name='postFX']",
    message:
      "Phaser 4 removed postFX. Use the unified Filter system (Filters work on any GameObject and on cameras).",
  },
  {
    selector:
      "MemberExpression[object.object.name='Phaser'][object.property.name='Geom'][property.name='Point']",
    message: "Phaser 4 removed Geom.Point. Use Phaser.Math.Vector2.",
  },
  {
    selector: "MemberExpression[object.name='Phaser'][property.name='Struct']",
    message: "Phaser 4 removed Phaser.Struct. Use native Set / Map.",
  },
  {
    selector:
      "NewExpression[callee.object.object.name='Phaser'][callee.object.property.name='Display'][callee.property.name='BitmapMask']",
    message: "Phaser 4 removed BitmapMask. Use the Mask filter.",
  },
  {
    selector:
      "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message:
      "Game code must be deterministic. Use the seeded Phaser.Math.RND (RandomDataGenerator) instead of Math.random().",
  },
];

/**
 * Creates the Phaser ESLint configuration.
 * @param options - Configuration options
 * @param options.tsconfigRootDir - Root directory for tsconfig.json
 * @param options.ignorePatterns - Patterns to ignore
 * @param options.thresholds - Threshold overrides
 * @returns ESLint flat config array
 */
export function getPhaserConfig({
  tsconfigRootDir,
  ignorePatterns = defaultPhaserIgnores,
  thresholds = defaultThresholds,
}: {
  tsconfigRootDir: string;
  ignorePatterns?: string[];
  thresholds?: typeof defaultThresholds;
}): Linter.Config[] {
  return [
    ...getTypescriptConfig({
      tsconfigRootDir,
      ignorePatterns,
      thresholds,
    }),
    {
      files: ["src/**/*.ts"],
      rules: {
        "no-restricted-syntax": ["error", ...PHASER_3_IDIOM_BANS],
      },
    },
    {
      files: ["tests/**/*.ts", "src/**/*.test.ts"],
      rules: {
        "no-restricted-syntax": "off",
      },
    },
  ] as Linter.Config[];
}
