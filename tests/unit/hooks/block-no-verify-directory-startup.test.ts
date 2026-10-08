/** Native controls for inherited and explicit shell startup context. */
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

const root = scratchDir("directory-startup");
const lib = path.join(root, "lib");
mkdirSync(lib);
script(lib, "safe.sh", ["echo safe"]);
const binding = 'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"';
const SHADOW_DIRNAME = 'dirname() { echo "$USER"; }';
const sourceSafe = '. "$SCRIPT_DIR/lib/safe.sh"';
const computed = "a computed path";
const guard = sourceGuard("block-no-verify.sh");

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("block-no-verify ordered shell startup context", () => {
  it.each(["env BASH_ENV=", "BASH_ENV="])(
    "retains a nested startup prefix: %s",
    prefix => {
      const startup = script(root, "nested-startup.sh", [SHADOW_DIRNAME]);
      const entry = script(root, "nested-startup-entry.sh", [
        binding,
        sourceSafe,
      ]);
      const result = runGuard(
        guard,
        bash(`${prefix}"${startup}" bash -c '. "${entry}"'`)
      );
      expect(result.status).toBe(EXIT_BLOCKED);
      expect(result.stderr).toContain(computed);
    }
  );

  it.each(["eval", "bash -c"])(
    "retains caller command shadowing inside %s",
    dispatcher => {
      const entry = script(root, "caller-shadowed-entry.sh", [
        binding,
        sourceSafe,
      ]);
      const result = runGuard(
        guard,
        bash(
          `dirname() { echo "$USER"; }; export -f dirname; ${dispatcher} '. "${entry}"'`
        )
      );
      expect(result.status).toBe(EXIT_BLOCKED);
      expect(result.stderr).toContain(computed);
    }
  );

  it("does not prove a directory under an uninspected shell startup prefix", () => {
    const startup = script(root, "startup.sh", [SHADOW_DIRNAME]);
    const entry = script(root, "startup-entry.sh", [binding, sourceSafe]);
    const result = runGuard(
      guard,
      bash(`env BASH_ENV="${startup}" bash "${entry}"`)
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(computed);
  });

  it.each(["--rcfile", "--init-file"])(
    "does not trust an interactive %s startup",
    option => {
      const startup = script(root, "interactive-startup.sh", [SHADOW_DIRNAME]);
      const entry = script(root, "interactive-entry.sh", [binding, sourceSafe]);
      const result = runGuard(
        guard,
        bash(`bash ${option} "${startup}" -i "${entry}"`)
      );
      expect(result.status).toBe(EXIT_BLOCKED);
      expect(result.stderr).toContain(computed);
    }
  );

  it.each([false, true])(
    "does not trust login startup through a nested payload: %s",
    nested => {
      const entry = script(root, "login-entry.sh", [binding, sourceSafe]);
      const command = nested
        ? `bash -lc 'bash "${entry}"'`
        : `bash -l "${entry}"`;
      const result = runGuard(guard, bash(command));
      expect(result.status).toBe(EXIT_BLOCKED);
      expect(result.stderr).toContain(computed);
    }
  );

  it("retains the proof when interactive and login startup are explicitly disabled", () => {
    const entry = script(root, "no-startup-entry.sh", [binding, sourceSafe]);
    const result = runGuard(
      guard,
      bash(`bash --norc --noprofile -il "${entry}"`)
    );
    expect(result.status, result.stderr).toBe(EXIT_ALLOWED);
  });

  it("does not execute a startup prefix merely because a file is sourced", () => {
    const entry = script(root, "startup-source.sh", [binding, sourceSafe]);
    const result = runGuard(guard, bash(`BASH_ENV="$USER" . "${entry}"`));
    expect(result.status, result.stderr).toBe(EXIT_ALLOWED);
  });
});
