/**
 * ESLint 9 Flat Config - Slow Rules Only (Expo)
 *
 * The shared slow rules plus the one React Compiler check the main Expo
 * config turns off for speed:
 * - react-hooks/static-components - Static component optimization checks (slow)
 *
 * The other React Compiler checks ship in eslint-plugin-react-hooks 7 as one
 * rule per compiler diagnostic and run at "error" in the main Expo lint
 * (src/configs/eslint/expo.ts). They replace the single
 * `react-compiler/react-compiler` rule this config used to run from
 * eslint-plugin-react-compiler, whose last release pins zod 3, which gets no
 * fix for GHSA-mrhx-c7xc-m3w5 (CodySwannGT/lisa#4931).
 *
 * A module of its own, so only Expo's lint:slow loads the React plugin.
 * When this lived in ./slow.ts, every stack loaded it, and in an isolated
 * install react-hooks 7 could be given zod-validation-error 3, which lacks
 * the `/v4` entry it imports: every stack's lint:slow crashed on load
 * (CodySwannGT/lisa#4507). The Expo package template forces
 * zod-validation-error 4 for the one stack that does load it.
 * @see https://react.dev/learn/react-compiler
 * @module configs/eslint/slow-expo
 */
import reactHooksPlugin from "eslint-plugin-react-hooks";

import { getSlowConfig } from "./slow.js";

/**
 * Creates the slow ESLint configuration for Expo projects: the shared slow
 * rules plus the React rule the main Expo config turns off for speed.
 *
 * The React rules moved here from the main Expo lint when lint:slow was
 * introduced (0b58fe96a4). A later rewrite of this module kept only the
 * import rules, so none ran anywhere until they were restored
 * (CodySwannGT/lisa#4507). The plugin is resolved from Lisa's own
 * dependencies, so a project needs no extra install.
 * @param options - Configuration options for the slow rules config
 * @param options.ignorePatterns - Patterns to ignore in addition to built-in ignores
 * @returns ESLint flat config array containing only slow rules
 */
export function getExpoSlowConfig({
  ignorePatterns = [],
}: {
  ignorePatterns?: readonly string[];
} = {}): import("eslint").Linter.Config[] {
  return [
    ...getSlowConfig({ ignorePatterns }),
    {
      files: ["**/*.tsx", "**/*.ts"],
      plugins: {
        // Rules only: the package's `configs` shape does not fit ESLint's
        // Plugin type, and this config needs none of its presets.
        "react-hooks": { rules: reactHooksPlugin.rules },
      },
      rules: {
        // Static component optimization (slow)
        "react-hooks/static-components": "error",
      },
    },
  ];
}
