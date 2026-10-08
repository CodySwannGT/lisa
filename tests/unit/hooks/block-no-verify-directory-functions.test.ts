/** Sourced library definitions do not execute their function bodies. */
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

const root = scratchDir("directory-library-functions");
const lib = path.join(root, "lib");
mkdirSync(lib);
script(lib, "port-helper.sh", [
  "guard_port() {",
  '  local port="$1"',
  "  read port",
  "}",
]);
script(lib, "safe.sh", ["echo safe"]);
const bypass = script(lib, "bypass.sh", ["git push --no-verify"]);
const binding = 'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"';
const SOURCE_SAFE = '. "$SCRIPT_DIR/lib/safe.sh"';
const COMPUTED_PATH_REASON = "a computed path";
const guard = sourceGuard("block-no-verify.sh");

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("block-no-verify sourced library function definitions", () => {
  it.each(["safe", "bypass"])(
    "preserves caller facts while defining functions before a %s sibling",
    name => {
      const entry = script(root, `${name}-entry.sh`, [
        binding,
        '. "$SCRIPT_DIR/lib/port-helper.sh"',
        `. "$SCRIPT_DIR/lib/${name}.sh"`,
      ]);
      const result = runGuard(guard, bash(`bash "${entry}"`));
      expect(result.status, result.stderr).toBe(
        name === "safe" ? EXIT_ALLOWED : EXIT_BLOCKED
      );
      if (name === "bypass") expect(result.stderr).toContain(bypass);
      expect(result.stderr).not.toContain("a computed path");
    }
  );

  it("does not borrow definition-time directory facts inside a future function", () => {
    const entry = script(root, "future-function.sh", [
      binding,
      'later() { . "$SCRIPT_DIR/lib/safe.sh"; }',
      'SCRIPT_DIR="$USER"',
      "later",
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(COMPUTED_PATH_REASON);
  });

  it("retains potentially exported caller functions in a new interpreter", () => {
    const entry = script(root, "exported-source-entry.sh", [
      binding,
      'source "$SCRIPT_DIR/lib/safe.sh"',
      SOURCE_SAFE,
    ]);
    const command = `source() { SCRIPT_DIR="$USER"; }; export -f source; bash "${entry}"`;
    const result = runGuard(guard, bash(command));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(COMPUTED_PATH_REASON);
  });

  it("allows a static sibling when an exported caller function is never called", () => {
    const entry = script(root, "unused-export-entry.sh", [
      binding,
      SOURCE_SAFE,
    ]);
    const command = `greet() { echo hello; }; export -f greet; bash "${entry}"`;
    const result = runGuard(guard, bash(command));
    expect(result.status, result.stderr).toBe(EXIT_ALLOWED);
  });

  it("preserves the enclosing scope after an unused inline conditional function", () => {
    const entry = script(root, "inline-conditional-function.sh", [
      "greet() { if true; then echo hello; fi; }",
      binding,
      SOURCE_SAFE,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status, result.stderr).toBe(EXIT_ALLOWED);
  });

  it("recognizes a function declared after a conditional prefix", () => {
    const entry = script(root, "conditional-function-declaration.sh", [
      'if true; then function choose { SCRIPT_DIR="$USER"; }; fi',
      binding,
      "choose",
      SOURCE_SAFE,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(COMPUTED_PATH_REASON);
  });
});
