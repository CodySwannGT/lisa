/**
 * Loopback HTTP handlers for the Lisa settings console server.
 * @module cli/ui-cmd-http
 */
import * as http from "node:http";
import {
  readStatusSnapshot,
  validateStatusProbes,
  type ProbeResult,
  type StatusProbe,
} from "./ui-status.js";
import { serveConfigWrite } from "./ui-config-write.js";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const NO_STORE = "no-store";
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

/**
 * Create a single-flight reader that coalesces concurrent status requests.
 * @param probes - Validated live-status probes
 * @returns Snapshot reader shared by one UI server
 */
function createStatusSnapshotReader(
  probes: readonly StatusProbe[]
): () => Promise<Record<string, ProbeResult>> {
  // eslint-disable-next-line functional/no-let -- single-flight state clears after settlement
  let inFlight: Promise<Record<string, ProbeResult>> | undefined;
  return () => {
    if (inFlight === undefined) {
      const pending = readStatusSnapshot(probes);
      inFlight = pending;
      const clear = (): void => {
        if (inFlight === pending) {
          inFlight = undefined;
        }
      };
      void pending.then(clear, clear);
    }
    return inFlight;
  };
}

/**
 * Serve the same-origin live-status endpoint.
 * @param request - Incoming loopback request
 * @param response - Response associated with the request
 * @param readSnapshot - Single-flight status snapshot reader
 */
function serveStatus(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  readSnapshot: () => Promise<Record<string, ProbeResult>>
): void {
  if (request.method === "HEAD") {
    response.writeHead(200, {
      "cache-control": NO_STORE,
      "content-type": JSON_CONTENT_TYPE,
    });
    response.end();
    return;
  }
  if (request.method !== "GET") {
    response.writeHead(405, {
      allow: "GET, HEAD",
      "cache-control": NO_STORE,
      "content-type": TEXT_CONTENT_TYPE,
    });
    response.end("Method not allowed");
    return;
  }
  void readSnapshot()
    .then(snapshot => {
      response.writeHead(200, {
        "cache-control": NO_STORE,
        "content-type": JSON_CONTENT_TYPE,
      });
      response.end(JSON.stringify({ probes: snapshot }));
    })
    .catch(error => {
      response.writeHead(500, {
        "cache-control": NO_STORE,
        "content-type": JSON_CONTENT_TYPE,
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      );
    });
}

/**
 * Parse an HTTP request target without allowing malformed input to escape.
 * @param requestUrl - Raw request target supplied by Node HTTP
 * @returns Parsed pathname, or undefined for an invalid target
 */
function requestPathname(requestUrl: string): string | undefined {
  try {
    return new URL(requestUrl, "http://127.0.0.1").pathname;
  } catch {
    return undefined;
  }
}

/**
 * Restrict loopback requests to the authority advertised by `lisa ui`.
 * @param host - Incoming HTTP Host header
 * @returns Whether the authority is 127.0.0.1 with an optional valid port
 */
function isLoopbackHost(host: string | undefined): boolean {
  if (host === "127.0.0.1") {
    return true;
  }
  const prefix = "127.0.0.1:";
  if (host === undefined || !host.startsWith(prefix)) {
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
 * Build the request handler after validating the complete probe registry.
 * @param page - Hydrated settings console HTML
 * @param probes - Live-status probes registered for this server
 * @param destDir - Project root served by this UI process
 * @returns Loopback HTTP request handler
 */
export function createUiRequestHandler(
  page: string,
  probes: readonly StatusProbe[],
  destDir: string
): http.RequestListener {
  const readSnapshot = createStatusSnapshotReader(probes);
  validateStatusProbes(probes);
  return (request, response) => {
    if (!isLoopbackHost(request.headers.host)) {
      response.writeHead(400, { "content-type": TEXT_CONTENT_TYPE });
      response.end("Bad request");
      return;
    }
    const pathname = requestPathname(request.url ?? "/");
    if (pathname === undefined) {
      response.writeHead(400, { "content-type": TEXT_CONTENT_TYPE });
      response.end("Bad request");
      return;
    }
    if (pathname === "/api/status") {
      serveStatus(request, response, readSnapshot);
      return;
    }
    if (pathname === "/api/config") {
      serveConfigWrite(request, response, destDir);
      return;
    }
    if (pathname === "/" || pathname === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(page);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
  };
}
