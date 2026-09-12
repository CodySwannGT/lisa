/**
 * Every language a shipped ast-grep rule targets must be reachable from the
 * shipped lint-staged config that is meant to run those rules pre-commit.
 *
 * Lisa ships `ast-grep/rules/no-day-truncating-file-age-predicate.yml` with
 * `language: bash`, and ships a `.lintstagedrc.json` whose only `ast-grep scan`
 * task hangs off `*.{js,mjs,ts,tsx,jsx}`. lint-staged hands each matcher only
 * the staged files that matcher matched, so editing a `.sh` file never ran the
 * rule that exists to police `.sh` files. The rule shipped, was never reached,
 * and read as pre-commit coverage while its population was empty by
 * construction. Observed in a caller repo in the portfolio after a 4.48.0 →
 * 4.50.0 bump, and not fixable there: the config is Lisa-managed, so a local
 * edit becomes fork drift and is reverted by the next apply.
 *
 * The same shape held for `language: ruby`, which Lisa's own ruleset carries
 * (the rails rule source) over `.rb` files this repository also ships.
 *
 * CI is a different surface and is not evidence for this one: the
 * `structural-rules` job runs a whole-repo `sg scan` with no file arguments, so
 * it reaches every language regardless of globs. Only the pre-commit surface is
 * glob-scoped, and only it can therefore under-reach silently.
 *
 * Rails is deliberately outside this guard's population: it ships ast-grep
 * rules but no lint-staged config — its pre-commit surface is `lefthook.yml`
 * and it ships no node manifest to install ast-grep from — so its rules are
 * reached by CI and by the agent-time `sg-scan-on-edit.sh` hooks instead.
 */
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { extensionsOf } from "../../helpers/lintstaged-globs.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The lint-staged config every `typescript` descendant stack inherits. */
const TYPESCRIPT_CONFIG = "typescript/copy-overwrite/.lintstagedrc.json";

/**
 * File extensions ast-grep's parser claims for each language Lisa writes rules
 * in, verified against the shipped `@ast-grep/cli` by scanning a planted
 * violation under each extension. A language missing from this map fails the
 * suite rather than passing vacuously — an unmapped language is exactly the
 * silent gap this file exists to catch.
 */
const LANGUAGE_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  bash: ["sh", "bash", "zsh", "ksh"],
  javascript: ["js", "mjs", "cjs", "jsx"],
  ruby: ["rb"],
  tsx: ["tsx"],
  typescript: ["ts", "mts", "cts"],
};

/**
 * A shipped ast-grep rule directory paired with the lint-staged config that is
 * responsible for reaching it pre-commit. Every `typescript` descendant stack
 * (expo, nestjs, cdk, phaser, npm-package, harper-fabric) inherits the
 * typescript config, so the stacks that add rules of their own are listed
 * against it.
 */
const SURFACES = [
  {
    config: ".lintstagedrc.json",
    name: "lisa",
    rules: "ast-grep/rules",
  },
  {
    config: TYPESCRIPT_CONFIG,
    name: "typescript stack",
    rules: "typescript/copy-overwrite/ast-grep/rules",
  },
  {
    config: TYPESCRIPT_CONFIG,
    name: "phaser stack",
    rules: "phaser/copy-overwrite/ast-grep/rules",
  },
  {
    config: TYPESCRIPT_CONFIG,
    name: "harper-fabric stack",
    rules: "harper-fabric/copy-overwrite/ast-grep/rules",
  },
] as const;

/**
 * Languages declared by every rule under a shipped rule directory.
 * @param rulesDir - Repository-relative ast-grep rule directory
 * @returns The declared `language:` values
 */
function declaredLanguages(rulesDir: string): readonly string[] {
  const root = path.join(REPO_ROOT, rulesDir);
  const entries = readdirSync(root, { recursive: true }) as readonly string[];
  const languages = entries
    .filter(entry => entry.endsWith(".yml") || entry.endsWith(".yaml"))
    .flatMap(entry => {
      const declaration = /^language:[^\S\n]*(\S+)/mu.exec(
        readFileSync(path.join(root, entry), "utf8")
      );
      const [, language] = declaration ?? [];
      return language === undefined ? [] : [language];
    });
  return [...new Set(languages)].sort((left, right) =>
    left.localeCompare(right)
  );
}

/**
 * Extensions the config hands to an `ast-grep scan` task.
 * @param configPath - Repository-relative `.lintstagedrc.json`
 * @returns Every extension scanned pre-commit
 */
function scannedExtensions(configPath: string): ReadonlySet<string> {
  const config = JSON.parse(
    readFileSync(path.join(REPO_ROOT, configPath), "utf8")
  ) as Record<string, readonly string[]>;
  return new Set(
    Object.entries(config)
      .filter(([, tasks]) =>
        tasks.some(task => task.startsWith("ast-grep scan"))
      )
      .flatMap(([pattern]) => [...extensionsOf(pattern)])
  );
}

describe.each(SURFACES)(
  "$name ast-grep language reach",
  ({ config, rules }) => {
    const languages = declaredLanguages(rules);

    it("declares at least one rule", () => {
      // Guards the guard: an empty rule directory would make every assertion
      // below vacuously true, which is the failure mode under investigation.
      expect(languages.length).toBeGreaterThan(0);
    });

    it.each(languages)("maps %s to known file extensions", language => {
      expect(Object.keys(LANGUAGE_EXTENSIONS)).toContain(language);
    });

    it.each(languages)(
      "hands %s files to ast-grep scan pre-commit",
      language => {
        const scanned = scannedExtensions(config);
        const reached = (LANGUAGE_EXTENSIONS[language] ?? []).filter(
          extension => scanned.has(extension)
        );
        // Named in the message so a failure says WHICH language went unscanned.
        expect({ language, reached }).toEqual({
          language,
          reached: expect.arrayContaining([expect.any(String)]) as unknown,
        });
      }
    );
  }
);
