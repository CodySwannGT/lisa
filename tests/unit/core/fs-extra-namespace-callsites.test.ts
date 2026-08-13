/**
 * Preventive control for the `import * as fse from "fs-extra"` namespace class
 * of defect (#2482, #2487).
 *
 * `tests/unit/core/fs-extra-namespace-members.test.ts` states WHICH members the
 * namespace lacks under real Node ESM. It cannot state that no source file
 * calls one — and that is the half that actually shipped three times: once as a
 * crash that stranded seven merged PRs behind three failed Release runs, twice
 * more inside error-swallowing `catch` blocks where the resulting `TypeError`
 * replaced the error being handled and the recovery path silently did nothing.
 *
 * Unit tests are structurally blind to it: Vitest resolves `import * as fse`
 * through Vite's CJS interop and hands back the default export's properties, so
 * `fse.readFile(...)` is a function in every test and `undefined` in the
 * shipped `dist/`. No behavioral test in this suite can see the difference.
 *
 * This check therefore works on the source text instead of the behavior. It
 * reads every `fse.<member>` in the shipped trees and cross-checks it against
 * the namespace keys Node itself reports in a child process. The safe set is
 * derived at run time rather than hardcoded, so it tracks whatever `fs-extra`
 * version is installed instead of rotting into a stale allowlist.
 * @module tests/unit/core/fs-extra-namespace-callsites
 */
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

/** Repository root, resolved from this test file's location. */
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/** Trees whose code is executed by Node directly, not through a bundler. */
const SHIPPED_DIRS = ["src", "scripts"] as const;

/** Extensions Node executes as-is or that compile into `dist/`. */
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".mts", ".ts"]);

/** Matches a member access on the `fse` namespace binding. */
const FSE_MEMBER = /\bfse\.([A-Za-z0-9_$]+)/g;

/** Block comments, and line comments through end of line. */
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/**
 * Blank out comment bodies while preserving every newline, so reported line
 * numbers still point at the real line.
 *
 * Prose naming a forbidden member is not a call site — the JSDoc explaining
 * this very defect names `fse.readJson`, and a scanner that flagged it would be
 * deleted by the first person it inconvenienced.
 * @param source - File contents.
 * @returns The same text with comment characters replaced by spaces.
 */
function stripComments(source: string): string {
  return source.replace(COMMENTS, match => match.replace(/[^\n]/g, " "));
}

/** One `fse.<member>` occurrence with enough context to fix it. */
type CallSite = {
  readonly file: string;
  readonly line: number;
  readonly member: string;
};

/**
 * List every source file under a directory, recursively.
 * @param dir - Absolute directory to walk.
 * @returns Absolute paths of files with a source extension.
 */
async function listSourceFiles(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return listSourceFiles(full);
      }
      return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
    })
  );
  return nested.flat();
}

/**
 * Collect every `fse.<member>` access in the shipped trees.
 * @returns Call sites, repo-relative and line-numbered.
 */
async function collectFseCallSites(): Promise<readonly CallSite[]> {
  const files = (
    await Promise.all(
      SHIPPED_DIRS.map(dir => listSourceFiles(path.join(REPO_ROOT, dir)))
    )
  ).flat();

  const perFile = await Promise.all(
    files.map(async file => {
      const contents = await readFile(file, "utf8");
      if (!contents.includes("fse.")) {
        return [];
      }
      return stripComments(contents)
        .split("\n")
        .flatMap((text, index) =>
          [...text.matchAll(FSE_MEMBER)].map(match => ({
            file: path.relative(REPO_ROOT, file),
            line: index + 1,
            member: match[1] ?? "",
          }))
        );
    })
  );
  return perFile.flat();
}

/**
 * Read the `fs-extra` ESM namespace keys as real Node resolves them.
 * @returns Every own key on the Node-resolved namespace object.
 */
function namespaceKeysUnderNodeEsm(): ReadonlySet<string> {
  const script = `
    import * as fse from "fs-extra";
    process.stdout.write(JSON.stringify(Object.keys(fse)));
  `;
  return new Set(
    JSON.parse(
      execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      })
    ) as readonly string[]
  );
}

describe("fs-extra namespace call sites in shipped source", () => {
  it("only reaches members Node's ESM namespace actually exposes", async () => {
    const exposed = namespaceKeysUnderNodeEsm();
    const callSites = await collectFseCallSites();

    // A guard that found nothing to guard is not passing, it is unwired.
    expect(callSites.length).toBeGreaterThan(0);

    const unreachable = callSites
      .filter(site => !exposed.has(site.member))
      .map(site => `${site.file}:${site.line} — fse.${site.member}`);

    // Anything listed here is `undefined` in the shipped `dist/` and throws a
    // TypeError at run time. Import the concrete API instead — `readFile` /
    // `writeFile` from `node:fs/promises`, or `readJsonOrNull` / `writeJson`
    // from `src/utils/json-utils.ts`.
    expect(unreachable).toEqual([]);
  });
});
