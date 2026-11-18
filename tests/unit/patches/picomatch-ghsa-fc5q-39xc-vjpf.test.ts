/**
 * GHSA-fc5q-39xc-vjpf: picomatch <= 4.0.7 backtracks exponentially on repeated
 * extglobs with a `*` branch (`+(*)`, `+(*a)`). Lisa patches every installed
 * copy through `.lisa/patches/`. These tests prove, against the real installed
 * copies and against the upstream source the patch is reversed back to:
 * 1. the regression script fails on upstream and passes on the patched copy;
 * 2. the patched matcher gives upstream's answer for every pattern it rewrites;
 * 3. each patch header's hash is the patched file, and hosts get the same bytes.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readAdvisoryPatches } from "../../../src/core/audit-patches.js";
import { resolveGit } from "../../support/git-executable.js";

/** The matcher surface these tests use. */
interface Picomatch {
  makeRe(pattern: string, options?: Record<string, unknown>): RegExp;
}

const ROOT = process.cwd();
const SCRIPT = ".lisa/patches/picomatch-ghsa-fc5q-39xc-vjpf.regression.mjs";
const TEMPLATE = "typescript/copy-overwrite";
const PATCHES = readAdvisoryPatches(ROOT).filter(
  patch => patch.name === "picomatch"
);
const scratch = mkdtempSync(join(tmpdir(), "lisa-picomatch-redos-"));

/**
 * The installed (patched) copy of one picomatch version.
 * @param version - Exact version
 * @returns Package directory
 */
const installed = (version: string) =>
  join(ROOT, `node_modules/.bun/picomatch@${version}/node_modules/picomatch`);

/**
 * Rebuild the upstream package by reversing the patch on a copy.
 * @param version - Exact version
 * @param file - The patch file
 * @returns Directory of the unpatched package
 */
function upstream(version: string, file: string): string {
  const dir = join(scratch, `picomatch@${version}`);
  cpSync(installed(version), dir, { recursive: true });
  execFileSync(resolveGit(), ["apply", "-R", join(ROOT, file)], { cwd: dir });
  return dir;
}

/**
 * Run the shipped regression script against picomatch copies.
 * @param dirs - Package directories
 * @returns The script's exit status
 */
const regression = (...dirs: string[]) =>
  spawnSync(process.execPath, [SCRIPT, "--budget=3000", ...dirs], {
    cwd: ROOT,
    encoding: "utf8",
  }).status;

/**
 * Every string of length 0..5 over characters that exercise the rewrites.
 * @returns Input strings
 */
function inputs(): readonly string[] {
  const alphabet = ["a", "b", ".", "/", "x", "[", "]"];
  return Array.from({ length: 5 }).reduce<readonly string[]>(
    (all, _, index) => [
      ...all,
      ...all
        .filter(value => value.length === index)
        .flatMap(value => alphabet.map(char => value + char)),
    ],
    [""]
  );
}

const BODIES = [
  "*",
  "**",
  "*a",
  "a*",
  "*a*",
  "a*b",
  "*.a",
  "?*",
  "*?",
  "*[a]",
  "[a]*",
  "*[^a]",
  "*.[ab]",
  "*a|b",
  "a*|b",
  "*a|*b",
  "a*|b*",
  "*|a",
  "*a|b|ab",
  "*a*|b",
  "**|a",
  "*.a|*.b",
  // No flat equivalent: these two become literals.
  "a*|*b",
  "a*b|a",
];
const FORMS = BODIES.flatMap(body =>
  ["+", "*"].flatMap(type =>
    [
      ["", ""],
      ["x", ""],
      ["", "b"],
      ["a/", ""],
      ["", "/a"],
      [".", ""],
    ].map(([before, after]) => `${before}${type}(${body})${after}`)
  )
);
const OPTIONS = [{}, { dot: true }, { capture: true }, { nocase: true }];

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("picomatch GHSA-fc5q-39xc-vjpf patch", () => {
  it("patches every picomatch version Lisa installs", () => {
    expect(
      PATCHES.map(patch => patch.version).sort((a, b) => a.localeCompare(b))
    ).toEqual(["2.3.2", "4.0.7"]);
    expect(PATCHES.every(patch => patch.regressionTest === SCRIPT)).toBe(true);
  });

  for (const patch of PATCHES) {
    describe(`picomatch@${patch.version}`, () => {
      const pristine = upstream(patch.version, patch.file);

      it("fails the regression script unpatched and passes it patched", () => {
        expect(regression(pristine)).toBe(1);
        expect(regression(installed(patch.version))).toBe(0);
      }, 30_000);

      it("matches what upstream matches for every rewritten pattern", () => {
        const load = (dir: string) =>
          createRequire(join(dir, "index.js"))(dir) as Picomatch;
        const before = load(pristine);
        const after = load(installed(patch.version));
        const strings = inputs();
        const results = OPTIONS.flatMap(options =>
          FORMS.map(form => {
            const old = before.makeRe(form, options);
            const now = after.makeRe(form, options);
            if (old.source === now.source) return "unchanged";
            if (/\\[+*]\\\(/u.test(now.source)) return "literal";
            return strings.every(value => old.test(value) === now.test(value))
              ? "same"
              : `mismatch: ${form} ${JSON.stringify(options)}`;
          })
        );
        // Every form is rewritten except the two new literals, `*|a` and
        // `**|a` (literal upstream already) and `?*` (upstream does not parse
        // `+(?` as an extglob).
        expect(results.filter(result => result === "same")).toHaveLength(
          OPTIONS.length * 2 * 6 * (BODIES.length - 5)
        );
        expect(results.filter(result => result.startsWith("mismatch"))).toEqual(
          []
        );
        // Only the mixed-star shapes, which have no equivalent flat form,
        // become literals, as other risky repeated extglobs already do.
        expect(results.filter(result => result === "literal")).toHaveLength(
          OPTIONS.length * 2 * 6 * 2
        );
      }, 60_000);

      it("declares the hash of the file the patch produces", () => {
        const [file] = patch.files;
        const bytes = readFileSync(
          join(installed(patch.version), file?.path ?? "")
        );
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          file?.sha256
        );
      });
    });
  }

  it("ships hosts the same patch bytes Lisa itself installs", () => {
    for (const file of [SCRIPT, ...PATCHES.map(patch => patch.file)]) {
      expect(readFileSync(join(ROOT, TEMPLATE, file), "utf8")).toBe(
        readFileSync(join(ROOT, file), "utf8")
      );
    }
    const template = JSON.parse(
      readFileSync(
        join(ROOT, "typescript/package-lisa/package.lisa.json"),
        "utf8"
      )
    ) as { force: { patchedDependencies: Record<string, string> } };
    const own = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8")
    ) as {
      patchedDependencies: Record<string, string>;
    };
    expect(template.force.patchedDependencies).toEqual(own.patchedDependencies);
  });
});
