import {
  deepMerge,
  deepMergeWithArrayUnion,
} from "../../../src/utils/json-utils.js";

describe("deepMerge (lodash.merge semantics)", () => {
  it("lets override scalars win over base scalars", () => {
    // Override precedence is the contract package.lisa.json force/defaults relies
    // on; a lodash.merge regression that flipped precedence would silently
    // produce wrong manifests across the fleet.
    const result = deepMerge({ name: "base" }, { name: "override" });

    expect(result).toEqual({ name: "override" });
  });

  it("deep-merges nested objects instead of replacing them wholesale", () => {
    const result = deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 3, z: 4 } });

    // x survives from base, y is overridden, z is added — the recursive merge
    // that distinguishes lodash.merge from a shallow Object.assign.
    expect(result).toEqual({ a: { x: 1, y: 3, z: 4 } });
  });

  it("merges arrays index-by-index (lodash semantics), not union or replacement", () => {
    // lodash.merge overlays the override array onto the base array by index:
    // index 0 → 9 wins, indexes 1 and 2 → base tail (2, 3) survive.
    // This pins the exact failure mode a bad lodash.merge update would break:
    //   union would give [1, 2, 3, 9]; wholesale replacement would give [9].
    const result = deepMerge({ a: [1, 2, 3] }, { a: [9] });

    expect(result).toEqual({ a: [9, 2, 3] });
  });

  it("does not mutate the input objects", () => {
    const base: { a: Record<string, number> } = { a: { x: 1 } };
    const override: { a: Record<string, number> } = { a: { y: 2 } };

    deepMerge(base, override);

    expect(base).toEqual({ a: { x: 1 } });
    expect(override).toEqual({ a: { y: 2 } });
  });
});

describe("deepMergeWithArrayUnion", () => {
  it("concatenates and deduplicates identical array entries", () => {
    const base = { items: [{ x: 1, y: 2 }] };
    const override = { items: [{ x: 1, y: 2 }] };

    const result = deepMergeWithArrayUnion(base, override);

    expect(result.items).toEqual([{ x: 1, y: 2 }]);
  });

  it("dedupes structurally identical objects regardless of key order", () => {
    const base = { items: [{ x: 1, y: 2 }] };
    const override = { items: [{ y: 2, x: 1 }] };

    const result = deepMergeWithArrayUnion(base, override);

    expect(result.items).toHaveLength(1);
  });

  it("stays idempotent across repeated merges with reordered keys", () => {
    const base = { items: [{ x: 1, y: 2 }] };
    const override = { items: [{ y: 2, x: 1 }] };

    const first = deepMergeWithArrayUnion(base, override);
    const second = deepMergeWithArrayUnion(first, override);
    const third = deepMergeWithArrayUnion(second, override);

    expect(third.items).toHaveLength(1);
  });

  it("preserves distinct array entries that are not duplicates", () => {
    const base = { items: [{ x: 1 }] };
    const override = { items: [{ x: 2 }] };

    const result = deepMergeWithArrayUnion(base, override);

    expect(result.items).toEqual([{ x: 1 }, { x: 2 }]);
  });

  it("does not mutate the input objects", () => {
    const base = { items: [{ x: 1 }] };
    const override = { items: [{ x: 2 }] };

    deepMergeWithArrayUnion(base, override);

    expect(base).toEqual({ items: [{ x: 1 }] });
    expect(override).toEqual({ items: [{ x: 2 }] });
  });

  it("lets override scalars win over base scalars", () => {
    const base = { name: "base" };
    const override = { name: "override" };

    const result = deepMergeWithArrayUnion(base, override);

    expect(result.name).toBe("override");
  });
});
