/** Native reach controls for statically provable script-directory bindings. */
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  bash,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  runGuard,
  scratchDir,
  script,
  sourceGuard,
} from "./support/executed-script-reach.js";

const GUARD = sourceGuard("block-no-verify.sh");
const root = scratchDir("static-script-directory");
const libraries = path.join(root, "lib");
mkdirSync(libraries);
const safe = script(libraries, "safe.sh", ["echo safe"]);
const bypass = script(libraries, "bypass.sh", [
  'git commit --no-verify -m "fixture"',
]);
const SOURCE_SAFE = '. "$SCRIPT_DIR/lib/safe.sh"';
const COMPUTED_PATH_REASON = "a computed path";
const idioms = [
  [
    "canonical BASH_SOURCE",
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
  ],
  ["executed script $0", 'SCRIPT_DIR="$(dirname "$0")"'],
  ["BASH_SOURCE dirname substitution", 'SCRIPT_DIR="${BASH_SOURCE[0]%/*}"'],
] as const;

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("block-no-verify script directory reach", () => {
  it.each(idioms)(
    "allows an inspected safe sibling through %s",
    (_label, assignment) => {
      const entry = script(root, "safe-entry.sh", [assignment, SOURCE_SAFE]);
      const result = runGuard(GUARD, bash(`bash "${entry}"`));
      expect(result.status, result.stderr).toBe(EXIT_ALLOWED);
      expect(safe).toContain(libraries);
    }
  );

  it.each(idioms)(
    "inspects and refuses a real sibling bypass through %s",
    (_label, assignment) => {
      const entry = script(root, "bypass-entry.sh", [
        assignment,
        'source "$SCRIPT_DIR/lib/bypass.sh"',
      ]);
      const result = runGuard(GUARD, bash(`bash "${entry}"`));
      expect(result.status).toBe(EXIT_BLOCKED);
      expect(result.stderr).toContain(bypass);
      expect(result.stderr).not.toContain(COMPUTED_PATH_REASON);
    }
  );

  it.each([
    'SCRIPT_DIR="$USER"',
    'SCRIPT_DIR="$(some_dynamic_command)"',
    `${idioms[0][1]}\nSCRIPT_DIR="$USER"`,
  ])(
    "continues refusing an unproved or overwritten directory binding",
    assignment => {
      const entry = script(root, "dynamic-entry.sh", [assignment, SOURCE_SAFE]);
      const result = runGuard(GUARD, bash(`bash "${entry}"`));
      expect(result.status).toBe(EXIT_BLOCKED);
      expect(result.stderr).toContain(COMPUTED_PATH_REASON);
    }
  );
  it("uses a sourced file's BASH_SOURCE directory for nested safe siblings", () => {
    script(libraries, "nested-safe.sh", [
      idioms[0][1],
      '. "$SCRIPT_DIR/safe.sh"',
    ]);
    const entry = script(root, "nested-entry.sh", [
      idioms[0][1],
      '. "$SCRIPT_DIR/lib/nested-safe.sh"',
    ]);
    const result = runGuard(GUARD, bash(`bash "${entry}"`));
    expect(result.status, result.stderr).toBe(EXIT_ALLOWED);
  });

  it("inspects a bypass reached through a sourced file's own directory", () => {
    script(libraries, "nested-bypass.sh", [
      idioms[0][1],
      '. "$SCRIPT_DIR/bypass.sh"',
    ]);
    const entry = script(root, "nested-bypass-entry.sh", [
      idioms[0][1],
      '. "$SCRIPT_DIR/lib/nested-bypass.sh"',
    ]);
    const result = runGuard(GUARD, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(bypass);
    expect(result.stderr).not.toContain(COMPUTED_PATH_REASON);
  });

  it("does not treat a sourced file's $0 as that file's BASH_SOURCE", () => {
    script(libraries, "zero-entry.sh", [
      idioms[1][1],
      '. "$SCRIPT_DIR/lib/bypass.sh"',
    ]);
    const entry = script(root, "zero-parent.sh", [
      idioms[0][1],
      '. "$SCRIPT_DIR/lib/zero-entry.sh"',
    ]);
    const result = runGuard(GUARD, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(bypass);
    expect(result.stderr).not.toContain("a script that does not exist");
  });

  it.each([
    `if false; then ${idioms[0][1]}; fi`,
    `choose_directory() { ${idioms[0][1]}; }`,
    `(${idioms[0][1]})`,
    `echo '${idioms[0][1]}'`,
  ])(
    "does not authorize a directory assignment that did not run",
    assignment => {
      const entry = script(root, "unexecuted-binding.sh", [
        assignment,
        SOURCE_SAFE,
      ]);
      const result = runGuard(GUARD, bash(`bash "${entry}"`));
      expect(result.status).toBe(EXIT_BLOCKED);
      expect(result.stderr).toContain(COMPUTED_PATH_REASON);
    }
  );

  it.each([
    `${idioms[0][1]}\nunset SCRIPT_DIR`,
    `${idioms[0][1]}\nread SCRIPT_DIR`,
    `${idioms[0][1]}\neval 'SCRIPT_DIR="$USER"'`,
    `${idioms[0][1]}\nif true; then SCRIPT_DIR="$USER"; fi`,
  ])("invalidates a directory binding after possible mutation", assignment => {
    const entry = script(root, "mutated-binding.sh", [assignment, SOURCE_SAFE]);
    const result = runGuard(GUARD, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(COMPUTED_PATH_REASON);
  });

  it("does not expand a single-quoted directory variable", () => {
    const literal = path.join(root, "$SCRIPT_DIR", "lib");
    mkdirSync(literal, { recursive: true });
    script(literal, "safe.sh", ["git push --no-verify"]);
    const entry = script(root, "literal-variable.sh", [
      idioms[0][1],
      ". '$SCRIPT_DIR/lib/safe.sh'",
    ]);
    const result = runGuard(GUARD, bash(`bash "${entry}"`), { cwd: root });
    expect(result.status).toBe(EXIT_BLOCKED);
    // A conservative unresolved refusal is also safe. The inspected safe
    // library must never replace the literal directory the shell uses.
    expect(result.stderr).toMatch(/computed path|bypasses git/);
  });

  it("invalidates a caller binding when a sourced library changes it", () => {
    const other = path.join(root, "other");
    mkdirSync(other, { recursive: true });
    script(other, "safe.sh", ["git push --no-verify"]);
    script(libraries, "mutation.sh", [`SCRIPT_DIR="${other}"`]);
    const entry = script(root, "library-mutation.sh", [
      idioms[0][1],
      '. "$SCRIPT_DIR/lib/mutation.sh"',
      '. "$SCRIPT_DIR/safe.sh"',
    ]);
    const result = runGuard(GUARD, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toMatch(/computed path|bypasses git/);
  });
});
