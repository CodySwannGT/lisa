/** Same-origin Health v1 endpoint for `lisa ui`. */
import * as http from "node:http";

import {
  readLatestHealthResult,
  runPersistedHealth,
  serializeHealthResult,
} from "../health/index.js";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const NO_STORE = "no-store";
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

/** Health boundaries injectable by endpoint and browser tests. */
export interface UiHealthDependencies {
  readonly readLatest: typeof readLatestHealthResult;
  readonly runPersisted: typeof runPersistedHealth;
}

const DEFAULT_DEPENDENCIES: UiHealthDependencies = {
  readLatest: readLatestHealthResult,
  runPersisted: runPersistedHealth,
};

/**
 * Restrict origins to the exact loopback authority advertised by `lisa ui`.
 * @param origin - Incoming Origin header
 * @param host - Incoming Host header
 * @returns Whether origin exactly matches the loopback listener
 */
function isExpectedLoopbackOrigin(
  origin: string | undefined,
  host: string | undefined
): boolean {
  if (origin === undefined || host === undefined) return false;
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
 * Match the config writer's accepted 127.0.0.1 authority shape.
 * @param host - URL authority to inspect
 * @returns Whether the authority is valid loopback
 */
function isLoopbackHost(host: string): boolean {
  if (host === "127.0.0.1") return true;
  const prefix = "127.0.0.1:";
  if (!host.startsWith(prefix)) return false;
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
 * Write a no-store response without leaking runtime or filesystem details.
 * @param response - HTTP response
 * @param status - HTTP status code
 * @param body - Response payload
 * @param contentType - Response media type
 * @param headers - Additional response headers
 */
function reply(
  response: http.ServerResponse,
  status: number,
  body: string,
  contentType = JSON_CONTENT_TYPE,
  headers: Readonly<Record<string, string>> = {}
): void {
  response.writeHead(status, {
    "cache-control": NO_STORE,
    "content-type": contentType,
    ...headers,
  });
  response.end(body);
}

/**
 * Build one project-bound Health endpoint with a coalesced run boundary.
 * The closure is the only place the UI server's resolved project directory is
 * retained; request data can never select another target.
 * @param destDir - Server-bound project root
 * @param dependencies - Optional Health storage/run boundaries
 * @returns Bound Health request handler
 */
// eslint-disable-next-line max-lines-per-function -- route branches and single-flight state remain colocated
export function createUiHealthHandler(
  destDir: string,
  dependencies: Partial<UiHealthDependencies> = {}
): (request: http.IncomingMessage, response: http.ServerResponse) => void {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  // eslint-disable-next-line functional/no-let -- one server-local single-flight is cleared after settlement
  let inFlight: ReturnType<typeof runPersistedHealth> | undefined;

  const runOnce = (): ReturnType<typeof runPersistedHealth> => {
    if (inFlight === undefined) {
      const pending = deps.runPersisted(destDir);
      inFlight = pending;
      const clear = (): void => {
        if (inFlight === pending) inFlight = undefined;
      };
      void pending.then(clear, clear);
    }
    return inFlight;
  };

  return (request, response) => {
    if (request.method === "HEAD") {
      reply(response, 200, "");
      return;
    }
    if (request.method === "GET") {
      void deps
        .readLatest(destDir)
        .then(outcome => {
          if (outcome.status === "available") {
            reply(response, 200, serializeHealthResult(outcome.result));
            return;
          }
          if (outcome.status === "never-run") {
            reply(
              response,
              404,
              JSON.stringify({ error: "No Lisa health result is available" })
            );
            return;
          }
          reply(
            response,
            500,
            JSON.stringify({ error: "Unable to read Lisa health" })
          );
        })
        .catch(() => {
          reply(
            response,
            500,
            JSON.stringify({ error: "Unable to read Lisa health" })
          );
        });
      return;
    }
    if (request.method === "POST") {
      if (
        !isExpectedLoopbackOrigin(request.headers.origin, request.headers.host)
      ) {
        reply(
          response,
          403,
          JSON.stringify({
            error: "Health runs require the same Lisa console origin",
          })
        );
        return;
      }
      void runOnce()
        .then(completed => {
          reply(response, 200, completed.serialized);
        })
        .catch(() => {
          reply(
            response,
            500,
            JSON.stringify({ error: "Unable to run Lisa health" })
          );
        });
      return;
    }
    reply(response, 405, "Method not allowed", TEXT_CONTENT_TYPE, {
      allow: "GET, HEAD, POST",
    });
  };
}
