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
  // Root-level compiled Harper modules (resources.js, resource-*.js, and any
  // other build output emitted straight into harper-app/). The single-star does
  // not cross a directory separator, so hand-written shims one level down
  // (harper-app/<route>/index.js) are still linted.
  "harper-app/*.js",
  "harper-app/web/**",
  "harper-app/lib/**",
];

/**
 * Platform built-ins declared trusted-immutable leaves for the
 * `type-declaration-immutability` check. `Date`/`URL` and the DOM
 * node/element/event types expose mutating methods, so `is-immutable-type`
 * rates them "Mutable" — and because Harper row types hold `Date` (returned
 * in-process) and any web layer holds DOM refs in its readonly option bags,
 * that caps nearly every type below `ReadonlyDeep`. A readonly field holding
 * one of these is not a mutation vector, so treating them as opaque immutable
 * leaves is the standard `is-immutable-type` override pattern. Project-specific
 * leaf types belong in the consumer's `eslint.config.local.ts`.
 */
const immutabilityLeafOverrides = [
  "Date",
  "URL",
  "Node",
  "Element",
  "HTMLElement",
  "SVGElement",
  "Event",
  "EventTarget",
  "Blob",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLTextAreaElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "HTMLFormElement",
  "HTMLImageElement",
  "HTMLDivElement",
  "HTMLSpanElement",
  "KeyboardEvent",
  "MouseEvent",
  "InputEvent",
  "SubmitEvent",
  "FocusEvent",
  "PointerEvent",
].map(type => ({ type, to: "Immutable" }));

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
      settings: { immutability: { overrides: immutabilityLeafOverrides } },
      rules: {
        "functional/immutable-data": "error",
        "functional/no-let": "error",
        "functional/prefer-readonly-type": "error",
        "functional/readonly-type": "error",
        // Enforced at `ReadonlyDeep` (every property recursively `readonly`),
        // NOT the plugin default of `Immutable`. `Immutable` additionally
        // rejects function-typed properties, `Record`/index-signature bags,
        // and mutable-method built-ins (`Date`, DOM types) — none of which a
        // Harper app can shed without restructuring legitimate shapes, which
        // is why projects were forced to disable this rule wholesale.
        // `ReadonlyDeep` + the platform-leaf overrides above is the strongest
        // achievable bar and the real immutability guarantee.
        "functional/type-declaration-immutability": [
          "error",
          {
            rules: [
              {
                identifiers: [".+"],
                immutability: "ReadonlyDeep",
                comparator: "AtLeast",
              },
            ],
          },
        ],
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
        // Statement-order is a production-code discipline. Smoke/integration
        // tests interleave arrange-act-assert with sequential awaited UI/HTTP
        // interactions where the await ORDER is the test logic — reordering
        // would change behavior. Exempt tests, consistent with the
        // immutability relaxations above.
        "code-organization/enforce-statement-order": "off",
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
