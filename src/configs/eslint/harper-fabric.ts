/**
 * ESLint 9 Flat Config - Harper/Fabric Stack
 *
 * Extends Lisa's TypeScript config with stricter immutability and generated
 * Harper deploy artifact ignores.
 * @module configs/eslint/harper-fabric
 */
import type { Linter } from "eslint";
import {
  defaultIgnores,
  defaultThresholds,
  getTypescriptConfig,
} from "./typescript.js";

export { defaultIgnores, defaultThresholds };

/**
 * Default ignore patterns for Harper/Fabric projects.
 */
export const defaultHarperFabricIgnores = [
  ...defaultIgnores,
  "**/*.yaml",
  "**/*.yml",
  "**/*.toml",
  "*.config.local.ts",
  "harper-app/resources.js",
  "harper-app/resource-*.js",
  "harper-app/web/**/*.js",
  "harper-app/web/**/*.js.map",
];

/**
 * Creates the Harper/Fabric ESLint configuration.
 * @param options - Configuration options
 * @param options.tsconfigRootDir - Root directory for tsconfig.json
 * @param options.ignorePatterns - Patterns to ignore
 * @param options.thresholds - Threshold overrides
 * @returns ESLint flat config array
 */
export function getHarperFabricConfig({
  tsconfigRootDir,
  ignorePatterns = defaultHarperFabricIgnores,
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
        "functional/immutable-data": "error",
        "functional/no-let": "error",
        "functional/prefer-readonly-type": "error",
        "functional/readonly-type": "error",
        "functional/type-declaration-immutability": "error",
      },
    },
    {
      files: ["tests/**/*.test.ts", "tests/**/*smoke.ts"],
      rules: {
        "functional/immutable-data": "off",
        "functional/no-let": "off",
        "functional/prefer-readonly-type": "off",
        "functional/readonly-type": "off",
        "functional/type-declaration-immutability": "off",
      },
    },
    {
      files: ["src/scripts/**/*.ts", "tests/**/*.ts"],
      rules: {
        "no-restricted-syntax": "off",
      },
    },
  ] as Linter.Config[];
}
