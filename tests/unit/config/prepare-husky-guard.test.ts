/**
 * Unit test guarding against regressing the `prepare` script's INIT_CWD
 * `.serverless` guard in package.lisa.json templates.
 *
 * Background: root package.json's `prepare` script was fixed (see
 * `fix: clean low-severity repo hygiene issues`) to skip `husky install`
 * when INIT_CWD includes `.serverless`, using an OR-based guard:
 *
 *   node -e "if (...) process.exit(0); process.exit(1);" || husky install || true
 *
 * The `node -e` process always exits non-zero unless the `.serverless`
 * condition matches, so `husky install` (triggered by `||`) only runs when
 * NOT in a `.serverless` install context.
 *
 * The previous (buggy) form used `&&` instead:
 *
 *   node -e "if (...) { process.exit(0); }" && husky install || true
 *
 * That `node -e` script has no `else` branch, so when the condition is
 * false it falls through and the process still exits 0 (Node's implicit
 * success exit). That means the `&&`-guarded `husky install` runs
 * unconditionally regardless of `.serverless`, defeating the guard.
 *
 * `typescript/package-lisa/package.lisa.json` governs the root
 * `prepare` script via `force`, so if the template still carries the
 * buggy `&&` form, the next Lisa template sync will silently reintroduce
 * the regression into every project's package.json (including this
 * repo's own).
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Minimal shape of a package.lisa.json for the assertions below.
 */
interface PackageLisaShape {
  readonly force?: {
    readonly scripts?: Readonly<Record<string, string>>;
  };
  readonly defaults?: {
    readonly scripts?: Readonly<Record<string, string>>;
  };
}

/**
 * Load a JSON file from disk and return its parsed contents.
 * @param relativePath - Path relative to the Lisa repo root
 * @returns Parsed JSON (unknown shape; tests narrow as needed)
 */
function readTemplateJson(relativePath: string): unknown {
  const absolute = path.join(REPO_ROOT, relativePath);
  return JSON.parse(fs.readFileSync(absolute, "utf-8"));
}

const TEMPLATE_PATHS = [
  "package.lisa.json",
  "typescript/package-lisa/package.lisa.json",
  "expo/package-lisa/package.lisa.json",
  "nestjs/package-lisa/package.lisa.json",
  "cdk/package-lisa/package.lisa.json",
  "harper-fabric/package-lisa/package.lisa.json",
  "phaser/package-lisa/package.lisa.json",
  "npm-package/package-lisa/package.lisa.json",
] as const;

describe("package.lisa.json templates guard husky install with fail-based (||) INIT_CWD check", () => {
  it.each(TEMPLATE_PATHS.map(p => [p]))(
    "%s does not use the broken && guard for INIT_CWD .serverless detection",
    relPath => {
      const template = readTemplateJson(relPath) as PackageLisaShape;
      const forcePrepare = template.force?.scripts?.prepare;
      const defaultsPrepare = template.defaults?.scripts?.prepare;

      for (const script of [forcePrepare, defaultsPrepare]) {
        if (typeof script !== "string") continue;
        if (!script.includes("INIT_CWD")) continue;
        // The node -e guard has no else branch, so it always exits 0
        // unless it explicitly calls process.exit(1). Chaining husky
        // install with `&&` after such a script runs husky
        // unconditionally, defeating the .serverless skip. The
        // conditional must instead run husky on FAILURE (`||`).
        expect(script).not.toContain('") && husky install');
        expect(script).toContain("|| husky install");
      }
    }
  );
});
