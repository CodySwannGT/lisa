/**
 * @file bounded-stream.ts
 * @description Collects an untrusted async byte stream under a chunk-count cap
 * and an aggregate byte cap, failing as soon as either is exceeded.
 *
 * The CLI entry points that read JSON from standard input share this so the
 * bounds are enforced the same way everywhere: linear in the input, with no
 * re-copying of what has already been read.
 * @module utils
 */

/** The caps a bounded read enforces and the errors it raises when crossed. */
export interface StreamBounds {
  /** Most chunks the stream may deliver. */
  readonly maxChunks: number;
  /** Most bytes the stream may deliver in total. */
  readonly maxBytes: number;
  /** Error message when the chunk cap is crossed. */
  readonly tooManyChunksMessage: string;
  /** Error message when the byte cap is crossed. */
  readonly tooLargeMessage: string;
}

/** The chunks accepted so far and their running byte total. */
interface Collected {
  readonly chunks: readonly Buffer[];
  readonly totalBytes: number;
}

/**
 * Accepts one chunk, or throws when it crosses a cap.
 * @param collected - What has been accepted so far
 * @param rawChunk - The chunk as the stream delivered it
 * @param bounds - Caps and error messages for this read
 * @returns What has been accepted including this chunk
 */
function accept(
  collected: Collected,
  rawChunk: Buffer | string,
  bounds: StreamBounds
): Collected {
  if (collected.chunks.length + 1 > bounds.maxChunks) {
    throw new Error(bounds.tooManyChunksMessage);
  }
  const chunk = Buffer.from(rawChunk);
  const totalBytes = collected.totalBytes + chunk.byteLength;
  if (totalBytes > bounds.maxBytes) throw new Error(bounds.tooLargeMessage);
  return { chunks: [...collected.chunks, chunk], totalBytes };
}

/**
 * Pulls chunks until the stream ends, carrying what was accepted as the
 * argument. Each step resumes after an await, so the stack does not grow,
 * and the chunk cap bounds how many steps there are.
 * @param iterator - The stream's iterator
 * @param collected - What has been accepted so far
 * @param bounds - Caps and error messages for this read
 * @returns Everything the stream delivered
 */
async function drain(
  iterator: AsyncIterator<Buffer | string>,
  collected: Collected,
  bounds: StreamBounds
): Promise<Collected> {
  const next = await iterator.next();
  if (next.done === true) return collected;
  return drain(iterator, accept(collected, next.value, bounds), bounds);
}

/**
 * Reads an async byte stream to completion under the given caps.
 * @param stream - Untrusted input chunks
 * @param bounds - Chunk and byte caps, with the error raised for each
 * @returns Every byte the stream delivered
 */
export async function readBoundedBytes(
  stream: AsyncIterable<Buffer | string>,
  bounds: StreamBounds
): Promise<Buffer> {
  const iterator = stream[Symbol.asyncIterator]();
  try {
    const { chunks, totalBytes } = await drain(
      iterator,
      { chunks: [], totalBytes: 0 },
      bounds
    );
    return Buffer.concat(chunks, totalBytes);
  } catch (error) {
    // Release the source as `for await` did when the loop body threw.
    await iterator.return?.();
    throw error;
  }
}
