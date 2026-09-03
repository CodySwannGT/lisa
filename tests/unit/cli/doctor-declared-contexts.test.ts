/**
 * The operator-facing line for declaration-versus-ruleset drift.
 *
 * The machine payload carries the whole comparison; this is the sentence
 * somebody reads without asking for JSON, so what it must never say matters as
 * much as what it says. It must not tell an operator to delete a required
 * check, and it must not report a comparison it did not make as agreement.
 * @module tests/unit/cli/doctor-declared-contexts
 */
import { describe, expect, it } from "vitest";

import { classifyDeclarationDrift } from "../../../src/core/gate-declaration-drift.js";
import {
  checkDeclaredContexts,
  declaredContextsCheck,
} from "../../../src/cli/doctor-declared-contexts.js";
import { makeProject } from "./gate-report-fixtures.js";

const WORKFLOW = "🔍 Quality Checks";
const SECURITY = `${WORKFLOW} / 🔒 Security Scan`;
const TEMPLATES = "ruleset-templates";
const TEMPLATE_FILE = "typescript/github-rulesets/quality-checks.json";
const UNDECLARED = "not-declared";
const DEPENDENCY_VULNERABILITY = "dependency-vulnerability";

/**
 * A comparison with one enforced context in a chosen declaration state.
 * @param declaration - What the settings file says
 * @returns The comparison
 */
function withDeclaration(
  declaration: "required" | "optional" | "off" | "not-declared"
): ReturnType<typeof classifyDeclarationDrift> {
  return classifyDeclarationDrift({
    surface: TEMPLATES,
    owners: new Map([
      [
        SECURITY,
        {
          gateId: DEPENDENCY_VULNERABILITY,
          declaration,
          legalAtMerge: true,
          retired: null,
          awaitedInstead: null,
        },
      ],
    ]),
    enforced: [
      {
        context: SECURITY,
        ruleset: "quality checks",
        source: TEMPLATE_FILE,
      },
    ],
  });
}

/**
 * The same comparison, for a gate whose declaration awaits a signal instead.
 * @returns The comparison
 */
function withAwaitedElsewhere(): ReturnType<typeof classifyDeclarationDrift> {
  return classifyDeclarationDrift({
    surface: TEMPLATES,
    owners: new Map([
      [
        SECURITY,
        {
          gateId: DEPENDENCY_VULNERABILITY,
          declaration: "required" as const,
          legalAtMerge: true,
          retired: null,
          awaitedInstead: "Snyk",
        },
      ],
    ]),
    enforced: [
      {
        context: SECURITY,
        ruleset: "quality checks",
        source: TEMPLATE_FILE,
      },
    ],
  });
}

describe("declaredContextsCheck", () => {
  it("warns, rather than passing, on a context the declaration awaits elsewhere", () => {
    // The verdict membership this line acts on is asked of the comparator. A
    // hand-copied list here left a new verdict reported in the payload and
    // scored `ok` on the line an operator actually reads.
    const check = declaredContextsCheck(withAwaitedElsewhere());

    expect(check.status).toBe("warn");
    expect(check.detail).toContain("Snyk");
    expect(check.detail).toContain("await:");
  });

  it("passes when every required check is asked for by a declaration", () => {
    expect(declaredContextsCheck(withDeclaration("required")).status).toBe(
      "ok"
    );
  });

  it("fails a contradiction and names the context", () => {
    const check = declaredContextsCheck(withDeclaration("off"));

    expect(check.status).toBe("fail");
    expect(check.detail).toContain(SECURITY);
  });

  it("warns an undeclared gate and tells the operator to declare it", () => {
    const check = declaredContextsCheck(withDeclaration(UNDECLARED));

    expect(check.status).toBe("warn");
    expect(check.detail).toContain("dependency-vulnerability");
    expect(check.detail).toContain("Do NOT remove the required check");
  });

  it("warns an optional declaration without claiming nothing declares it", () => {
    const check = declaredContextsCheck(withDeclaration("optional"));

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(
      "declares dependency-vulnerability optional"
    );
    expect(check.detail).not.toContain("which no declaration governs");
  });

  it("never tells an operator to remove a third-party required check", () => {
    const check = declaredContextsCheck(
      classifyDeclarationDrift({
        surface: TEMPLATES,
        owners: new Map(),
        enforced: [
          {
            context: "CodeRabbit",
            ruleset: "base",
            source: "all/github-rulesets/base.json",
          },
        ],
      })
    );

    expect(check.status).toBe("ok");
  });
});

describe("checkDeclaredContexts", () => {
  it("runs offline against a real project without reaching the network", async () => {
    const check = await checkDeclaredContexts(
      await makeProject({ config: { gates: {} } })
    );

    expect(["ok", "warn", "fail"]).toContain(check.status);
    expect(check.name).toContain("settings file");
  });
});
