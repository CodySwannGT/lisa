/**
 * Lisa must boot in a project whose tree breaks minimatch's ESM entry.
 *
 * `minimatch@10`'s ESM entry opens with `import { expand } from
 * 'brace-expansion'`. Any project resolving `brace-expansion` to the 2.x line
 * — a very common CVE remediation, since `">=2.1.4 <3"` pins a patched 2.x —
 * gets a CJS module with no named `expand`, and that import throws at MODULE
 * LOAD.
 *
 * Measured on a real consumer, same package, same version, same tree:
 *
 *     import('minimatch')   SyntaxError: Named export 'expand' not found
 *     require('minimatch')  returns a working function
 *
 * ## Why this was fatal rather than annoying
 *
 * The failure took out Lisa's entire CLI, so `lisa apply` could not run — and
 * `lisa apply` is what removes the offending override. The remedy shipped
 * inside the thing that could not start. A consumer in that state could not
 * self-heal by upgrading, because upgrading is what was broken.
 *
 * ## Why the existing shim did not save it
 *
 * `ignore-patterns.ts` already carried a compatibility shim, whose comment said
 * it existed so "Lisa still runs in projects whose package manager hoists an
 * older CJS minimatch for another tool". It was unreachable: a static ESM
 * import fails before any fallback can be consulted. A guard that cannot fire
 * is not a guard.
 *
 * ## What these tests can and cannot prove
 *
 * The behavioural half — that matching still works — is covered by
 * `ignore-patterns.test.ts` and is not repeated here.
 *
 * The bootstrap half is asserted against the SOURCE, deliberately. Simulating a
 * broken `brace-expansion` in-process is not possible without corrupting this
 * repository's own `node_modules`, and `createRequire` resolves from Lisa's
 * installed location rather than the caller's, so a temporary fixture tree
 * would not be on the resolution path. The source assertions pin the two
 * properties that actually failed: the import is not static, and resolution
 * goes through CJS.
 * @module tests/unit/utils/ignore-patterns-bootstrap
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { matchesAnyPattern } from "../../../src/utils/ignore-patterns.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "utils",
  "ignore-patterns.ts"
);

const source = (): string => readFileSync(SOURCE, "utf8");

describe("minimatch is not resolved at module load", () => {
  it("has no static import of minimatch", () => {
    // The exact regression. A static `import … from "minimatch"` executes when
    // this module loads, which is before any fallback can run — and takes the
    // whole CLI with it in a project whose tree breaks minimatch's ESM entry.
    // Line-based rather than one regex: a pattern combining `\s` with a
    // greedy `[^\n]*` backtracks super-linearly, and a lint rule rejects it.
    const staticImports = source()
      .split("\n")
      .filter(line => line.trimStart().startsWith("import "))
      .filter(line => line.includes('"minimatch"'));

    expect(staticImports).toEqual([]);
  });

  it("resolves through CJS rather than a dynamic ESM import", () => {
    // `await import("minimatch")` would be lazy but would still hit the ESM
    // entry, which is the half that throws. CJS is what actually works in the
    // broken tree.
    expect(source()).toMatch(/createRequire/u);
    expect(source()).toMatch(/requireFromHere\(\s*["']minimatch["']\s*\)/u);
  });

  it("resolves on first use, not at module scope", () => {
    // A top-level `const x = requireFromHere("minimatch")` would reintroduce the
    // eager failure with a different import style. The call must sit inside a
    // function.
    expect(source()).toMatch(/const loadMinimatch = \(\)[^\n]*=>/u);
  });
});

describe("the matcher still works", () => {
  it("matches through the lazily-resolved implementation", () => {
    // The positive control for all three assertions above: they are satisfied
    // by deleting minimatch entirely, so something must prove the matcher is
    // real and reachable.
    expect(
      matchesAnyPattern("src/generated/api.ts", ["src/generated/**"])
    ).toBe(true);
    expect(matchesAnyPattern("src/index.ts", ["src/generated/**"])).toBe(false);
  });
});
