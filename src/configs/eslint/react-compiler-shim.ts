/**
 * A stand-in for eslint-plugin-react-compiler that keeps its rule name
 * resolving (CodySwannGT/lisa#4507).
 *
 * Lisa registered eslint-plugin-react-compiler only to set its one rule,
 * `react-compiler/react-compiler`, to "off": eslint-plugin-react-hooks 7
 * carries the React Compiler checks as separate rules. The plugin's newest
 * release still requires zod 3, which GHSA-mrhx-c7xc-m3w5 affects, so Lisa no
 * longer depends on it. Expo projects may still name the rule, in an inline
 * disable comment or in their own config. With no plugin under the namespace,
 * ESLint reports the first as an unknown rule and refuses to load the second.
 *
 * This shim keeps both working without the package. Its rule accepts any
 * options and reports nothing, which is exactly what the rule did under
 * Lisa's config, where it was off.
 * @module configs/eslint/react-compiler-shim
 */

/** The shim's one rule: any options, no reports. */
const noOpRule = {
  meta: {
    type: "problem" as const,
    docs: {
      description:
        "Lisa's stand-in for eslint-plugin-react-compiler's rule. It reports nothing; eslint-plugin-react-hooks carries the React Compiler checks.",
    },
    schema: false as const,
  },
  /**
   * Visit nothing.
   * @returns No listeners
   */
  create(): Record<string, never> {
    return {};
  },
};

/** Register under the `react-compiler` namespace in a flat config. */
export const reactCompilerShim = {
  meta: { name: "lisa-react-compiler-shim" },
  rules: { "react-compiler": noOpRule },
};
