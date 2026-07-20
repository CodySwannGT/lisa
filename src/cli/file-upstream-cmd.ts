/**
 * `lisa file-upstream` projects a public Lisa filing document from JSON.
 *
 * The command intentionally exposes no verifier or Lisa-root override. Excerpt
 * verification remains owned by the installed Lisa package, never the host
 * project invoking this command.
 * @module cli/file-upstream-cmd
 */
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import path from "node:path";

import {
  buildUpstreamAttributionIssueBody,
  type UpstreamAttributionBodyInput,
  UpstreamAttributionRejection,
} from "../core/upstream-attribution-body.js";

const MAX_INPUT_BYTES = 64 * 1024;
const MAX_INPUT_CHUNKS = 1024;

/** Options accepted by the public projection command. */
export interface FileUpstreamOptions {
  /** JSON event file. When omitted, the command reads standard input. */
  readonly input?: string;
}

/** Injectable process boundaries used by unit tests. */
export interface FileUpstreamDependencies {
  readonly cwd?: string;
  readonly error?: (message: string) => void;
  readonly log?: (message: string) => void;
  readonly readStdin?: () => Promise<string>;
}

/** One successful value or a sanitized diagnostic. */
type Step<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly diagnostic: string; readonly ok: false };

/** Field labels safe to repeat without reflecting arbitrary host input. */
const DIAGNOSTIC_FIELDS = Object.freeze([
  "documentKind",
  "lisaSurface",
  "failureClass",
  "lisaOwnedExcerpts",
  "upstreamCommitRefs",
  "redactedPlaceholders",
  "hostIssueLink",
  "occurrenceFingerprint",
  "lisaRoot",
  "readLisaFile",
  "hostEnvironment",
  "markerKey",
  "operatorImpact",
  "harnessFault",
  "requestedChange",
  "affectedProject",
  "hostIssueUrl",
  "attributionEvidence",
  "upstreamRefs",
] as const);

/**
 * Read standard input to completion.
 * @returns UTF-8 stdin contents
 */
const readAllStdin = async (): Promise<string> => {
  return readBoundedInputStream(process.stdin);
};

/**
 * Read an async byte stream in linear time under byte and chunk-count caps.
 * @param stream - Untrusted input chunks
 * @returns Strictly decoded UTF-8 payload
 */
export async function readBoundedInputStream(
  stream: AsyncIterable<Buffer | string>
): Promise<string> {
  const chunks: Buffer[] = [];
  // eslint-disable-next-line functional/no-let -- bounded stream accounting requires iterative state
  let totalBytes = 0;
  // eslint-disable-next-line functional/no-let -- bounded stream accounting requires iterative state
  let chunkCount = 0;
  for await (const rawChunk of stream) {
    chunkCount += 1;
    if (chunkCount > MAX_INPUT_CHUNKS) {
      throw new Error("input contains too many chunks");
    }
    const chunk = Buffer.from(rawChunk);
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_INPUT_BYTES) {
      throw new Error("input exceeds limit");
    }
    // eslint-disable-next-line functional/immutable-data -- bounded local accumulator avoids recursive copying
    chunks.push(chunk);
  }
  return decodeUtf8(Buffer.concat(chunks, totalBytes));
}

/**
 * Read one bounded regular JSON input file without following symlinks.
 * @param filePath - Candidate JSON input path
 * @returns Strictly decoded UTF-8 payload
 */
function readInputFile(filePath: string): string {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  // eslint-disable-next-line functional/no-let -- acquired descriptor must be closed in finally
  let descriptor: number;
  try {
    descriptor = openSync(
      filePath,
      constants.O_RDONLY | constants.O_NONBLOCK | noFollow
    );
  } catch {
    throw new Error("input is not a readable regular file");
  }
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size > MAX_INPUT_BYTES) {
      throw new Error("input is not a bounded regular file");
    }
    const bytes = Buffer.alloc(before.size);
    const count = readFixedBytes(descriptor, bytes, 0);
    const after = fstatSync(descriptor);
    if (count !== before.size || after.size !== before.size) {
      throw new Error("input changed while being read");
    }
    return decodeUtf8(bytes);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Fill a pre-sized buffer without permitting allocation growth.
 * @param descriptor - Open regular-file descriptor
 * @param buffer - Fixed destination buffer
 * @param offset - Current destination offset
 * @returns Number of bytes read
 */
function readFixedBytes(
  descriptor: number,
  buffer: Buffer,
  offset: number
): number {
  if (offset >= buffer.length) {
    return offset;
  }
  const count = readSync(
    descriptor,
    buffer,
    offset,
    buffer.length - offset,
    offset
  );
  return count === 0
    ? offset
    : readFixedBytes(descriptor, buffer, offset + count);
}

/**
 * Decode UTF-8 strictly so replacement characters cannot conceal input.
 * @param bytes - Candidate UTF-8 bytes
 * @returns Decoded string
 */
function decodeUtf8(bytes: Buffer): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Enforce the same byte cap on injected test/process boundaries.
 * @param payload - Injected payload
 * @returns The unchanged bounded payload
 */
function assertInjectedPayloadBounded(payload: string): string {
  if (Buffer.byteLength(payload, "utf8") > MAX_INPUT_BYTES) {
    throw new Error("input exceeds limit");
  }
  return payload;
}

/**
 * Load the event without including host paths or thrown values in diagnostics.
 * @param options - Command options
 * @param dependencies - Injectable process boundaries
 * @returns Payload or sanitized read diagnostic
 */
async function loadPayload(
  options: FileUpstreamOptions,
  dependencies: FileUpstreamDependencies
): Promise<Step<string>> {
  try {
    return {
      ok: true,
      value:
        options.input === undefined
          ? assertInjectedPayloadBounded(
              await (dependencies.readStdin ?? readAllStdin)()
            )
          : readInputFile(
              path.resolve(dependencies.cwd ?? process.cwd(), options.input)
            ),
    };
  } catch {
    return {
      diagnostic: "file-upstream: input could not be read",
      ok: false,
    };
  }
}

/**
 * Parse a filing event while keeping rejected payload bytes out of stderr.
 * @param payload - Raw JSON input
 * @returns Parsed object or sanitized parse diagnostic
 */
function parseEvent(payload: string): Step<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {
        diagnostic: "file-upstream: input must be a JSON object",
        ok: false,
      };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return {
      diagnostic: "file-upstream: input is not valid JSON",
      ok: false,
    };
  }
}

/**
 * Find the rejected field without repeating the rejection message, which may
 * contain host-controlled values. Arbitrary top-level keys collapse to
 * `unknownField` rather than being reflected to stderr.
 * @param event - Rejected event
 * @param cause - Builder rejection
 * @returns Safe field label
 */
function rejectionField(cause: unknown): string {
  if (!(cause instanceof UpstreamAttributionRejection)) {
    return "input";
  }
  return DIAGNOSTIC_FIELDS.includes(
    cause.field as (typeof DIAGNOSTIC_FIELDS)[number]
  )
    ? cause.field
    : "unknownField";
}

/**
 * Project one filing event and return the intended process exit code.
 * Rejections always produce empty stdout and one sanitized, field-named stderr
 * diagnostic.
 * @param options - Command options
 * @param dependencies - Injectable process boundaries
 * @returns Process exit code: zero on projection, one on rejection
 */
export async function runFileUpstream(
  options: FileUpstreamOptions = {},
  dependencies: FileUpstreamDependencies = {}
): Promise<number> {
  const log = dependencies.log ?? ((message: string) => console.log(message));
  const error =
    dependencies.error ?? ((message: string) => console.error(message));
  const payload = await loadPayload(options, dependencies);
  if (!payload.ok) {
    error(payload.diagnostic);
    return 1;
  }

  const event = parseEvent(payload.value);
  if (!event.ok) {
    error(event.diagnostic);
    return 1;
  }

  try {
    // The builder is the runtime validation boundary for this untrusted JSON.
    const body = buildUpstreamAttributionIssueBody(
      event.value as unknown as UpstreamAttributionBodyInput
    );
    log(body);
    return 0;
  } catch (cause) {
    error(`file-upstream: rejected field ${rejectionField(cause)}`);
    return 1;
  }
}
