/** Same-origin setup-readiness endpoint for `lisa ui`. */
import * as http from "node:http";

import { runSetupReadiness, type HealthResult } from "../health/index.js";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const NO_STORE = "no-store";
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

/** Setup-readiness boundary injectable by endpoint and browser tests. */
export interface UiSetupReadinessDependencies {
  readonly run: typeof runSetupReadiness;
}

const DEFAULT_DEPENDENCIES: UiSetupReadinessDependencies = {
  run: runSetupReadiness,
};

/**
 * Serialize setup-readiness with the same stable bytes as Health endpoints.
 * @param result - Validated setup-readiness result
 * @returns Pretty JSON with trailing newline
 */
function serialize(result: HealthResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/**
 * Write a no-store response without exposing runtime or filesystem details.
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
 * Build one project-bound setup-readiness endpoint.
 * @param destDir - Server-bound project root
 * @param dependencies - Optional setup-readiness run boundary
 * @returns Bound setup-readiness request handler
 */
export function createUiSetupReadinessHandler(
  destDir: string,
  dependencies: Partial<UiSetupReadinessDependencies> = {}
): (request: http.IncomingMessage, response: http.ServerResponse) => void {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  // eslint-disable-next-line functional/no-let -- one server-local single-flight is cleared after settlement
  let inFlight: ReturnType<typeof runSetupReadiness> | undefined;
  const runOnce = (): ReturnType<typeof runSetupReadiness> => {
    if (inFlight === undefined) {
      const pending = deps.run(destDir);
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
      void runOnce()
        .then(result => reply(response, 200, serialize(result)))
        .catch(() =>
          reply(
            response,
            500,
            JSON.stringify({ error: "Unable to read Lisa setup readiness" })
          )
        );
      return;
    }
    reply(response, 405, "Method not allowed", TEXT_CONTENT_TYPE, {
      allow: "GET, HEAD",
    });
  };
}
