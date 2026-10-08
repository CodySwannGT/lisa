/** Native controls for authority boundaries found by four independent reviews. */
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

const BYPASS_COMMAND = "git push --no-verify";
const root = scratchDir("directory-boundaries");
const lib = path.join(root, "lib");
mkdirSync(lib);
script(lib, "safe.sh", ["echo safe"]);
script(lib, "bypass.sh", [BYPASS_COMMAND]);
script(lib, "{bypass,safe}.sh", ["echo literal braces"]);
const binding = 'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"';
const sourceSafe = '. "$SCRIPT_DIR/lib/safe.sh"';
const computed = "a computed path";
const guard = sourceGuard("block-no-verify.sh");
const initialize = script(root, "initialize.sh", [binding]);
const helper = script(root, "helper.sh", [sourceSafe]);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("block-no-verify parent-shell directory authority", () => {
  it.each([
    'OTHER=1 SCRIPT_DIR="$USER"',
    'if SCRIPT_DIR="$USER"; then :; fi',
    'while SCRIPT_DIR="$USER"; do break; done',
    'until SCRIPT_DIR="$USER"; do break; done',
    'for SCRIPT_DIR in "$USER"; do :; done',
    'select SCRIPT_DIR in "$USER"; do break; done',
    ': "$((SCRIPT_DIR=2))"',
    `: "'$((SCRIPT_DIR=2))'"`,
    ': "${numbers[SCRIPT_DIR=2]}"',
    "numbers[SCRIPT_DIR=2]=value",
    'shopt -s lastpipe; printf "%s\\n" "$USER" | read SCRIPT_DIR',
    `declare -i SCRIPT_DIR; ${binding}`,
    `declare -n REF=SCRIPT_DIR; ${binding}; REF="$USER"`,
    ': "$[SCRIPT_DIR=2]"',
    `declare -l SCRIPT_DIR; ${binding}`,
    `declare -u SCRIPT_DIR; ${binding}`,
    "getopts a SCRIPT_DIR -a",
    `trap 'SCRIPT_DIR="$USER"' DEBUG; ${binding}`,
    `trap 'SCRIPT_DIR="$USER"' DEBUG EXIT; ${binding}`,
    `trap 'SCRIPT_DIR="$USER"' RETURN 0; ${binding}`,
    "test -v 'numbers[SCRIPT_DIR=2]'",
    "[[ -v 'numbers[SCRIPT_DIR=2]' ]]",
    '[[ "$USER" -eq 0 ]]',
    `printf -v PATH '%s' "$USER"; ${binding}`,
    `read PATH; ${binding}`,
    `getopts a PATH -a; ${binding}`,
    `for PATH in "$USER"; do :; done; ${binding}`,
  ])("discards facts after parent-shell mutation: %s", mutation => {
    const entry = script(root, "mutation.sh", [
      "declare -a numbers",
      binding,
      mutation,
      sourceSafe,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(computed);
  });

  it.each([
    `${binding} & ${sourceSafe}`,
    `${binding} | cat; ${sourceSafe}`,
    `! {\n${binding}\n} &\n${sourceSafe}`,
    `. "${initialize}" & ${sourceSafe}`,
    `case "$USER" in no-match) ${binding} ;; esac; ${sourceSafe}`,
  ])("does not promote a binding from an unproved execution: %s", body => {
    const entry = script(root, "not-parent.sh", [body]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(computed);
  });

  it.each([
    binding,
    'SCRIPT_DIR="$(dirname "$0")"',
    'SCRIPT_DIR="${BASH_SOURCE[0]%/*}"',
  ])("does not treat a stdin redirect as a named script: %s", assignment => {
    const entry = script(root, "stdin.sh", [assignment, sourceSafe]);
    const result = runGuard(guard, bash(`bash < "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(computed);
  });

  it("rechecks a repeated source after its directory becomes unknown", () => {
    const entry = script(root, "repeated-dynamic.sh", [
      binding,
      `. "${helper}"`,
      'SCRIPT_DIR="$USER"',
      `. "${helper}"`,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(computed);
  });

  it("allows a repeated safe source within the existing inspection budget", () => {
    const entry = script(root, "repeated-safe.sh", [
      binding,
      `. "${helper}"`,
      `. "${helper}"`,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status, result.stderr).toBe(EXIT_ALLOWED);
  });

  it("inspects a repeated helper under a different proven binding", () => {
    const other = path.join(root, "other");
    mkdirSync(other);
    const otherBypass = script(other, "safe.sh", [BYPASS_COMMAND]);
    const shared = script(root, "shared.sh", ['. "$LIB_DIR/safe.sh"']);
    const entry = script(root, "repeated-proven.sh", [
      binding,
      'LIB_DIR="$SCRIPT_DIR/lib"',
      `. "${shared}"`,
      'LIB_DIR="$SCRIPT_DIR/other"',
      `. "${shared}"`,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(otherBypass);
    expect(result.stderr).not.toContain(computed);
  });

  it("retains a binding when arithmetic-looking text is single-quoted data", () => {
    const entry = script(root, "arithmetic-data.sh", [
      binding,
      "echo '$((SCRIPT_DIR=2))'",
      sourceSafe,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status, result.stderr).toBe(EXIT_ALLOWED);
  });

  it("does not inspect a brace-name decoy instead of an expanded first source", () => {
    const entry = script(root, "brace-expansion.sh", [
      binding,
      ". $SCRIPT_DIR/lib/{bypass,safe}.sh",
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(computed);
  });

  it("inspects literal braces when the source operand is quoted", () => {
    const entry = script(root, "literal-braces.sh", [
      binding,
      '. "$SCRIPT_DIR/lib/{bypass,safe}.sh"',
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status, result.stderr).toBe(EXIT_ALLOWED);
  });

  it.each(["IFS=,", "for IFS in ,; do :; done"])(
    "does not substitute a full path after %s",
    mutation => {
      const comma = path.join(root, "split.sh,tail");
      mkdirSync(path.join(comma, "lib"), { recursive: true });
      script(path.join(comma, "lib"), "safe.sh", ["echo safe"]);
      script(root, "split.sh", [BYPASS_COMMAND]);
      const entry = script(comma, "entry.sh", [
        binding,
        mutation,
        ". $SCRIPT_DIR/lib/safe.sh",
      ]);
      const result = runGuard(guard, bash(`bash "${entry}"`));
      expect(result.status).toBe(EXIT_BLOCKED);
      expect(result.stderr).toContain(computed);
    }
  );

  it.each(["RANDOM", "SECONDS", "LINENO", "PWD", "BASH_SOURCE", "_"])(
    "does not treat special shell variable %s as an ordinary directory scalar",
    name => {
      const entry = script(root, "special-variable.sh", [
        binding.replace("SCRIPT_DIR=", `${name}=`),
        `. "$${name}/lib/safe.sh"`,
      ]);
      const result = runGuard(guard, bash(`bash "${entry}"`));
      expect(result.status).toBe(EXIT_BLOCKED);
      expect(result.stderr).toContain(computed);
    }
  );

  it.each(["command", "builtin", "env"])(
    "does not look through a caller-defined %s function as a transparent wrapper",
    name => {
      const entry = script(root, "wrapper-function.sh", [
        `${name}() { SCRIPT_DIR="$USER"; }`,
        binding,
        `${name} echo safe`,
        sourceSafe,
      ]);
      const result = runGuard(guard, bash(`bash "${entry}"`));
      expect(result.status).toBe(EXIT_BLOCKED);
      expect(result.stderr).toContain(computed);
    }
  );

  it.each(["dirname", "command"])(
    "recognizes a quoted function name: %s",
    name => {
      const entry = script(root, "quoted-function.sh", [
        `function '${name}' { SCRIPT_DIR="$USER"; echo "$USER"; }`,
        binding,
        `${name} echo safe`,
        sourceSafe,
      ]);
      const result = runGuard(guard, bash(`bash "${entry}"`));
      expect(result.status).toBe(EXIT_BLOCKED);
      expect(result.stderr).toContain(computed);
    }
  );

  it.each([
    "[[ $? -eq 0 ]]",
    "[ 1 -eq 1 ]",
    "test -v numbers[0]",
    '[[ -f "$SCRIPT_DIR/lib/safe.sh" ]]',
  ])("retains facts across a read-only check: %s", check => {
    const entry = script(root, "read-only-check.sh", [
      binding,
      check,
      sourceSafe,
    ]);
    const result = runGuard(guard, bash(`bash "${entry}"`));
    expect(result.status, result.stderr).toBe(EXIT_ALLOWED);
  });

  it.each([8, 9])(
    "shares the eight-file budget across %i nested payloads",
    count => {
      const safe = path.join(lib, "safe.sh");
      const command = Array.from(
        { length: count },
        () => `bash -c 'bash "${safe}"'`
      ).join("; ");
      const result = runGuard(guard, bash(command));
      expect(result.status, result.stderr).toBe(
        count === 8 ? EXIT_ALLOWED : EXIT_BLOCKED
      );
      if (count === 9) expect(result.stderr).toContain("script-following cap");
    }
  );
});
