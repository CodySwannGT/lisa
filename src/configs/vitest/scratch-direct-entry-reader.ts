/** Bounded, streaming reads of one already-authorized scratch directory. */
import * as fs from "node:fs";

/** Maximum direct entries one suite audit may materialize. */
export const SCRATCH_DIRECT_ENTRY_LIMIT = 100_000;

/** Maximum UTF-8 bytes in one scratch basename. */
export const SCRATCH_DIRECT_NAME_BYTES = 1_024;

/**
 * Validate and collect one bounded stream of direct basenames.
 * @param names - Direct basename stream
 * @returns Validated names
 */
export function collectBoundedScratchNames(
  names: Iterable<string>
): readonly string[] {
  const collected: string[] = [];
  for (const name of names) {
    if (Buffer.byteLength(name, "utf8") > SCRATCH_DIRECT_NAME_BYTES) {
      throw new Error(
        `Scratch direct basename exceeds ${String(SCRATCH_DIRECT_NAME_BYTES)} bytes`
      );
    }
    // eslint-disable-next-line functional/immutable-data -- allocation is bounded before the 100001st entry is retained
    collected.push(name);
    if (collected.length > SCRATCH_DIRECT_ENTRY_LIMIT) {
      throw new Error(
        `Scratch direct entry count exceeds ${String(SCRATCH_DIRECT_ENTRY_LIMIT)}`
      );
    }
  }
  return collected;
}

/**
 * Stream one directory without an unbounded readdir allocation.
 * @param directory - Already-authorized directory
 * @returns Validated direct basenames
 */
export function readBoundedScratchNames(directory: string): readonly string[] {
  const handle = fs.opendirSync(directory);
  try {
    return collectBoundedScratchNames({
      *[Symbol.iterator](): Iterator<string> {
        for (;;) {
          const entry = handle.readSync();
          if (entry === null) return;
          yield entry.name;
        }
      },
    });
  } finally {
    handle.closeSync();
  }
}
