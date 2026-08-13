/**
 * Guards the `import * as fse from "fs-extra"` namespace against members that
 * only exist under a bundler's CJS interop (issue #2482).
 *
 * `fs-extra` is CommonJS. Its own additions (`ensureDir`, `pathExists`, …) are
 * detected as named exports, but the `graceful-fs` passthroughs it re-exports
 * off `module.exports` — `readFile`, `writeFile`, `readJson` — are NOT. Under
 * real Node ESM those are `undefined` on the namespace object.
 *
 * Vitest resolves the same import through Vite's interop, which hands back the
 * default export's properties, so `fse.readFile(...)` works in every unit test
 * and throws `fse.readFile is not a function` in the shipped `dist/`. That gap
 * let a broken migration pass CI and then fail `lisa apply` for every host
 * project, taking the release pipeline with it.
 *
 * These assertions therefore probe the REAL Node ESM namespace in a child
 * process rather than the one this test file would see.
 * @module tests/unit/core/fs-extra-namespace-members
 */
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/** Members `fs-extra` exposes as genuine ESM named exports. */
const NAMESPACE_SAFE = ["copy", "ensureDir", "pathExists", "remove"] as const;

/** Members reachable only via the default export, never off the namespace. */
const NAMESPACE_UNSAFE = ["readFile", "writeFile", "readJson"] as const;

/**
 * Resolve `typeof` for each member on the real Node ESM namespace.
 * @param members - fs-extra member names to probe.
 * @returns Member name to its `typeof` as Node sees it.
 */
function typesUnderNodeEsm(members: readonly string[]): Record<string, string> {
  const script = `
    import * as fse from "fs-extra";
    const out = {};
    for (const name of ${JSON.stringify(members)}) out[name] = typeof fse[name];
    process.stdout.write(JSON.stringify(out));
  `;
  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
    })
  ) as Record<string, string>;
}

describe("fs-extra ESM namespace members", () => {
  it("exposes fs-extra's own helpers on the namespace", () => {
    expect(typesUnderNodeEsm(NAMESPACE_SAFE)).toEqual({
      copy: "function",
      ensureDir: "function",
      pathExists: "function",
      remove: "function",
    });
  });

  it("does NOT expose the graceful-fs passthroughs on the namespace", () => {
    // Not a wish — a description. Calling any of these as `fse.<name>()` in
    // src/ ships a TypeError that no unit test can see, so this test states the
    // constraint explicitly and fails loudly if a future fs-extra changes it.
    expect(typesUnderNodeEsm(NAMESPACE_UNSAFE)).toEqual({
      readFile: "undefined",
      writeFile: "undefined",
      readJson: "undefined",
    });
  });

  it("is not contradicted by the interop this very test file runs under", async () => {
    // Proof the gap is real: the bundler-resolved namespace disagrees with the
    // Node-resolved one above. This is why `fse.readFile` passed CI.
    const bundled = (await import("fs-extra")) as unknown as Record<
      string,
      unknown
    >;
    expect(typeof bundled["readFile"]).toBe("function");
    expect(typesUnderNodeEsm(["readFile"])["readFile"]).toBe("undefined");
  });
});
