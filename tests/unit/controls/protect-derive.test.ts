/**
 * The checks a pull request must pass, derived from the control register.
 *
 * Only an entry that is authoritative and required on a pull request asks the
 * hosting platform for anything, and the check names come from the shipped
 * gate registry's `contextsFor`, called on those entries' gates alone
 * (CodySwannGT/lisa#4993).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { loadCriterionCatalogue } from "../../../src/controls/catalogue.js";
import {
  checkStates,
  deriveRequiredChecks,
  droppedChecks,
  type DerivedProtection,
} from "../../../src/controls/protect-derive.js";
import { NO_WORKFLOW_FOLDER } from "../../../src/controls/protect-held.js";
import {
  loadProtectionModules,
  type ProtectionModules,
} from "../../../src/controls/protect-modules.js";
import { buildControlRegister } from "../../../src/controls/register.js";
import {
  F_MIXED_GATES,
  F_PAVED_GATES,
  declarationOf,
  type GatesBlock,
} from "../../helpers/control-register.js";

const LINT = "🔍 Quality Checks / 🧹 Lint";
const UNIT_TESTS = "🔍 Quality Checks / 🧪 Run Unit Tests";
const SECURITY = "🔍 Quality Checks / 🔒 Security Scan";
const REVIEW = "Review Bot";
const CODE_STYLE = "code-style";

/** What may hold a derived check back. */
interface Held {
  readonly dropped?: ReadonlySet<string>;
  readonly canReportWorkflowChecks?: boolean;
}

/** The shipped scripts, loaded once for the suite. */
const shipped: { modules?: ProtectionModules } = {};

/**
 * Derive the required checks of a gates block.
 * @param block - The `gates` block, with or without a `runner`
 * @param extra - Other inputs of the derivation
 * @returns What the register asks of merge protection
 */
function derive(block: GatesBlock, extra: Held = {}): DerivedProtection {
  const modules = shipped.modules as ProtectionModules;
  const declaration = declarationOf(block);
  const built = buildControlRegister({
    declaration,
    registry: modules.gates as never,
    catalogue: loadCriterionCatalogue(),
  });
  if (built.problems !== null) throw new Error(built.problems.join(" | "));
  return deriveRequiredChecks({
    register: built.register,
    gates: declaration.gates,
    modules,
    ...extra,
  });
}

beforeAll(async () => {
  shipped.modules = await loadProtectionModules();
});

describe("required checks derived from the control register", () => {
  it("gives a gate with several parts one check, shared by each part's entry", () => {
    const derived = derive(F_MIXED_GATES);

    expect(derived.checks).toEqual([
      {
        context: LINT,
        awaited: false,
        appId: null,
        gates: [CODE_STYLE],
        held: null,
      },
    ]);
    expect(
      derived.entries.map(({ entry, checks }) => [entry.id, checks])
    ).toEqual([
      ["code-style@api", [LINT]],
      ["code-style@web", [LINT]],
    ]);
  });

  it("leaves out an entry that is not required on a pull request", () => {
    const derived = derive(F_MIXED_GATES);

    expect(derived.entries.map(({ entry }) => entry.gate)).not.toContain(
      "type-correctness"
    );
  });

  it("leaves out an advisory entry even when it is required on a pull request", () => {
    const derived = derive({
      ...F_MIXED_GATES,
      "test-correctness": {
        "pull-request": "required",
        tier: "advisory",
        parts: [{ scope: "web", command: ["npm", "test"] }],
      },
    });

    expect(derived.checks.map(check => check.context)).toEqual([LINT]);
    expect(Object.keys(derived.gates)).toEqual([CODE_STYLE]);
  });

  it("leaves out an entry that is only optional on a pull request", () => {
    const derived = derive({
      [CODE_STYLE]: {
        "pull-request": "optional",
        tier: "authoritative",
        parts: [{ scope: ".", command: ["ruff", "check", "."] }],
      },
    });

    expect(derived.entries).toEqual([]);
    expect(derived.checks).toEqual([]);
  });

  it("keeps an awaited check's own name and the app it is pinned to", () => {
    const derived = derive(F_PAVED_GATES);

    expect(derived.checks.map(check => check.context)).toEqual(
      [REVIEW, SECURITY, UNIT_TESTS, LINT].sort((left, right) =>
        left < right ? -1 : 1
      )
    );
    expect(derived.checks.find(check => check.context === REVIEW)).toEqual({
      context: REVIEW,
      awaited: true,
      appId: 4242,
      gates: ["code-review"],
      held: null,
    });
  });

  it("holds back a pipeline check when nothing in the repository can report it", () => {
    const derived = derive(F_PAVED_GATES, { canReportWorkflowChecks: false });

    expect(
      derived.checks.map(check => [check.context, check.held])
    ).toContainEqual([LINT, "not-ready"]);
    expect(derived.checks.find(check => check.context === REVIEW)?.held).toBe(
      null
    );
  });

  it("holds back a check the configuration says never to require", () => {
    const dropped = droppedChecks({
      github: { rulesets: { dropRequiredChecks: [LINT, 7] } },
    });

    const derived = derive(F_MIXED_GATES, { dropped });

    expect(derived.checks[0]?.held).toBe("excluded");
  });
});

describe("where each derived check stands", () => {
  it("is unknown, never missing, when the platform was not read", () => {
    const { checks } = derive(F_MIXED_GATES);

    expect(checkStates(checks, null).map(check => check.state)).toEqual([
      "unknown",
    ]);
    expect(checkStates(checks, new Set()).map(check => check.state)).toEqual([
      "missing",
    ]);
    expect(
      checkStates(checks, new Set([LINT])).map(check => check.state)
    ).toEqual(["required"]);
  });

  it("keeps the reason a check is held back when the platform was not read", () => {
    const { checks } = derive(F_MIXED_GATES, {
      canReportWorkflowChecks: false,
    });

    expect(checkStates(checks, null)[0]).toEqual({
      context: LINT,
      source: "workflow",
      app_id: null,
      gates: [CODE_STYLE],
      state: "not-ready",
      detail: NO_WORKFLOW_FOLDER.detail,
    });
  });
});
