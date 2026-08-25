/**
 * Same-origin config write endpoint for `lisa ui`.
 * @module cli/ui-config-write
 */
import * as http from "node:http";
import {
  getAtPath,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "../sync/json-path.js";
import { SYNC_REGISTRY } from "../sync/registry.js";
import {
  persistRoutedConfigChanges,
  type RoutedConfigChanges,
} from "./ui-config-write-persistence.js";
import { parseUnambiguousJson } from "./ui-config-write-document.js";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const MAX_CONFIG_WRITE_BYTES = 128 * 1024;
const NO_STORE = "no-store";
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";
const LOCAL_CONFIG_KEYS: ReadonlySet<string> = new Set([
  "atlassian.email",
  "intake.assignee",
  "playStore.serviceAccountKeyPath",
]);

/** Error raised for malformed request bodies that should return 400. */
class RequestBodyError extends Error {}

/**
 * Restrict loopback origins to the authority advertised by `lisa ui`.
 * @param host - Origin URL host
 * @returns Whether the authority is 127.0.0.1 with an optional valid port
 */
function isLoopbackHost(host: string): boolean {
  if (host === "127.0.0.1") {
    return true;
  }
  const prefix = "127.0.0.1:";
  if (!host.startsWith(prefix)) {
    return false;
  }
  const portText = host.slice(prefix.length);
  const digitsOnly = Array.from(portText).every(
    character => character >= "0" && character <= "9"
  );
  const port = Number(portText);
  return (
    portText.length > 0 &&
    portText.length <= 5 &&
    digitsOnly &&
    port > 0 &&
    port <= 65_535
  );
}

/**
 * Reject request origins that are not the advertised loopback listener.
 * @param origin - Incoming Origin header
 * @param host - Incoming Host header
 * @returns Whether the origin is the exact http://127.0.0.1 listener authority
 */
function isExpectedLoopbackOrigin(
  origin: string | undefined,
  host: string | undefined
): boolean {
  if (origin === undefined || host === undefined) {
    return false;
  }
  try {
    const parsed = new URL(origin);
    return (
      origin === parsed.origin &&
      parsed.protocol === "http:" &&
      parsed.host === host &&
      isLoopbackHost(parsed.host)
    );
  } catch {
    return false;
  }
}

/**
 * Check whether an unknown value can be serialized as JSON without dropping
 * fields.
 * @param value - Candidate payload value
 * @returns Whether the value is JSON-compatible
 */
function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return Number.isFinite(value) || typeof value !== "number";
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isJsonObject(value)) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

/**
 * Validate a dot-path config key before it can be written to disk.
 * @param key - Candidate config key
 * @returns Specific validation error, or undefined when valid
 */
function validateConfigKey(key: string): string | undefined {
  if (key.trim() !== key || key.length === 0) {
    return "Config change keys must be non-empty dot paths";
  }
  const segments = key.split(".");
  if (segments.some(segment => segment.length === 0)) {
    return `Config change key "${key}" contains an empty path segment`;
  }
  const unsafe = new Set(["__proto__", "constructor", "prototype"]);
  if (segments.some(segment => unsafe.has(segment))) {
    return `Config key "${key}" is not writable`;
  }
  return undefined;
}

/**
 * Classify one validated key without consulting either project file.
 * @param key - Safe non-empty dot path
 * @returns Fixed persistence target, or undefined when the key is unauthorized
 */
function configTarget(key: string): "committed" | "local" | undefined {
  if (LOCAL_CONFIG_KEYS.has(key)) return "local";
  return SYNC_REGISTRY.some(
    entry => key === entry.key || key.startsWith(`${entry.key}.`)
  )
    ? "committed"
    : undefined;
}

/**
 * Validate one sparse config-write entry.
 * @param key - Dot-path config key
 * @param change - Candidate JSON value
 * @returns Specific validation error, or undefined when valid
 */
function validateChangeEntry(key: string, change: unknown): string | undefined {
  const keyError = validateConfigKey(key);
  if (keyError !== undefined) {
    return keyError;
  }
  if (!isJsonValue(change)) {
    return `Config change "${key}" must be JSON-compatible`;
  }
  return undefined;
}

/**
 * Validate every registered constraint against the fully merged document.
 * @param config - Prospective committed config
 */
function validateProspectiveConfig(config: JsonObject): void {
  SYNC_REGISTRY.forEach(entry => {
    if (entry.validate === undefined) return;
    const prospective = getAtPath(config, entry.key);
    if (prospective === undefined) return;
    try {
      entry.validate(prospective);
    } catch (error) {
      throw new RequestBodyError(
        error instanceof Error
          ? error.message
          : `Config value "${entry.key}" is invalid`
      );
    }
  });
}

/**
 * Parse and validate the sparse config-write payload.
 * @param value - Parsed JSON request body
 * @returns Dot-path changes, or a specific validation error
 */
function parseConfigWritePayload(
  value: unknown
): { changes: RoutedConfigChanges } | { error: string } {
  if (!isJsonObject(value)) {
    return { error: "Payload must be a JSON object" };
  }
  const rawChanges = value.changes;
  if (!isJsonObject(rawChanges)) {
    return { error: "Payload must include a changes object" };
  }
  const entries = Object.entries(rawChanges);
  if (entries.length === 0) {
    return { error: "Payload changes must include at least one config key" };
  }
  const error = entries
    .map(([key, change]) => validateChangeEntry(key, change))
    .find(Boolean);
  if (error !== undefined) {
    return { error };
  }
  const unknown = entries.find(([key]) => configTarget(key) === undefined);
  if (unknown !== undefined) {
    return { error: `Config key "${unknown[0]}" is not writable` };
  }
  const changes = entries.reduce<RoutedConfigChanges>(
    (routed, [key, change]) => {
      const target = configTarget(key) as "committed" | "local";
      return {
        ...routed,
        [target]: { ...routed[target], [key]: change as JsonValue },
      };
    },
    { committed: {}, local: {} }
  );
  return { changes };
}

/**
 * Read a bounded JSON body from an incoming request.
 * @param request - Incoming HTTP request
 * @returns Parsed JSON body
 */
async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  // eslint-disable-next-line functional/no-let -- bounded stream aggregation
  let received = 0;
  // eslint-disable-next-line functional/no-let -- bounded stream aggregation
  let chunks: readonly Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.byteLength;
    if (received > MAX_CONFIG_WRITE_BYTES) {
      throw new RequestBodyError("Payload exceeds 128 KiB limit");
    }
    chunks = [...chunks, buffer];
  }
  if (chunks.length === 0) {
    throw new RequestBodyError("Payload body is required");
  }
  const text = decodeRequestBody(Buffer.concat(chunks));
  try {
    return parseUnambiguousJson(text, "Payload body");
  } catch {
    throw new RequestBodyError("Payload body must be valid JSON");
  }
}

/**
 * Decode request bytes without replacement characters so malformed encodings
 * cannot be normalized into a different valid property name or value.
 * @param bytes - Exact bounded request entity
 * @returns Valid UTF-8 request text
 */
function decodeRequestBody(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RequestBodyError("Payload body must be valid JSON");
  }
}

/**
 * Serve the same-origin committed-config write endpoint.
 * @param request - Incoming loopback request
 * @param response - Response associated with the request
 * @param destDir - Project root whose committed config is written
 */
export function serveConfigWrite(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  destDir: string
): void {
  if (request.method !== "POST") {
    response.writeHead(405, {
      allow: "POST",
      "cache-control": NO_STORE,
      "content-type": TEXT_CONTENT_TYPE,
    });
    response.end("Method not allowed");
    return;
  }
  if (!isExpectedLoopbackOrigin(request.headers.origin, request.headers.host)) {
    response.writeHead(403, {
      "cache-control": NO_STORE,
      "content-type": JSON_CONTENT_TYPE,
    });
    response.end(
      JSON.stringify({
        error: "Write requests must come from http://127.0.0.1",
      })
    );
    return;
  }
  void readJsonBody(request)
    .then(parseConfigWritePayload)
    .then(async parsed => {
      if ("error" in parsed) {
        response.writeHead(400, {
          "cache-control": NO_STORE,
          "content-type": JSON_CONTENT_TYPE,
        });
        response.end(JSON.stringify({ error: parsed.error }));
        return;
      }
      const committed = await persistRoutedConfigChanges(
        destDir,
        parsed.changes,
        validateProspectiveConfig
      );
      response.writeHead(200, {
        "cache-control": NO_STORE,
        "content-type": JSON_CONTENT_TYPE,
      });
      response.end(JSON.stringify({ ok: true, config: committed }));
    })
    .catch(error => {
      const isRequestBodyError = error instanceof RequestBodyError;
      response.writeHead(isRequestBodyError ? 400 : 500, {
        "cache-control": NO_STORE,
        "content-type": JSON_CONTENT_TYPE,
      });
      response.end(
        JSON.stringify({
          error: isRequestBodyError
            ? error.message
            : "Unable to write Lisa config",
        })
      );
    });
}
