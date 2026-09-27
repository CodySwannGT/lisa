/**
 * Managed templates must not trip a consumer's `max-lines` threshold.
 *
 * `eslint.expo.ts` grew to 511 lines while only `max-lines-per-function` was
 * disabled at file level, so a fresh `lisa apply` onto an Expo project whose
 * `eslint.thresholds.json` pins `maxLines: 300` failed lint immediately on a
 * file the project does not own (CodySwannGT/lisa#4278). Installed scripts are
 * covered by the `scripts/**` override's `max-lines: off`; root-level managed
 * TypeScript configs are not, so any of them over the floor must carry a
 * file-level `max-lines` disable.
 * @module tests/unit/config/eslint-shipped-max-lines
 */
import fs from "node:fs";
import path from "node:path";

import { ESLint } from "eslint";
import * as tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * The floor the shipped `eslint.thresholds.json` seeds, named once because the
 * discovery assertion and the lint both speak it.
 */
const FLOOR_MAX_LINES = 300;

/** Delivery modes whose files land inside a consumer's lint scope as-is. */
const MANAGED_DIRS = ["copy-overwrite", "copy-contents"];

/**
 * Every managed `.ts`/`.tsx` file a stack installs at the consumer's root or
 * under a directory the shipped lint profile does not relax — scripts are
 * excluded on purpose: `scripts/**` gets `max-lines: off` from
 * `getScriptsFilesOverride`, so they can never trip the consumer threshold.
 * The walk is recursive: a nested managed file is no less the consumer's to
 * lint than a top-level one.
 * @returns Shipped template paths longer than the max-lines floor
 */
function oversizedManagedSources(): readonly string[] {
  return fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .flatMap(stack =>
      MANAGED_DIRS.flatMap(mode => {
        const dir = path.join(REPO_ROOT, stack.name, mode);
        if (!fs.existsSync(dir)) return [];
        return fs
          .readdirSync(dir, { recursive: true, withFileTypes: true })
          .filter(entry => entry.isFile() && /\.tsx?$/.test(entry.name))
          .map(entry => path.join(entry.parentPath, entry.name));
      })
    )
    .filter(file => {
      if (file.includes(`${path.sep}scripts${path.sep}`)) return false;
      return (
        fs.readFileSync(file, "utf-8").split("\n").length > FLOOR_MAX_LINES
      );
    });
}

describe("oversized managed templates exempt themselves from max-lines", () => {
  it("discovers at least one template over the floor, or this suite is vacuous", () => {
    expect(oversizedManagedSources().length).toBeGreaterThan(0);
  });

  it.each(oversizedManagedSources().map(file => [path.basename(file), file]))(
    "%s lints clean under a consumer's maxLines floor",
    async (_name, file) => {
      const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: {
          files: ["**/*.ts", "**/*.tsx"],
          languageOptions: { parser: tseslint.parser },
          rules: {
            "max-lines": ["error", { max: FLOOR_MAX_LINES }],
            // Enabled so the file-level disable that also names this rule is a
            // USED directive — the consumer profile ships it, and an unused
            // disable is itself an error under reportUnusedDisableDirectives.
            "max-lines-per-function": ["error", { max: 1 }],
          },
        },
      });
      const results = await eslint.lintFiles([file as string]);
      const findings = results.flatMap(result =>
        result.messages.map(
          message =>
            `${message.line}:${message.column} ${message.ruleId} — ${message.message}`
        )
      );
      expect(findings).toEqual([]);
    }
  );
});
