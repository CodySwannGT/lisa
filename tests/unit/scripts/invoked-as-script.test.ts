/**
 * Tests for the shared ESM entry guard: its behavior, its byte-identical
 * parity across the lanes that carry a copy, and a sweep asserting no shipped
 * `.mjs` entry point has re-grown a hand-rolled guard.
 *
 * The defect being pinned is silent. A guard comparing `import.meta.url`
 * against an un-realpath'd `process.argv[1]` is false whenever the script is
 * reached through a symlinked path, so `main()` never runs and the process
 * exits 0 having checked nothing. Every `check-*.mjs` Lisa ships is a gate, so
 * that is a gate that stops having an opinion without failing, without logging,
 * and without any downstream signal at all.
 * @module tests/unit/scripts/invoked-as-script
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { invokedAsScript } from "../../../scripts/lib/invoked-as-script.mjs";
import {
  hasOwnershipHeader,
  withoutOwnershipHeader,
} from "../../../scripts/materialize-copy-overwrite.mjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const CANONICAL_REL = "scripts/lib/invoked-as-script.mjs";
/** Any well-formed module URL; the cases below never resolve it to a file. */
const ANY_MODULE_URL = "file:///anything.mjs";

/**
 * The lanes the build materializes the helper into.
 *
 * Downstream every lane collapses into one `scripts/` directory, so a single
 * copy would do. In this repo the lanes are separate trees and Lisa's own unit
 * tests import the lane copies directly, so a lane with a consumer must carry
 * the helper or those imports fail to resolve at all.
 */
const HELPER_LANES = ["all", "typescript", "expo"] as const;

/** Template trees whose `.mjs` entry points must route through the helper. */
const SHIPPED_SCRIPT_DIRS = [
  "all/copy-overwrite/scripts",
  "typescript/copy-overwrite/scripts",
  "expo/copy-overwrite/scripts",
] as const;

/**
 * `check-threshold-ratchet.mjs` and its two sibling modules are materialized
 * from `plugins/src/base/hooks/`, where they also RUN as agent-time hooks. A
 * `./lib/` import there would have to resolve inside the plugin payload, which
 * is a larger change than this one; until that happens they keep their own
 * guard and are excused here by name rather than by a pattern that would also
 * excuse a future offender silently.
 */
const MATERIALIZED_FROM_HOOKS = new Set([
  "check-threshold-ratchet.mjs",
  "threshold-ratchet-compare.mjs",
  "threshold-ratchet-families.mjs",
]);

/**
 * Guard spellings that are wrong, each matched by shape rather than by exact
 * text so a reformat cannot slip one past.
 */
const DEFECTIVE_GUARDS: readonly { name: string; pattern: RegExp }[] = [
  {
    name: "import.meta.url === pathToFileURL(process.argv[1]).href",
    pattern: /pathToFileURL\(\s*process\.argv\[1\]\s*\)/u,
  },
  {
    name: "fileURLToPath(import.meta.url) === resolve(process.argv[1])",
    pattern: /fileURLToPath\(\s*import\.meta\.url\s*\)\s*===/u,
  },
  {
    name: 'process.argv[1].endsWith("<basename>")',
    pattern: /process\.argv\[1\]\??\.endsWith\(/u,
  },
];

/**
 * Read a repo-relative text file.
 * @param relativePath - Repo-relative path.
 * @returns File contents.
 */
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");

/**
 * The materialized copy of the helper in one lane.
 * @param lane - Project-type lane.
 * @returns Repo-relative path of that lane's copy.
 */
const laneCopy = (lane: string): string =>
  `${lane}/copy-overwrite/scripts/lib/invoked-as-script.mjs`;

/**
 * The defective guards a single shipped module carries, if any.
 *
 * The helper itself is excused by DECLARING the export rather than by path, so
 * a rename or a duplicate copy of it reds instead of being waved through — its
 * prose quotes every defective spelling by name, which is the point of the
 * prose and would otherwise flag it.
 * @param relativePath - Repo-relative path of a shipped `.mjs`.
 * @returns One description per defective guard found; empty when swept clean.
 */
const guardOffences = (relativePath: string): string[] => {
  const contents = read(relativePath);
  if (contents.includes("export function invokedAsScript")) return [];
  return DEFECTIVE_GUARDS.filter(guard => guard.pattern.test(contents)).map(
    guard => `${relativePath} — ${guard.name}`
  );
};

/**
 * Every `.mjs` file directly under a shipped script tree, recursively.
 * @param relativeDir - Repo-relative directory.
 * @returns Repo-relative paths of the `.mjs` files found.
 */
const shippedModules = (relativeDir: string): string[] => {
  const root = path.join(REPO_ROOT, relativeDir);
  const entries = fs.readdirSync(root, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith(".mjs"))
    .map(entry =>
      path.relative(REPO_ROOT, path.join(entry.parentPath, entry.name))
    );
};

/**
 * A throwaway module plus a symlink pointing at it.
 *
 * Both spellings are returned because which one each side carries is the whole
 * subject: node hands the module its REAL path by default and its SYMLINKED
 * path under `--preserve-symlinks-main`, while `argv[1]` is always whatever the
 * caller typed.
 * @returns The module's real path and the symlink to it.
 */
const symlinkedModule = (): { real: string; link: string } => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "invoked-as-script-"));
  const real = path.join(dir, "real.mjs");
  const link = path.join(dir, "link.mjs");
  fs.writeFileSync(real, "export default 1;\n");
  fs.symlinkSync(real, link);
  return { real, link };
};

describe("invokedAsScript", () => {
  it("is true for the module node was asked to run", () => {
    const file = path.join(REPO_ROOT, CANONICAL_REL);
    expect(invokedAsScript(pathToFileURL(file).href, file)).toBe(true);
  });

  it("is true through a symlink to the entry point — the whole point", () => {
    // The failing case in the wild. Every Lisa-driven agent works in a git
    // worktree and macOS resolves /tmp through a symlink, so this is the
    // ordinary path, not an exotic one.
    const { real, link } = symlinkedModule();

    // `import.meta.url` is always the REAL path — node resolves ESM through
    // realpath — so the module URL is built from the realpath here, exactly as
    // node would hand it to the module. argv[1] is the symlink the caller
    // typed. Realpathing the tmpdir too is not incidental: on macOS it is
    // itself reached through /private, which is the same class of mismatch.
    expect(
      invokedAsScript(pathToFileURL(fs.realpathSync(real)).href, link)
    ).toBe(true);
  });

  it("is true when moduleUrl KEEPS the symlink, as --preserve-symlinks-main leaves it", () => {
    // "`import.meta.url` is always the real path" holds by default and fails
    // under `--preserve-symlinks-main`, which tells node not to resolve the main
    // entry. Realpathing only argv[1] then compares a real path against a
    // symlinked one and answers false for an entry point that WAS invoked
    // directly — the same fail-open this module exists to remove, on the flag
    // that most looks like it should not matter. Measured against a real
    // symlinked entry point: true normally, false under the flag.
    const { link } = symlinkedModule();

    // BOTH sides carry the symlinked spelling, which is what the flag produces.
    expect(invokedAsScript(pathToFileURL(link).href, link)).toBe(true);
  });

  it("is false for a module that was merely imported", () => {
    const { real: entry } = symlinkedModule();
    const other = path.join(path.dirname(entry), "other.mjs");
    fs.writeFileSync(other, "export default 2;\n");

    expect(invokedAsScript(pathToFileURL(other).href, entry)).toBe(false);
  });

  it("is false when nothing was asked to run", () => {
    // `node -e`, `--print` and the REPL leave argv[1] undefined. The naive
    // `realpathSync(process.argv[1])` the obvious fix reaches for throws
    // ENOENT here, turning a silent no-op into a hard crash. Held in a typed
    // variable rather than passed as a literal, because the runtime value this
    // pins is exactly what `process.argv[1]` is in those three modes.
    const absentArgv: string | undefined = process.argv[99];
    expect(invokedAsScript(ANY_MODULE_URL, absentArgv)).toBe(false);
    expect(invokedAsScript(ANY_MODULE_URL, "")).toBe(false);
  });

  it("is false — not throwing — when argv[1] cannot be resolved", () => {
    const missing = path.join(os.tmpdir(), "definitely-not-here-9f3c.mjs");
    expect(() => invokedAsScript(ANY_MODULE_URL, missing)).not.toThrow();
    expect(invokedAsScript(ANY_MODULE_URL, missing)).toBe(false);
  });

  it("takes moduleUrl first and required, so a call site cannot be written wrong", () => {
    // A defaulted `import.meta.url` inside a SHARED module resolves to the
    // helper itself, which is never anybody's argv[1] — so a forgetful caller
    // would get `false` forever, silently reinstating the exact fail-open
    // defect this module removes.
    expect(invokedAsScript.length).toBe(1);
  });
});

describe("shared entry guard wiring", () => {
  it("materializes byte-identical copies into every lane that imports it", () => {
    // Compared with the ownership header stripped, using the generator's own
    // stripper, so "the copy minus its stamp" has exactly one definition.
    const canonical = read(CANONICAL_REL);
    for (const lane of HELPER_LANES) {
      const copy = laneCopy(lane);
      expect(withoutOwnershipHeader(read(copy), copy), copy).toBe(canonical);
    }
  });

  it("stamps the ownership header on every copy, and on no canonical source", () => {
    // The stripping above keeps passing if the stamp silently stops being
    // written, so the stamp gets its own assertion in both directions. The
    // canonical file is the one maintainers edit; telling it that it will be
    // overwritten would be false.
    for (const lane of HELPER_LANES) {
      expect(hasOwnershipHeader(read(laneCopy(lane))), laneCopy(lane)).toBe(
        true
      );
    }
    expect(hasOwnershipHeader(read(CANONICAL_REL))).toBe(false);
  });

  it("leaves no hand-rolled entry guard in any shipped .mjs", () => {
    const subjects = SHIPPED_SCRIPT_DIRS.flatMap(shippedModules).filter(
      relativePath =>
        !MATERIALIZED_FROM_HOOKS.has(path.basename(relativePath)) &&
        !read(relativePath).includes("export function invokedAsScript")
    );
    const offenders = subjects.flatMap(guardOffences);
    const swept = subjects.length;
    // A rename or a moved tree would empty the sweep and let it pass by
    // testing nothing, which is the failure mode this whole file exists for.
    expect(swept).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });

  it("bites: a planted defective guard is caught by the same sweep", () => {
    // The negative above is only worth its runtime if it can fail. Rather than
    // trusting that, feed the patterns the exact text they must reject.
    const planted =
      "if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();";
    const caught = DEFECTIVE_GUARDS.filter(guard =>
      guard.pattern.test(planted)
    );
    expect(caught.map(guard => guard.name)).toContain(
      "import.meta.url === pathToFileURL(process.argv[1]).href"
    );
    expect(
      DEFECTIVE_GUARDS.some(guard =>
        guard.pattern.test(
          'const direct = process.argv[1]?.endsWith("check-thing.mjs");'
        )
      )
    ).toBe(true);
    expect(
      DEFECTIVE_GUARDS.some(guard =>
        guard.pattern.test(
          "const direct = fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);"
        )
      )
    ).toBe(true);
  });

  it("does not flag the accepted spelling", () => {
    // Minimality counterweight: a sweep that rejects everything would pass the
    // bite control above and still be useless.
    const accepted = "if (invokedAsScript(import.meta.url)) main();\n";
    expect(
      DEFECTIVE_GUARDS.filter(guard => guard.pattern.test(accepted))
    ).toEqual([]);
  });
});
