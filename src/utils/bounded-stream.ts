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

/**
 * Accumulates chunks for one bounded read. The running totals live on the
 * instance because the stream is consumed incrementally and each chunk must be
 * checked against the caps before the next one is accepted.
 */
class BoundedChunkCollector {
  private readonly chunks: Buffer[] = [];
  private totalBytes = 0;

  /**
   * Creates a collector for one read.
   * @param bounds - Caps and error messages for this read
   */
  constructor(private readonly bounds: StreamBounds) {}

  /**
   * Accepts one chunk, or throws when it crosses a cap.
   * @param rawChunk - The chunk as the stream delivered it
   */
  add(rawChunk: Buffer | string): void {
    if (this.chunks.length + 1 > this.bounds.maxChunks) {
      throw new Error(this.bounds.tooManyChunksMessage);
    }
    const chunk = Buffer.from(rawChunk);
    this.totalBytes += chunk.byteLength;
    if (this.totalBytes > this.bounds.maxBytes) {
      throw new Error(this.bounds.tooLargeMessage);
    }
    this.chunks.push(chunk);
  }

  /**
   * Joins every accepted chunk.
   * @returns The collected bytes
   */
  bytes(): Buffer {
    return Buffer.concat(this.chunks, this.totalBytes);
  }
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
  const collector = new BoundedChunkCollector(bounds);
  for await (const rawChunk of stream) collector.add(rawChunk);
  return collector.bytes();
}
