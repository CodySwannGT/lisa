/**
 * Generative (property-based) coverage for `deepMergeWithArrayUnion` — Lisa's
 * first SI9 surface.
 *
 * This function decides what every governed project's JSON config becomes on
 * every `lisa apply`. A defect here does not break one repository; it quietly
 * rewrites configuration across the fleet, in a shape nobody reads afterwards
 * because the file is generated. It is the highest-leverage pure function in the
 * codebase and, until now, was covered only by example-based tests — which
 * encode the cases their author imagined.
 *
 * ## Declared invariants (SI9 inventory)
 *
 * Each `it` below asserts exactly one, and the name states it:
 *
 * 1. **Key union** — the result's keys are exactly `keys(base) ∪ keys(override)`.
 * 2. **Override precedence** — where both sides hold a scalar at a key, the
 *    override's value wins.
 * 3. **Base preservation** — a key only the base holds survives, structurally
 *    equal to what it was.
 * 4. **Array union** — merging two arrays yields every distinct element of both.
 * 5. **Array dedup** — no two elements of a merged array are deeply equal.
 * 6. **Left identity** — merging an empty object changes nothing.
 * 7. **Idempotence** — applying the same override twice equals applying it once.
 *    This is the property that matters most in practice: `lisa apply` runs
 *    repeatedly against the same host file, so a non-idempotent merge grows
 *    configuration without bound.
 * 8. **Input immutability** — neither argument is modified.
 * 9. **Result independence** — the result shares no mutable structure with
 *    either input, so mutating it later cannot reach back into them.
 *
 * ## Input dimensions varied (SI9 inventory)
 *
 * Arbitrary JSON values: nested objects and arrays to depth, every scalar type
 * including `null`, empty objects and arrays, duplicate elements within a single
 * array, keys present on one side only, keys present on both with mismatched
 * types (object vs scalar, array vs object), and unicode key names.
 *
 * Not varied, deliberately: prototype-polluting keys (`__proto__`,
 * `constructor`), because the merge consumes parsed JSON from disk and that
 * threat belongs to the reader rather than to this function. If that changes,
 * add the dimension here rather than assuming it is covered.
 * @module tests/unit/utils/json-merge.property
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { deepMergeWithArrayUnion } from "../../../src/utils/json-utils.js";

/**
 * JSON scalars the merge treats as terminal values.
 * @returns An arbitrary producing null, booleans, numbers and short strings.
 */
const jsonScalar = (): fc.Arbitrary<unknown> =>
  fc.oneof(
    fc.constant(null),
    fc.boolean(),
    fc.integer({ min: -1000, max: 1000 }),
    fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
    fc.string({ maxLength: 12 })
  );

/**
 * Arbitrary JSON values, nested to a bounded depth.
 * @returns An arbitrary producing scalars, arrays and objects recursively.
 */
const jsonValue = (): fc.Arbitrary<unknown> =>
  fc.letrec<{ value: unknown }>(tie => ({
    value: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      jsonScalar(),
      fc.array(tie("value"), { maxLength: 5 }),
      fc.dictionary(fc.string({ maxLength: 8 }), tie("value"), { maxKeys: 5 })
    ),
  })).value;

/**
 * Arbitrary JSON objects, the only shape the merge accepts at the top level.
 * @returns An arbitrary producing records of arbitrary JSON values.
 */
const jsonObject = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.dictionary(fc.string({ maxLength: 8 }), jsonValue(), { maxKeys: 6 });

/**
 * A structural snapshot used to detect mutation of an input.
 * @param value The value to snapshot.
 * @returns A stable string encoding of the value's structure.
 */
const snapshot = (value: unknown): string => JSON.stringify(value);

/**
 * True when a value is a plain JSON object rather than an array or scalar.
 * @param value The value to classify.
 * @returns Whether the value is a non-array, non-null object.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

describe("deepMergeWithArrayUnion — generative properties", () => {
  it("1. result keys are the union of both inputs' keys", () => {
    fc.assert(
      fc.property(jsonObject(), jsonObject(), (base, override) => {
        const merged = deepMergeWithArrayUnion(base, override);
        expect(new Set(Object.keys(merged))).toEqual(
          new Set([...Object.keys(base), ...Object.keys(override)])
        );
      })
    );
  });

  it("2. the override wins wherever both sides hold a scalar", () => {
    fc.assert(
      fc.property(jsonObject(), jsonObject(), (base, override) => {
        const merged = deepMergeWithArrayUnion(base, override) as Record<
          string,
          unknown
        >;
        for (const key of Object.keys(override)) {
          const contested =
            Object.hasOwn(base, key) &&
            !isPlainObject(base[key]) &&
            !Array.isArray(base[key]) &&
            !isPlainObject(override[key]) &&
            !Array.isArray(override[key]);
          if (contested) expect(merged[key]).toEqual(override[key]);
        }
      })
    );
  });

  it("3. keys only the base holds survive unchanged", () => {
    fc.assert(
      fc.property(jsonObject(), jsonObject(), (base, override) => {
        const merged = deepMergeWithArrayUnion(base, override) as Record<
          string,
          unknown
        >;
        for (const key of Object.keys(base)) {
          if (!Object.hasOwn(override, key)) {
            expect(merged[key]).toEqual(base[key]);
          }
        }
      })
    );
  });

  it("4. merging arrays keeps every distinct element of both", () => {
    fc.assert(
      fc.property(
        fc.array(jsonScalar(), { maxLength: 6 }),
        fc.array(jsonScalar(), { maxLength: 6 }),
        (left, right) => {
          const merged = deepMergeWithArrayUnion(
            { list: left },
            { list: right }
          ) as { list: unknown[] };
          for (const element of [...left, ...right]) {
            expect(merged.list).toContainEqual(element);
          }
        }
      )
    );
  });

  it("5. a merged array contains no two deeply equal elements", () => {
    fc.assert(
      fc.property(
        fc.array(jsonValue(), { maxLength: 6 }),
        fc.array(jsonValue(), { maxLength: 6 }),
        (left, right) => {
          const merged = deepMergeWithArrayUnion(
            { list: left },
            { list: right }
          ) as { list: unknown[] };
          const seen = merged.list.map(snapshot);
          expect(new Set(seen).size).toBe(seen.length);
        }
      )
    );
  });

  it("6. merging an empty override changes nothing", () => {
    fc.assert(
      fc.property(jsonObject(), base => {
        expect(deepMergeWithArrayUnion(base, {})).toEqual(base);
      })
    );
  });

  it("7. applying the same override twice equals applying it once", () => {
    fc.assert(
      fc.property(jsonObject(), jsonObject(), (base, override) => {
        const once = deepMergeWithArrayUnion(base, override);
        const twice = deepMergeWithArrayUnion(once, override);
        expect(twice).toEqual(once);
      })
    );
  });

  it("8. neither input is mutated", () => {
    fc.assert(
      fc.property(jsonObject(), jsonObject(), (base, override) => {
        const beforeBase = snapshot(base);
        const beforeOverride = snapshot(override);
        deepMergeWithArrayUnion(base, override);
        expect(snapshot(base)).toBe(beforeBase);
        expect(snapshot(override)).toBe(beforeOverride);
      })
    );
  });

  it("9. the result shares no mutable structure with either input", () => {
    fc.assert(
      fc.property(jsonObject(), jsonObject(), (base, override) => {
        const merged = deepMergeWithArrayUnion(base, override) as Record<
          string,
          unknown
        >;
        const beforeBase = snapshot(base);
        const beforeOverride = snapshot(override);
        for (const key of Object.keys(merged)) {
          const value = merged[key];
          if (Array.isArray(value)) value.push("mutation-probe");
          else if (isPlainObject(value)) value["mutation-probe"] = true;
        }
        expect(snapshot(base)).toBe(beforeBase);
        expect(snapshot(override)).toBe(beforeOverride);
      })
    );
  });
});
