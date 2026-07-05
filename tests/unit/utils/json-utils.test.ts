import { deepMergeWithArrayUnion } from "../../../src/utils/json-utils.js";

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
