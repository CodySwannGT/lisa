/** Native shell reach at control-flow and binding-mutation boundaries. */
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

const root = scratchDir("directory-flow");
const lib = path.join(root, "lib");
mkdirSync(lib);
script(lib, "safe.sh", ["echo safe"]);
const bypass = script(lib, "bypass.sh", ["git push --no-verify"]);
const binding = 'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"';
const sourceSafe = '. "$SCRIPT_DIR/lib/safe.sh"';
const guard = sourceGuard("block-no-verify.sh");
const COMPUTED_PATH_REASON = "a computed path";

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("block-no-verify ordered directory facts", () => {
  it("follows a transitive directory binding and braced source operand", () => {
    const entry = script(root, "derived.sh", [
      binding,
      'LIB_DIR="$SCRIPT_DIR/lib"',
      '. "${LIB_DIR}/safe.sh"',
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status, result.stderr).toBe(EXIT_ALLOWED);
  });

  it("resolves a relative entry from the actual known working directory", () => {
    script(root, "relative.sh", [binding, sourceSafe]);
    const result = runGuard(guard, bash("bash relative.sh"), {
      cwd: root,
      env: { CDPATH: "" },
    });
    expect(result.status, result.stderr).toBe(EXIT_ALLOWED);
  });

  it.each(["safe", "bypass"])(
    "inspects a %s sibling sourced on the then line",
    name => {
      const entry = script(root, `conditional-${name}.sh`, [
        binding,
        `if true; then . "$SCRIPT_DIR/lib/${name}.sh"; fi`,
      ]);
      const result = runGuard(guard, bash(`bash "${entry}"`));
      expect(result.status, result.stderr).toBe(
        name === "safe" ? EXIT_ALLOWED : EXIT_BLOCKED
      );
      if (name === "bypass") expect(result.stderr).toContain(bypass);
    }
  );

  it("does not promote a binding from a conditional source", () => {
    const initialize = script(root, "initialize.sh", [binding]);
    const entry = script(root, "conditional-binding.sh", [
      `if false; then . "${initialize}"; fi`,
      sourceSafe,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(COMPUTED_PATH_REASON);
  });

  it("keeps the outer conditional scope after an inline nested if closes", () => {
    const entry = script(root, "nested-conditional.sh", [
      "if false; then if true; then :; fi",
      binding,
      "fi",
      sourceSafe,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(COMPUTED_PATH_REASON);
  });

  it("invalidates a binding after calling a function that changes it", () => {
    const entry = script(root, "function-mutation.sh", [
      'choose_directory() { SCRIPT_DIR="$USER"; }',
      binding,
      "choose_directory",
      sourceSafe,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(COMPUTED_PATH_REASON);
  });

  it("allows a directory idiom after an unrelated function definition", () => {
    const entry = script(root, "ordinary-function.sh", [
      "greet() { echo hello; }",
      binding,
      sourceSafe,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status, result.stderr).toBe(EXIT_ALLOWED);
  });

  it("does not trust dirname after a shell function shadows it", () => {
    const entry = script(root, "shadowed-dirname.sh", [
      'dirname() { echo "$USER"; }',
      binding,
      sourceSafe,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(COMPUTED_PATH_REASON);
  });

  it("does not promote an assignment printed as heredoc data", () => {
    const entry = script(root, "heredoc-binding.sh", [
      "cat <<'PRINTED'",
      binding,
      "PRINTED",
      sourceSafe,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(COMPUTED_PATH_REASON);
  });

  it.each(["cd", "pushd", "popd"])(
    "discards a relative directory fact after %s",
    command => {
      script(root, "changed-cwd.sh", [
        ...(command === "popd" ? ['pushd "$USER"', `pushd "${root}"`] : []),
        'SCRIPT_DIR="$(dirname "$0")"',
        command === "popd" ? "popd" : `${command} "$USER"`,
        sourceSafe,
      ]);
      const result = runGuard(guard, bash("bash changed-cwd.sh"), {
        cwd: root,
      });
      expect(result.status).toBe(EXIT_BLOCKED);
      expect(result.stderr).toContain(COMPUTED_PATH_REASON);
    }
  );

  it("retains an absolute directory fact after a literal cd", () => {
    const entry = script(root, "absolute-after-cd.sh", [
      binding,
      `cd "${lib}"`,
      sourceSafe,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status, result.stderr).toBe(EXIT_ALLOWED);
  });

  it("recognizes a cwd change in a negated error-handling condition", () => {
    script(root, "negated-cd.sh", [
      'SCRIPT_DIR="$(dirname "$0")"',
      `if ! cd "${lib}"; then exit 1; fi`,
      sourceSafe,
    ]);
    const result = runGuard(guard, bash("bash negated-cd.sh"), { cwd: root });
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(COMPUTED_PATH_REASON);
  });

  it("inspects the script run by a negated source command", () => {
    const entry = script(root, "negated-source.sh", [
      binding,
      '! . "$SCRIPT_DIR/lib/bypass.sh"',
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(bypass);
  });

  it("does not read a quoted exclamation executable name as shell negation", () => {
    const entry = script(root, "quoted-exclamation.sh", [
      binding,
      '"!" read SCRIPT_DIR',
      sourceSafe,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status, result.stderr).toBe(EXIT_ALLOWED);
  });

  it.each(["(( SCRIPT_DIR++ ))", 'SCRIPT_DIR[0]="$USER"'])(
    "discards facts after arithmetic or array mutation: %s",
    mutation => {
      const entry = script(root, "indirect-mutation.sh", [
        binding,
        mutation,
        sourceSafe,
      ]);
      const result = runGuard(guard, bash(`bash "${entry}"`));
      expect(result.status).toBe(EXIT_BLOCKED);
      expect(result.stderr).toContain(COMPUTED_PATH_REASON);
    }
  );

  it("does not prove dirname after changing command lookup", () => {
    const entry = script(root, "changed-lookup.sh", [
      'PATH="$USER"',
      binding,
      sourceSafe,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(COMPUTED_PATH_REASON);
  });

  it("retains an already proven absolute binding after changing PATH", () => {
    const entry = script(root, "proven-before-lookup.sh", [
      binding,
      'PATH="$USER"',
      sourceSafe,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status, result.stderr).toBe(EXIT_ALLOWED);
  });

  it("does not infer a relative canonical cd through an env CDPATH prefix", () => {
    script(lib, "env-relative.sh", [binding, '. "$SCRIPT_DIR/safe.sh"']);
    const result = runGuard(
      guard,
      bash('env CDPATH="$USER" bash lib/env-relative.sh'),
      { cwd: root, env: { CDPATH: "" } }
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(COMPUTED_PATH_REASON);
  });
});
