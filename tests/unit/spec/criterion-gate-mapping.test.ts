/**
 * Every requirement a gate must protect names the registered gates that can
 * (CodySwannGT/lisa#4976).
 *
 * A requirement of the gate kind is only checkable if it says which gate can
 * satisfy it. Each such entry in `spec/tasc-criteria.json` therefore carries
 * `gates` — ids from `REGISTRY` in `all/copy-overwrite/scripts/lisa-gates.mjs`
 * — or an empty `gates` with a `no_gate_reason`. This suite holds the two
 * files together:
 *
 * - a gate id the registry does not have fails the suite, so renaming or
 *   retiring a gate cannot leave a requirement pointing at nothing;
 * - the schema refuses a gate-kind entry that neither names a gate nor says
 *   why there is none, and refuses a mapping on any other kind;
 * - the requirements no registered gate protects are pinned, and printed with
 *   their reasons on every run, so the list is read rather than assumed.
 *
 * The registry is imported, never copied. The suite does not pin its size:
 * `tests/unit/controls/paved-road-regression.test.ts` already does.
 *
 * A reporter that hides the output of passing tests hides the printed list.
 * Run this file with `--silent=false` to see it.
 * @module tests/unit/spec/criterion-gate-mapping
 */
import { describe, expect, it } from "vitest";

import {
  loadCatalogue,
  mentionedCriterionIds,
  type InScopeCriterion,
} from "../../helpers/criterion-catalogue.js";
import {
  gateKindCriteria,
  registeredGateIds,
  schemaErrorsWithEntry,
  unprotectedCriteria,
  unprotectedReport,
  unregisteredGates,
} from "../../helpers/criterion-gate-mapping.js";

/**
 * The gate-kind requirements the registry has no gate for. Pinned on purpose:
 * a requirement must not slip onto this list, or off it, without the change
 * being seen. Update it when a gate is registered for one of these or a
 * mapping is withdrawn.
 */
const UNPROTECTED = [
  "AC5.1",
  "AC5.2",
  "AC8.2",
  "AC8.5",
  "AC8.6",
  "AC8.8",
  "SI10",
  "UX2",
  "UX4",
];

/** Two gates the registry has, for entries and cases built by a test. */
const UNIT_TESTS = "test-correctness";
const LINT = "code-style";

/** A reason long enough to be a reason, for entries built by a test. */
const A_REASON = "No registered gate checks this.";

const catalogue = loadCatalogue();
const registered = registeredGateIds();
const gateKind = gateKindCriteria(catalogue);
const namedGates = [
  ...new Set(gateKind.flatMap(criterion => criterion.gates ?? [])),
];
const unprotected = unprotectedCriteria(gateKind);

/**
 * A gate-kind entry for the comparisons that need no real catalogue.
 * @param id - Criterion id
 * @param mapping - The entry's gates and, where it has none, its reason
 * @returns An in-scope entry of kind `gate`
 */
function gateEntry(
  id: string,
  mapping: Pick<InScopeCriterion, "gates" | "no_gate_reason">
): InScopeCriterion {
  return {
    id,
    title: `Title of ${id}`,
    in_scope: true,
    question: "Is the rule enforced?",
    kind: "gate",
    minimum_rung: "exercised",
    not_applicable_when: "never",
    ...mapping,
  };
}

/**
 * An entry with one field removed.
 * @param entry - Catalogue entry
 * @param field - Field to drop
 * @returns A copy without the field
 */
function without(entry: object, field: string): object {
  return Object.fromEntries(
    Object.entries(entry).filter(([key]) => key !== field)
  );
}

/**
 * Position of the first catalogue entry a test can break.
 * @param matches - What the entry must be
 * @returns The entry's index, or -1 when the catalogue has none
 */
function indexWhere(matches: (entry: InScopeCriterion) => boolean): number {
  return catalogue.criteria.findIndex(
    criterion => criterion.in_scope && matches(criterion)
  );
}

const mappedIndex = indexWhere(entry => (entry.gates ?? []).length > 0);
const unmappedIndex = indexWhere(entry => entry.no_gate_reason !== undefined);
const otherKindIndex = indexWhere(entry => entry.kind !== "gate");
const mapped = catalogue.criteria[mappedIndex] ?? {};
const unmapped = catalogue.criteria[unmappedIndex] ?? {};
const otherKind = catalogue.criteria[otherKindIndex] ?? {};

describe("finding a mapping to a gate the registry lacks", () => {
  const REGISTERED = [UNIT_TESTS, LINT];

  it("reports nothing when every named gate is registered", () => {
    expect(
      unregisteredGates([gateEntry("SI1", { gates: [UNIT_TESTS] })], REGISTERED)
    ).toEqual([]);
  });

  it("names the criterion and the gate when a named gate is not registered", () => {
    expect(
      unregisteredGates(
        [
          gateEntry("SI1", { gates: [UNIT_TESTS, "retired-gate"] }),
          gateEntry("SI7", { gates: [LINT] }),
        ],
        REGISTERED
      )
    ).toEqual([{ criterion: "SI1", gate: "retired-gate" }]);
  });

  it("reports nothing for an entry that names no gate", () => {
    expect(
      unregisteredGates(
        [gateEntry("SI10", { gates: [], no_gate_reason: A_REASON })],
        REGISTERED
      )
    ).toEqual([]);
  });
});

describe("every gate the catalogue names is in the registry", () => {
  it("reads a registry that has gates in it", () => {
    // Every check below compares against this list, so it is shown to be the
    // real registry first. The next test does the same for the mappings: an
    // empty registry and no mappings would otherwise agree with each other.
    expect(registered).toContain(UNIT_TESTS);
  });

  it("maps at least one requirement to a gate", () => {
    expect(namedGates).not.toEqual([]);
  });

  it("names no gate that is absent from the registry", () => {
    expect(unregisteredGates(gateKind, registered)).toEqual([]);
  });

  it("fails for each named gate if that gate leaves the registry", () => {
    const unnoticed = namedGates.filter(
      gate =>
        !unregisteredGates(
          gateKind,
          registered.filter(id => id !== gate)
        ).some(finding => finding.gate === gate)
    );

    expect(unnoticed).toEqual([]);
  });
});

describe("the schema asks for a gate mapping exactly where the kind is gate", () => {
  it("has an entry of each shape to break", () => {
    expect({
      mapped: mappedIndex >= 0,
      unmapped: unmappedIndex >= 0,
      otherKind: otherKindIndex >= 0,
    }).toEqual({ mapped: true, unmapped: true, otherKind: true });
  });

  it.each([
    ["names no gates at all", without(mapped, "gates")],
    ["names no gate and gives no reason", { ...mapped, gates: [] }],
    [
      "names a gate and also gives a reason",
      { ...mapped, no_gate_reason: A_REASON },
    ],
    ["names the same gate twice", { ...mapped, gates: [LINT, LINT] }],
    [
      "names a gate that is not shaped like a gate id",
      { ...mapped, gates: ["Lint"] },
    ],
    ["names its gates as one string", { ...mapped, gates: LINT }],
  ])("rejects a gate-kind entry that %s", (_shape, entry) => {
    expect(schemaErrorsWithEntry(catalogue, mappedIndex, entry)).not.toEqual(
      []
    );
  });

  it.each([
    ["has an empty reason", { ...unmapped, no_gate_reason: "" }],
    ["has no reason", without(unmapped, "no_gate_reason")],
    ["has a reason and names a gate", { ...unmapped, gates: [LINT] }],
  ])("rejects a gate-kind entry with no gate that %s", (_shape, entry) => {
    expect(schemaErrorsWithEntry(catalogue, unmappedIndex, entry)).not.toEqual(
      []
    );
  });

  it.each([
    ["gates", { ...otherKind, gates: [LINT] }],
    ["an empty list of gates", { ...otherKind, gates: [] }],
    ["a reason for having no gate", { ...otherKind, no_gate_reason: A_REASON }],
  ])("rejects an entry of another kind that carries %s", (_shape, entry) => {
    expect(schemaErrorsWithEntry(catalogue, otherKindIndex, entry)).not.toEqual(
      []
    );
  });
});

describe("listing the requirements no gate protects", () => {
  const listed = unprotectedCriteria([
    gateEntry("SI1", { gates: [UNIT_TESTS] }),
    gateEntry("SI10", { gates: [], no_gate_reason: A_REASON }),
  ]);

  it("lists an entry with no gate, with the reason it states", () => {
    expect(listed).toEqual([
      { id: "SI10", title: "Title of SI10", reason: A_REASON },
    ]);
  });

  it("reports each one on a line of its own, under a count", () => {
    expect(unprotectedReport(listed, 2)).toBe(
      "1 of 2 gate-kind criteria have no gate in the registry:\n" +
        `  SI10 Title of SI10 — ${A_REASON}`
    );
  });
});

describe("the requirements no registered gate protects", () => {
  it("are the ones recorded here", () => {
    expect(unprotected.map(criterion => criterion.id)).toEqual(UNPROTECTED);
  });

  it("each state a reason of their own", () => {
    const reasons = unprotected.map(criterion => criterion.reason);

    expect({
      unstated: unprotected
        .filter(criterion => criterion.reason.trim() === "")
        .map(criterion => criterion.id),
      distinct: new Set(reasons).size,
    }).toEqual({ unstated: [], distinct: reasons.length });
  });

  it("state their reasons without citing a criterion id", () => {
    // The reason is written for an operator, as the question is, and the
    // question is held to the same rule.
    const citing = unprotected
      .filter(criterion => mentionedCriterionIds(criterion.reason).length > 0)
      .map(criterion => criterion.id);

    expect(citing).toEqual([]);
  });

  it("are printed with their reasons", () => {
    const report = unprotectedReport(unprotected, gateKind.length);

    // Printed on every run, pass or fail: this list is the suite's finding.
    console.info(report);

    expect(report.split("\n")).toHaveLength(unprotected.length + 1);
  });
});
