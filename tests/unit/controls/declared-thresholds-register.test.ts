/**
 * Every threshold the control register carries is one the threshold check
 * holds (CodySwannGT/lisa#4985).
 *
 * The requirement is written about the register: a change that lowers a
 * threshold parameter in it must fail. The register is generated from the
 * `gates` declaration, and the threshold check reads the declaration, so the
 * two have to agree on what a threshold is and what it is called. This suite
 * builds a register and reads the same declaration with the check's own
 * reader, and fails when either sees a threshold the other does not.
 */
import { describe, expect, it } from "vitest";

import {
  declaredThresholdKey,
  extractDeclaredThresholds,
} from "../../../plugins/src/base/hooks/threshold-ratchet-families.mjs";
import {
  F_MIXED_GATES,
  F_NONE_GATES,
  F_PAVED_GATES,
  OWNER,
  type GatesBlock,
} from "../../helpers/control-register.js";
import { registerOf } from "./support/register-build.js";

/** One threshold, as either side names it. */
interface Threshold {
  readonly key: string;
  readonly value: unknown;
  readonly direction: string;
}

/** A declaration with thresholds in two gates, two folders and both directions. */
const SEVERAL: GatesBlock = {
  "code-style": {
    commit: "required",
    owner: OWNER,
    parts: [
      {
        scope: "web",
        command: ["npm", "run", "lint"],
        parameters: {
          "max-warnings": { value: 0, direction: "ceiling" },
          config: { value: "strict" },
        },
      },
      { scope: "api", command: ["ruff", "check", "."] },
    ],
  },
  "coverage-adequacy": {
    "pull-request": "required",
    owner: OWNER,
    parts: [
      {
        scope: "api",
        command: ["python", "-m", "pytest", "--cov"],
        parameters: { "minimum-coverage": { value: 80, direction: "floor" } },
      },
      {
        scope: "web",
        command: ["npm", "test"],
        parameters: {
          "minimum-coverage": { value: 60, direction: "floor" },
          "minimum-branches": { value: 55.5, direction: "floor" },
          retries: { value: 2 },
        },
      },
    ],
  },
};

/**
 * The thresholds a register carries, named the way the check names them.
 * @param block - The `gates` block
 * @returns The thresholds, ordered by name
 */
async function inTheRegister(block: GatesBlock): Promise<Threshold[]> {
  const register = await registerOf(block);
  return register.entries
    .flatMap(entry =>
      Object.entries(entry.parameters).flatMap(([name, parameter]) =>
        parameter.direction === undefined
          ? []
          : [
              {
                key: declaredThresholdKey(entry.gate, entry.scope, name),
                value: parameter.value,
                direction: parameter.direction,
              },
            ]
      )
    )
    .sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * The thresholds the check holds for the same declaration.
 * @param block - The `gates` block
 * @returns The thresholds, ordered by name
 */
function heldByTheCheck(block: GatesBlock): Threshold[] {
  return extractDeclaredThresholds({ gates: block })
    .map(({ key, value, direction }) => ({ key, value, direction }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

describe("the thresholds in the control register", () => {
  it("are exactly the ones the threshold check holds", async () => {
    const register = await inTheRegister(SEVERAL);

    expect(register.map(threshold => threshold.key)).toEqual([
      "gates.code-style.parts[web].parameters.max-warnings",
      "gates.coverage-adequacy.parts[api].parameters.minimum-coverage",
      "gates.coverage-adequacy.parts[web].parameters.minimum-branches",
      "gates.coverage-adequacy.parts[web].parameters.minimum-coverage",
    ]);
    expect(heldByTheCheck(SEVERAL)).toEqual(register);
  });

  it.each([
    ["no supported project type", F_NONE_GATES, 1],
    ["two parts in separate folders", F_MIXED_GATES, 0],
    ["one supported project type and no parts", F_PAVED_GATES, 0],
  ])(
    "agree for the repository with %s",
    async (_fixture, block, thresholds) => {
      const register = await inTheRegister(block);

      expect(register).toHaveLength(thresholds);
      expect(heldByTheCheck(block)).toEqual(register);
    }
  );
});
