/** Direct-entry allocation bounds for per-suite scratch attribution. */
import { describe, expect, it } from "vitest";

import {
  SCRATCH_DIRECT_ENTRY_LIMIT,
  SCRATCH_DIRECT_NAME_BYTES,
  collectBoundedScratchNames,
} from "../../../src/configs/vitest/scratch-direct-entry-reader.js";

describe("bounded scratch direct-entry reader", () => {
  it("accepts exactly the direct-entry limit", () => {
    const names = {
      *[Symbol.iterator](): Iterator<string> {
        for (let index = 0; index < SCRATCH_DIRECT_ENTRY_LIMIT; index += 1) {
          yield `entry-${String(index)}`;
        }
      },
    };

    expect(collectBoundedScratchNames(names)).toHaveLength(
      SCRATCH_DIRECT_ENTRY_LIMIT
    );
  });

  it("refuses before retaining entry 100,001", () => {
    const names = {
      *[Symbol.iterator](): Iterator<string> {
        for (let index = 0; index <= SCRATCH_DIRECT_ENTRY_LIMIT; index += 1) {
          yield `entry-${String(index)}`;
        }
      },
    };

    expect(() => collectBoundedScratchNames(names)).toThrow(/100000/iu);
  });

  it("refuses a basename over 1,024 UTF-8 bytes", () => {
    expect(() =>
      collectBoundedScratchNames(["x".repeat(SCRATCH_DIRECT_NAME_BYTES + 1)])
    ).toThrow(/1024 bytes/iu);
  });
});
