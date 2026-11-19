/**
 * What a generic JSON Schema validator accepts and refuses under the
 * published register schema.
 *
 * The schema is the contract an auditor's own tooling reads. It has to accept
 * everything the generator can write and refuse an entry that leaves out any
 * of the things a register entry must state (CodySwannGT/lisa#4983).
 */
import { describe, expect, it } from "vitest";

import { MECHANISM_KINDS } from "../../../src/controls/register-types.js";
import {
  F_MIXED_GATES,
  F_NONE_GATES,
  F_PAVED_GATES,
  registerSchemaErrors,
} from "../../helpers/control-register.js";
import { registerOf } from "./support/register-build.js";
import {
  BARE_ENTRY,
  BARE_POINT,
  ENTRY,
  MECHANISMS,
  PARAMETER,
  POINT,
  PROOF,
  REGISTER,
  registerWith,
} from "./support/register-samples.js";

describe("the schema accepts what the generator writes", () => {
  it.each([
    ["F-none", F_NONE_GATES, null],
    ["F-mixed", F_MIXED_GATES, null],
    ["F-paved", F_PAVED_GATES, {}],
    ["F-paved with no package.json", F_PAVED_GATES, null],
    ["a repository that declares nothing", {}, null],
  ])("for %s", async (_name, block, scripts) => {
    expect(registerSchemaErrors(await registerOf(block, scripts))).toEqual([]);
  });
});

describe("the schema accepts what the types allow", () => {
  it("a register with every key filled in", () => {
    expect(registerSchemaErrors(REGISTER)).toEqual([]);
  });

  it("an entry with every optional key left off and every null taken", () => {
    expect(registerSchemaErrors(registerWith(BARE_ENTRY))).toEqual([]);
  });

  it.each(MECHANISM_KINDS)("a %s mechanism", kind => {
    expect(
      registerSchemaErrors(
        registerWith({ ...ENTRY, measuring_mechanism: MECHANISMS[kind] })
      )
    ).toEqual([]);
  });

  it("an awaited check any source may report", () => {
    const anySource = { ...MECHANISMS["external-check"], posted_by: null };

    expect(
      registerSchemaErrors(
        registerWith({ ...ENTRY, measuring_mechanism: anySource })
      )
    ).toEqual([]);
  });
});

describe("the schema refuses an entry that leaves something out", () => {
  it.each([
    "id",
    "criteria",
    "scope",
    "tier",
    "enforcement_points",
    "measuring_mechanism",
    "parameters",
    "proof",
    "accountable_party",
  ] as const)("its %s", missing => {
    const entry = Object.fromEntries(
      Object.entries(ENTRY).filter(([key]) => key !== missing)
    );

    expect(Object.keys(entry)).toHaveLength(Object.keys(ENTRY).length - 1);
    expect(registerSchemaErrors(registerWith(entry))).toEqual([
      expect.stringContaining(`entries.0.${missing}`),
    ]);
  });

  it("the gate it was generated from", () => {
    const { gate: _gate, ...entry } = ENTRY;

    expect(registerSchemaErrors(registerWith(entry))).not.toEqual([]);
  });

  it("half of what a proof states", () => {
    const { clean: _clean, ...proof } = PROOF;

    expect(registerSchemaErrors(registerWith({ ...ENTRY, proof }))).not.toEqual(
      []
    );
  });
});

describe("the schema refuses a key it does not list", () => {
  it.each([
    ["the register", { ...REGISTER, generated_at: "today" }],
    ["an entry", registerWith({ ...ENTRY, note: "x" })],
    [
      "an enforcement point",
      registerWith({ ...ENTRY, enforcement_points: [{ ...POINT, note: "x" }] }),
    ],
    [
      "a mechanism",
      registerWith({
        ...ENTRY,
        measuring_mechanism: { kind: "none", argv: ["true"] },
      }),
    ],
    [
      "a parameter",
      registerWith({
        ...ENTRY,
        parameters: { a: { ...PARAMETER, note: "x" } },
      }),
    ],
    ["a proof", registerWith({ ...ENTRY, proof: { ...PROOF, note: "x" } })],
  ])("on %s", (_where, document) => {
    expect(registerSchemaErrors(document)).not.toEqual([]);
  });
});

describe("the schema refuses a value the types do not allow", () => {
  it.each([
    ["a tier that is neither", { tier: "mandatory" }],
    ["a requirement id written wrongly", { criteria: ["ac5.4"] }],
    ["an empty accountable party", { accountable_party: "" }],
    ["a mechanism of no known kind", { measuring_mechanism: { kind: "hope" } }],
    [
      "a command with no program",
      { measuring_mechanism: { kind: "command", argv: [] } },
    ],
    [
      "a deployment moment with no environment",
      { enforcement_points: [{ ...BARE_POINT, moment: "pre-deploy" }] },
    ],
    [
      "a moment declared off",
      { enforcement_points: [{ ...BARE_POINT, level: "off" }] },
    ],
    [
      "a place that is not one of the five",
      { enforcement_points: [{ ...BARE_POINT, location: "laptop" }] },
    ],
    [
      "a parameter with no value",
      { parameters: { a: { direction: "floor" } } },
    ],
  ])("%s", (_what, change) => {
    expect(
      registerSchemaErrors(registerWith({ ...ENTRY, ...change }))
    ).not.toEqual([]);
  });

  it("a format version it does not know", () => {
    expect(
      registerSchemaErrors({ ...REGISTER, schema_version: 2 })
    ).not.toEqual([]);
  });
});
