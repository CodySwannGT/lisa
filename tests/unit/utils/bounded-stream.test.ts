/**
 * @file bounded-stream.test.ts
 * @description Pins the bounded stdin reader: every byte is returned in order,
 * each cap fails as soon as it is crossed, and the source is released on failure.
 * @module utils
 */
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { readBoundedBytes } from "../../../src/utils/bounded-stream.js";

const BOUNDS = {
  maxChunks: 3,
  maxBytes: 8,
  tooManyChunksMessage: "too many chunks",
  tooLargeMessage: "too large",
} as const;

describe("readBoundedBytes", () => {
  it("joins every chunk, strings and buffers alike, in order", async () => {
    const bytes = await readBoundedBytes(
      Readable.from(["ab", Buffer.from("cd"), "e"]),
      BOUNDS
    );
    expect(bytes.toString()).toBe("abcde");
  });

  it("returns an empty buffer for an empty stream", async () => {
    expect((await readBoundedBytes(Readable.from([]), BOUNDS)).length).toBe(0);
  });

  it("fails on the chunk that crosses the chunk cap", async () => {
    await expect(
      readBoundedBytes(Readable.from(["a", "b", "c", "d"]), BOUNDS)
    ).rejects.toThrow("too many chunks");
  });

  it("fails on the chunk that crosses the byte cap", async () => {
    await expect(
      readBoundedBytes(Readable.from(["abcd", "efghi"]), BOUNDS)
    ).rejects.toThrow("too large");
  });

  it("releases the source when a cap is crossed", async () => {
    const source = Readable.from(["abcdefghi", "never read"]);
    await expect(readBoundedBytes(source, BOUNDS)).rejects.toThrow("too large");
    expect(source.destroyed).toBe(true);
  });
});
