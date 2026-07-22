/** CLI adapter for the shared Health v1 prepare/finalize consumer. */
import path from "node:path";

import {
  HEALTH_EVALUATION_PROTOCOL_VERSION,
  MAX_HEALTH_EVALUATION_RESPONSE_BYTES,
  prepareHealthEvaluation,
  runPersistedHealth,
  serializeHealthEvaluationRequest,
} from "../health/index.js";

const MAX_EVALUATION_CHUNKS = 1024;

/** Options accepted by `lisa health`. */
export interface HealthCliOptions {
  /** Emit a bounded evaluator request without persisting a result. */
  readonly prepareAgentic?: boolean;
  /** Read a digest-bound evaluator response from standard input. */
  readonly agenticEvaluation?: boolean;
}

/** Injectable process boundaries for deterministic CLI tests. */
export interface HealthCliDependencies {
  readonly cwd?: string;
  readonly prepare: typeof prepareHealthEvaluation;
  readonly runPersisted: typeof runPersistedHealth;
  readonly serializeRequest: typeof serializeHealthEvaluationRequest;
  readonly readStdin: () => Promise<string>;
  readonly write: (payload: string) => void;
}

const DEFAULT_DEPENDENCIES: HealthCliDependencies = {
  prepare: prepareHealthEvaluation,
  runPersisted: runPersistedHealth,
  serializeRequest: serializeHealthEvaluationRequest,
  readStdin: async () => readBoundedHealthInput(process.stdin),
  write: payload => process.stdout.write(payload),
};

/**
 * Read strict UTF-8 evaluator JSON under the protocol's aggregate bound.
 * @param stream - Standard input or an injected test stream
 * @returns Bounded UTF-8 payload
 */
export async function readBoundedHealthInput(
  stream: AsyncIterable<Buffer | string>
): Promise<string> {
  const chunks: Buffer[] = [];
  // eslint-disable-next-line functional/no-let -- bounded stream accounting is iterative
  let totalBytes = 0;
  // eslint-disable-next-line functional/no-let -- bounded stream accounting is iterative
  let chunkCount = 0;
  for await (const rawChunk of stream) {
    chunkCount += 1;
    if (chunkCount > MAX_EVALUATION_CHUNKS) {
      throw new Error("health evaluation contains too many chunks");
    }
    const chunk = Buffer.from(rawChunk);
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_HEALTH_EVALUATION_RESPONSE_BYTES) {
      throw new Error("health evaluation exceeds 128 KiB");
    }
    // eslint-disable-next-line functional/immutable-data -- bounded local buffering avoids quadratic copies
    chunks.push(chunk);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(chunks, totalBytes)
  );
}

/**
 * Run the public Health v1 CLI without reconstructing any result fields.
 * @param projectPath - Optional host-project path
 * @param options - Prepare/finalize mode
 * @param dependencies - Injectable process and health boundaries
 */
export async function runHealthCli(
  projectPath: string | undefined,
  options: HealthCliOptions,
  dependencies: Partial<HealthCliDependencies> = {}
): Promise<void> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  if (options.prepareAgentic === true && options.agenticEvaluation === true) {
    throw new Error(
      "--prepare-agentic and --agentic-evaluation are mutually exclusive"
    );
  }
  const root = path.resolve(deps.cwd ?? process.cwd(), projectPath ?? ".");
  if (options.prepareAgentic === true) {
    const prepared = await deps.prepare(root);
    deps.write(
      prepared === undefined
        ? `${JSON.stringify({
            protocolVersion: HEALTH_EVALUATION_PROTOCOL_VERSION,
            status: "unavailable",
          })}\n`
        : deps.serializeRequest(prepared)
    );
    return;
  }

  const response =
    options.agenticEvaluation === true
      ? await readEvaluationInput(deps.readStdin)
      : undefined;
  const completed = await deps.runPersisted(
    root,
    response === undefined
      ? undefined
      : { agentic: { enabled: true, response } }
  );
  deps.write(completed.serialized);
}

/**
 * Parse an exact JSON value without echoing hostile input in diagnostics.
 * @param payload - Bounded candidate response
 * @returns Parsed hostile value for the health consumer to validate
 */
function parseEvaluationInput(payload: string): unknown {
  if (
    Buffer.byteLength(payload, "utf8") > MAX_HEALTH_EVALUATION_RESPONSE_BYTES
  ) {
    return payload;
  }
  if (payload.trim() === "") {
    return payload;
  }
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return payload;
  }
}

/**
 * Convert every malformed transport outcome into hostile input for the shared
 * consumer, which degrades it to unavailable and still persists one final run.
 * @param readStdin - Bounded stdin reader
 * @returns Parsed JSON or an invalid sentinel value
 */
async function readEvaluationInput(
  readStdin: () => Promise<string>
): Promise<unknown> {
  try {
    return parseEvaluationInput(await readStdin());
  } catch {
    return null;
  }
}
