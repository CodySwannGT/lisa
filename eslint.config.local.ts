/**
 * ESLint 9 Flat Config - Project-Local Customizations
 *
 * Add project-specific ESLint rules here. This file is create-only,
 * meaning Lisa will create it but never overwrite your customizations.
 *
 * Example:
 * ```ts
 * export default [
 *   {
 *     files: ["src/legacy/**"],
 *     rules: {
 *       "@typescript-eslint/no-explicit-any": "off",
 *     },
 *   },
 * ];
 * ```
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module eslint.config.local
 */
import type { getTypescriptConfig } from "@codyswann/lisa/eslint/typescript";

import { processEnvironmentBans } from "./src/configs/eslint/process-environment-bans.js";

/**
 * The element type eslint.config.ts spreads this into. Annotated so rule
 * severities such as "off" keep their literal type instead of widening to
 * `string`, which is not a rule config (CodySwannGT/lisa#4927).
 */
type LocalConfig = ReturnType<typeof getTypescriptConfig>;

const localConfig: LocalConfig = [
  // Lisa's own ignores (template trees, generated plugins, the wiki, OpenCode
  // plugin templates) live in eslint.ignore.config.local.json, NOT here: that
  // file is the one list eslint.config.ts, eslint.slow.config.ts and
  // tsconfig.eslint.json's `exclude` all agree on (CodySwannGT/lisa#4927).
  // An ignore added here would reach the fast lint only.
  {
    // The shipped ban on every route to the process environment, applied to
    // Lisa's own source now. Lisa lints itself with the installed release of
    // @codyswann/lisa, so a ban added to src/configs/eslint reaches this repo
    // only after it is published; applying the same factory here keeps Lisa
    // under the rule it ships from the commit that adds it. Config files keep
    // the shipped `**/*config.*` exemption.
    files: ["src/**/*.ts"],
    ignores: ["**/*config.*"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...processEnvironmentBans(
          "Read the environment through src/utils/process-environment.ts, Lisa's one sanctioned accessor."
        ),
      ],
    },
  },
  {
    // Lisa is a CLI and a set of config factories with no config service; the
    // process environment is genuinely their input. It is read in exactly one
    // module, and every other source file imports that binding.
    // Pinned by tests/unit/config/eslint-local-process-environment-scope.test.ts.
    files: ["src/utils/process-environment.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    // Shared test fixtures. `**/*.test.ts` is already exempt from the app's
    // `process.env` restriction because a test must be able to construct the
    // environment it puts a subject under; a helper extracted OUT of a test file
    // to stop three suites drifting onto different environments is the same code
    // doing the same job, and should not be pushed back inline to satisfy a rule
    // aimed at application configuration access.
    files: ["tests/**/support/**", "tests/support/**"],
    rules: {
      // Same argument as `no-restricted-syntax` below, for the other rule the
      // shipped `**/*.test.ts` override already turns off. A harness that hands
      // out disposable fixtures has to remember which ones it made so it can
      // remove them; that bookkeeping is the mutation the rule forbids, and it
      // is exactly as legitimate in a shared harness as it is inline in the
      // suite the harness was extracted from.
      "functional/immutable-data": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    rules: {
      // Lisa's own codebase has existing awaited and nested-function side effects
      // before later declarations. Keep the published rule stricter by default
      // while this repo carries that cleanup as separate follow-up work.
      "code-organization/enforce-statement-order": [
        "error",
        { checkAllFunctionBodies: false, checkAwaitedCalls: false },
      ],
    },
  },
  {
    // The block above is global, and a project-local config is spread AFTER the
    // Lisa factory — so it silently re-enabled a rule the shipped scripts
    // profile turns off for `scripts/**`. Re-apply the shipped decision here.
    // A maintenance script is one linear procedure; declaration-order rules are
    // tuned for composed application modules.
    files: ["scripts/**", "**/scripts/**"],
    rules: {
      "code-organization/enforce-statement-order": "off",
    },
  },
];

export default localConfig;
