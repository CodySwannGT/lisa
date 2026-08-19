/**
 * Every ShellCheck directive Lisa ships must be one ShellCheck can parse.
 *
 * A directive is `key=value` pairs and nothing else. Trailing prose —
 * `# shellcheck disable=SC2254 -- the pattern is a glob on purpose.` — is read
 * as further directive keys, and the consequences are worse than a lost
 * comment. MEASURED with ShellCheck 0.11.0 against
 * `all/copy-overwrite/scripts/lisa-hooks/block-managed-file-edits.sh`:
 *
 *   line 147: SC1073 (error): Couldn't parse this shellcheck directive.
 *   line 147: SC1072 (error): Expected '=' after directive key.
 *
 * ShellCheck then STOPS — everything after line 147 goes unchecked, and the
 * SC2254 the line was written to suppress is not suppressed either. A
 * suppression comment that disables the linter it addresses is the failure
 * class this file exists to make impossible to reintroduce, and it is not one
 * `bash -n` can see: the shell parses the file perfectly.
 *
 * The check is static rather than a ShellCheck invocation on purpose. A test
 * that only runs when a binary happens to be installed reports "nothing found"
 * on every machine that lacks it, which is indistinguishable from a pass.
 * @module tests/unit/hooks/shellcheck-directives
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Trees whose every shell script, at any depth, is audited. */
const AUDITED_TREES = [
  "all",
  "expo",
  "nestjs",
  "cdk",
  "rails",
  "typescript",
  "harper-fabric",
  "phaser",
  "plugins",
  "scripts",
  "src",
];

/** Directories never worth walking. */
const SKIP = new Set(["node_modules", "dist", "coverage", ".git"]);

/** The word that makes a comment a directive. */
const MARKER = "shellcheck";

/**
 * The body of a ShellCheck directive line, or null if this is not one.
 *
 * String work rather than `/^\s*#\s*shellcheck\s+(.*)$/`: that pattern puts
 * three quantified whitespace groups in a row and backtracks super-linearly on
 * a line that is mostly whitespace. Acceptance is unchanged — leading
 * whitespace, `#`, optional whitespace, the marker as its own word.
 * @param text - One line of a shell script
 * @returns The trimmed directive body, or null
 */
function directiveBody(text: string): string | null {
  const comment = text.trimStart();
  if (!comment.startsWith("#")) return null;
  const afterHash = comment.slice(1).trimStart();
  if (!afterHash.startsWith(MARKER)) return null;
  const rest = afterHash.slice(MARKER.length);
  // The marker must be a whole word: `shellcheckish=1` is not a directive.
  if (rest === "" || rest.trimStart() === rest) return null;
  return rest.trim();
}

/** One `key=value` pair. ShellCheck accepts nothing else in a directive body. */
const PAIR = /^[A-Za-z][A-Za-z-]*=\S+$/u;

/**
 * Every shell script under the audited trees, recursively.
 * @param dir - Absolute directory to walk
 * @returns Absolute paths of `.sh` files
 */
function shellScripts(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap(name => {
    if (SKIP.has(name)) return [];
    const absolute = path.join(dir, name);
    if (statSync(absolute).isDirectory()) return shellScripts(absolute);
    return name.endsWith(".sh") ? [absolute] : [];
  });
}

const SCRIPTS = AUDITED_TREES.flatMap(tree =>
  shellScripts(path.join(REPO_ROOT, tree))
);

/** One directive line found in one file. */
interface Directive {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly body: string;
}

/**
 * Every ShellCheck directive in the audited trees.
 * @returns The directives, with their locations
 */
function directives(): Directive[] {
  return SCRIPTS.flatMap(absolute =>
    readFileSync(absolute, "utf-8")
      .split("\n")
      .flatMap((text, index) => {
        const body = directiveBody(text);
        if (body === null) return [];
        return [
          {
            file: path.relative(REPO_ROOT, absolute),
            line: index + 1,
            text: text.trim(),
            body,
          },
        ];
      })
  );
}

const DIRECTIVES = directives();

describe("shipped ShellCheck directives are parseable", () => {
  it("finds scripts and directives to check at all", () => {
    // Without this, deleting the walk would make every case below vacuous —
    // zero directives audited reads exactly like zero malformed ones.
    // Measured at 225 scripts and 23 directive lines when this was written; the
    // floors are deliberately well below that, because the point is to catch a
    // walk that stopped working, not to restate today's inventory.
    expect(SCRIPTS.length).toBeGreaterThan(50);
    expect(DIRECTIVES.length).toBeGreaterThan(10);
  });

  it("carries no prose inside the directive itself", () => {
    const malformed = DIRECTIVES.filter(directive =>
      directive.body.split(/\s+/u).some(token => !PAIR.test(token))
    ).map(
      directive => `${directive.file}:${directive.line}  ${directive.text}`
    );
    // Put the explanation on its own comment line ABOVE the directive. The
    // reason must survive — a bare `disable=` with no justification is the
    // other way this goes wrong — it just cannot share the line.
    expect(malformed).toEqual([]);
  });

  it("uses only directive keys ShellCheck defines", () => {
    // A typo'd key fails the same way the trailing prose did, silently.
    const known = new Set([
      "disable",
      "enable",
      "external-sources",
      "shell",
      "source",
      "source-path",
    ]);
    const unknown = DIRECTIVES.flatMap(directive =>
      directive.body
        .split(/\s+/u)
        .filter(token => PAIR.test(token))
        .map(token => token.split("=")[0])
        .filter(key => !known.has(key))
        .map(key => `${directive.file}:${directive.line}  ${key}`)
    );
    expect(unknown).toEqual([]);
  });
});
