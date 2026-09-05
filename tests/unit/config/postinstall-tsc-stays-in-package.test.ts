/**
 * `postinstall`'s `tsc` must not escape this package into the consumer's project.
 *
 * `postinstall` is the one lifecycle script in this package.json that runs in
 * two completely different places: this checkout, where building `dist/` is the
 * point, and every CONSUMER's `node_modules/@codyswann/lisa`, where there is
 * nothing to build and `dist/` already shipped in the tarball.
 *
 * Bare `tsc` resolves its config by walking UP from the working directory. The
 * published tarball contains no `tsconfig.json` of its own — verified by the
 * control below against the `files` allowlist — so in a consumer the walk does
 * not stop at the package. It stops at the consumer's root `tsconfig.json` and
 * compiles THEIR project, in place, with whatever options they declared.
 *
 * Measured on a consumer whose tsconfig sets neither `noEmit` nor `outDir`
 * (both of which are ordinary — that project passes `--noEmit` on the command
 * line in its own `build` and `typecheck` scripts instead): installing 4.48.0
 * emitted **254** stray `.js`/`.d.ts` files beside their sources, and its
 * lint, slow-lint and format gates went red with 774 errors over 488 files.
 * Installing 4.30.0 in the same repo, with the install command held constant,
 * emitted zero.
 *
 * The regression arrived with the unconditional-rebuild fix
 * (`fix(build): rebuild dist unconditionally instead of only when absent`),
 * which correctly deleted `[ -d dist/configs ] ||` from five sites. That
 * predicate was a staleness bug at the four sites that only ever run inside
 * this checkout. At `postinstall` it was also, incidentally, the only thing
 * keeping `tsc` from running in consumers at all — `dist/configs` always
 * exists in the tarball, so the guard always short-circuited there.
 *
 * THE FIX IS NOT A RETURN TO THAT PREDICATE, and the distinction is the whole
 * point of this file. `[ -d dist/configs ]` tests the build's OUTPUT, so it can
 * be stale — output present but old is exactly the case it got wrong.
 * `[ -f tsconfig.json ]` tests the build's INPUT. It cannot be stale: either
 * this is a checkout that can build, or it is not. Inside this checkout the
 * config is always present, so the build still runs unconditionally and the
 * unconditional-rebuild fix is preserved intact.
 *
 * `-p tsconfig.json` is the second, independent guard. It pins the config
 * resolution to this directory, so even a future release that did ship a
 * `tsconfig.json` could not walk up into a consumer's project.
 *
 * The guard is written as `[ ! -f tsconfig.json ] || tsc …` rather than an
 * `if`/`then`/`fi` block on purpose: this line is executed by whichever shell
 * the running package manager provides, `bun run` included, and `[` with `||`
 * is the same construct the rest of the line already relies on.
 * @module tests/unit/config/postinstall-tsc-stays-in-package
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** This repository's root, from this file's own location. */
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/**
 * This repository's package manifest.
 * @returns The parsed package.json, narrowed to the fields this file reads.
 */
const manifest = (): Readonly<{
  files?: readonly string[];
  scripts: Record<string, string>;
}> =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
    files?: readonly string[];
    scripts: Record<string, string>;
  };

/**
 * The `postinstall` command line.
 * @returns The declared postinstall script, or an empty string if absent.
 */
const postinstall = (): string => manifest().scripts["postinstall"] ?? "";

describe("postinstall's tsc stays inside this package", () => {
  it("runs tsc only when this package's own tsconfig is present", () => {
    // The bite: pre-fix the command ends `; tsc || true`, and this fails.
    expect(
      postinstall(),
      "bare `tsc` walks up out of node_modules/@codyswann/lisa and compiles " +
        "the CONSUMER's project in place"
    ).toContain("[ ! -f tsconfig.json ] ||");
  });

  it("pins config resolution to this directory, so tsc cannot walk up", () => {
    // Independent of the presence test above. A release that shipped a
    // tsconfig.json would defeat that test alone; -p defeats the walk itself.
    expect(postinstall()).toContain("tsc -p tsconfig.json");
  });

  it("never invokes tsc without a config path", () => {
    // The two assertions above are satisfiable while a second, unguarded `tsc`
    // sits elsewhere on the same line. This is the one that catches that.
    const bare = [...postinstall().matchAll(/(^|[;&|]\s*)tsc(?!\s+-p)\b/g)];

    expect(
      bare,
      "every tsc in postinstall must carry -p, or it resolves by walking up"
    ).toHaveLength(0);
  });

  it("still builds in this checkout, where building is the point", () => {
    // The control. "Does not escape" is trivially satisfiable by dropping the
    // build entirely, which would strand this repo's self-referencing
    // @codyswann/lisa/* imports with no dist/ to resolve against.
    expect(postinstall()).toContain("tsc");
  });

  it("keeps the build unconditional in this checkout", () => {
    // Guards the distinction this file exists to hold. The predicate must test
    // the build's INPUT, never its OUTPUT — an output test is the staleness bug
    // that `fix(build): rebuild dist unconditionally` removed, and reinstating
    // it here would reintroduce that defect under a different name.
    expect(
      postinstall(),
      "a dist/ presence test is a staleness predicate, not a consumer guard"
    ).not.toContain("dist/configs");
  });

  it("does not ship a tsconfig.json, which is why the walk escaped", () => {
    // The control for the mechanism itself. If a future release adds tsconfig
    // to `files`, the presence test above stops discriminating and -p becomes
    // the only guard left — this test is what makes that visible.
    const files = manifest().files ?? [];

    expect(files).not.toContain("tsconfig.json");
  });
});
