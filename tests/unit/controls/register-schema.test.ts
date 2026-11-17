/**
 * The published register schema and the TypeScript types must describe one
 * shape.
 *
 * `schemas/control-register.schema.json` is what an auditor's own validator
 * reads; `src/controls/register-types.ts` is what the generator is compiled
 * against. Both are written by hand, so this suite is what keeps them from
 * drifting: the samples it uses are checked by the compiler to carry exactly
 * the keys of their types, and are compared here with the schema key for key
 * and value for value (CodySwannGT/lisa#4983).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CRITERION_ID_SOURCE } from "../../../src/controls/catalogue.js";
import { LOCATION_BY_MOMENT_FAMILY } from "../../../src/controls/register-points.js";
import {
  CONTROL_REGISTER_SCHEMA_PACKAGE_PATH,
  CONTROL_TIERS,
  ENFORCEMENT_LEVELS,
  ENFORCEMENT_LOCATIONS,
  MECHANISM_KINDS,
  PARAMETER_DIRECTIONS,
} from "../../../src/controls/register-types.js";
import {
  registerSchema,
  shippedGates,
} from "../../helpers/control-register.js";
import { MECHANISMS, REGISTER, SHAPES } from "./support/register-samples.js";

/** The part of a JSON Schema object these cases read. */
interface ObjectSchema {
  readonly required: readonly string[];
  readonly pattern?: string;
  readonly properties: Readonly<
    Record<
      string,
      {
        readonly enum?: readonly string[];
        readonly const?: unknown;
        readonly pattern?: string;
      }
    >
  >;
  readonly oneOf?: readonly ObjectSchema[];
}

const schema = registerSchema() as unknown as ObjectSchema & {
  readonly $defs: Readonly<Record<string, ObjectSchema>>;
};

/**
 * A list of names in one fixed order, so two lists can be compared as sets.
 * @param values - The names
 * @returns The same names, ordered
 */
function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => (left < right ? -1 : 1));
}

describe("the schema and the types name the same keys", () => {
  it("at the top of the register", () => {
    expect(sorted(Object.keys(schema.properties))).toEqual(
      sorted(Object.keys(REGISTER))
    );
    expect(sorted(schema.required)).toEqual(sorted(Object.keys(REGISTER)));
  });

  it.each(SHAPES)("in %s", (name, sample, optional) => {
    const keys = Object.keys(sample);

    expect(sorted(Object.keys(schema.$defs[name]?.properties ?? {}))).toEqual(
      sorted(keys)
    );
    expect(sorted(schema.$defs[name]?.required ?? [])).toEqual(
      sorted(keys.filter(key => !optional.includes(key)))
    );
  });

  it.each(MECHANISM_KINDS)("in the %s mechanism", kind => {
    const branch = schema.$defs.measuring_mechanism?.oneOf?.find(
      candidate => candidate.properties.kind?.const === kind
    );

    expect(sorted(Object.keys(branch?.properties ?? {}))).toEqual(
      sorted(Object.keys(MECHANISMS[kind]))
    );
    expect(sorted(branch?.required ?? [])).toEqual(
      sorted(Object.keys(MECHANISMS[kind]))
    );
  });

  it("and no object of the schema goes unchecked", () => {
    expect(sorted(Object.keys(schema.$defs))).toEqual(
      sorted([
        ...SHAPES.map(([name]) => name),
        "criterion_id",
        "measuring_mechanism",
      ])
    );
  });
});

describe("the schema and the types allow the same values", () => {
  it("for a tier, a level, a location and a direction", () => {
    const { entry, enforcement_point: point, parameter } = schema.$defs;

    expect(entry?.properties.tier?.enum).toEqual(CONTROL_TIERS);
    expect(point?.properties.level?.enum).toEqual(ENFORCEMENT_LEVELS);
    expect(point?.properties.location?.enum).toEqual(ENFORCEMENT_LOCATIONS);
    expect(parameter?.properties.direction?.enum).toEqual(PARAMETER_DIRECTIONS);
  });

  it("for the kind of a mechanism and the version of the format", () => {
    expect(
      schema.$defs.measuring_mechanism?.oneOf?.map(
        branch => branch.properties.kind?.const
      )
    ).toEqual(MECHANISM_KINDS);
    expect(schema.properties.schema_version?.const).toBe(
      REGISTER.schema_version
    );
  });
});

describe("the schema keeps up with what the register is generated from", () => {
  it("accepts every moment the gate registry knows", async () => {
    const registry = await shippedGates();
    const pattern = new RegExp(
      schema.$defs.enforcement_point?.properties.moment?.pattern ?? "^$",
      "u"
    );
    const moments = [
      ...registry.MOMENTS,
      ...registry.MOMENT_FAMILIES.map(family => `${family}:production`),
    ];

    expect(moments.filter(moment => !pattern.test(moment))).toEqual([]);
    expect(
      registry.MOMENT_FAMILIES.filter(family => pattern.test(family))
    ).toEqual([]);
  });

  it("knows where every moment of the gate registry is enforced", async () => {
    const registry = await shippedGates();

    expect(sorted(Object.keys(LOCATION_BY_MOMENT_FAMILY))).toEqual(
      sorted([...registry.MOMENTS, ...registry.MOMENT_FAMILIES])
    );
    expect(
      sorted([...new Set(Object.values(LOCATION_BY_MOMENT_FAMILY))])
    ).toEqual(sorted(ENFORCEMENT_LOCATIONS));
  });

  it("writes a requirement id the way the catalogue does", () => {
    expect(schema.$defs.criterion_id?.pattern).toBe(
      `^(?:${CRITERION_ID_SOURCE})$`
    );
  });

  it("ships in the package", () => {
    const manifest = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8")
    ) as { readonly files: readonly string[] };

    expect(manifest.files).toContain(CONTROL_REGISTER_SCHEMA_PACKAGE_PATH);
  });
});
