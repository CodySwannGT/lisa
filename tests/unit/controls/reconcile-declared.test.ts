/**
 * What makes a command a hook runs "declared" (CodySwannGT/lisa#5000).
 *
 * A hook that runs twenty commands must not produce twenty findings when the
 * register lists them, and must produce one for each it does not. The rule
 * is narrow on purpose: a command is declared when a register entry's check
 * at the same moment is that command, word for word.
 */
import { describe, expect, it } from "vitest";

import { declaredBy } from "../../../src/controls/reconcile-declared.js";
import type { ControlRegister } from "../../../src/controls/register-types.js";
import {
  F_MIXED_GATES,
  F_PAVED_GATES,
  evidenceAt,
} from "../../helpers/control-register.js";
import { registerForGates } from "./support/executor-fixtures.js";

const COMMIT = "commit";
const RUFF = ["ruff", "check", "."];

/**
 * The register of F-mixed: a linter per folder at commit, a type check at
 * push.
 * @returns The register
 */
function mixed(): Promise<ControlRegister> {
  return registerForGates(F_MIXED_GATES);
}

describe("a command a register entry declares", () => {
  it("is declared by the entry whose command at that moment it is", async () => {
    const register = await mixed();

    expect(declaredBy(register, COMMIT, RUFF)).toEqual(["code-style@api"]);
    expect(declaredBy(register, COMMIT, ["npm", "run", "lint"])).toEqual([
      "code-style@web",
    ]);
    expect(declaredBy(register, "push", ["npx", "tsc", "--noEmit"])).toEqual([
      "type-correctness@web",
    ]);
  });

  it("is not declared at a moment the entry is not checked at", async () => {
    expect(declaredBy(await mixed(), "push", RUFF)).toEqual([]);
  });

  it("is not declared when any word differs", async () => {
    const register = await mixed();

    expect(declaredBy(register, COMMIT, ["ruff", "check", "src"])).toEqual([]);
    expect(declaredBy(register, COMMIT, ["ruff", "check"])).toEqual([]);
    expect(declaredBy(register, COMMIT, [...RUFF, "--fix"])).toEqual([]);
  });

  it("is declared by a task entry whose task command it is", async () => {
    const register = await registerForGates(F_PAVED_GATES);

    expect(declaredBy(register, COMMIT, ["npm", "run", "lint:staged"])).toEqual(
      ["code-style@."]
    );
  });

  it("names every entry that declares the same command", async () => {
    const register = await registerForGates({
      "code-style": {
        commit: "required",
        parts: ["api", "jobs"].map(scope => ({
          command: RUFF,
          evidence: evidenceAt("api/ruff.toml"),
          scope,
        })),
      },
    });

    expect(declaredBy(register, COMMIT, RUFF)).toEqual([
      "code-style@api",
      "code-style@jobs",
    ]);
  });
});
