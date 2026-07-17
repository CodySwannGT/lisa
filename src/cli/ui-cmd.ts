/**
 * `lisa ui` — serve the Lisa settings console for a project.
 *
 * Runs a config sync first (so the config file is fully populated — the UI's
 * contract is "no unset configs"), then serves the packaged `ui/index.html`
 * with the project's merged live config injected as
 * `window.LISA_LIVE_CONFIG`, which the page uses to hydrate its controls.
 * @module cli/ui-cmd
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as http from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runConfigSync } from "../sync/config-sync.js";
import { isJsonObject, type JsonObject } from "../sync/json-path.js";
import { deepMerge, readJsonOrNull } from "../utils/index.js";
import { printSyncReport } from "./sync-cmd.js";
import {
  createGithubAuthProbe,
  readStatusSnapshot,
  validateStatusProbes,
  type ProbeResult,
  type StatusProbe,
} from "./ui-status.js";
export {
  createGithubAuthProbe,
  runProbe,
  type GithubAuthCheck,
  type ProbeResult,
  type StatusProbe,
} from "./ui-status.js";

/** Default port for the settings console. */
export const DEFAULT_UI_PORT = 4780;
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const NO_STORE = "no-store";

/** CLI options for `lisa ui`. */
export interface UiCmdOptions {
  /** Port to listen on (string because Commander passes raw option values) */
  readonly port?: string;
  /** Set false (via --no-sync) to skip the config sync on startup */
  readonly sync?: boolean;
}

/** Injectable runtime collaborators for `lisa ui`. */
export interface UiRuntimeDependencies {
  /** Status probes exposed by GET /api/status. */
  readonly probes?: readonly StatusProbe[];
}

/**
 * Locate the packaged `ui/index.html` by walking up from this module until a
 * directory containing `ui/index.html` is found (works from both `src/` and
 * the compiled `dist/`).
 * @param startDir - Directory to start searching from
 * @returns Absolute path to ui/index.html
 */
export function findUiHtml(startDir: string): string {
  const candidate = path.join(startDir, "ui", "index.html");
  if (existsSync(candidate)) {
    return candidate;
  }
  const parent = path.dirname(startDir);
  if (parent === startDir) {
    throw new Error("Unable to locate the packaged ui/index.html");
  }
  return findUiHtml(parent);
}

/**
 * Read the project's merged config view (local overlay wins per key).
 * @param destDir - Project root
 * @returns Merged config object
 */
async function readMergedConfig(destDir: string): Promise<JsonObject> {
  const committed = await readJsonOrNull<unknown>(
    path.join(destDir, ".lisa.config.json")
  );
  const local = await readJsonOrNull<unknown>(
    path.join(destDir, ".lisa.config.local.json")
  );
  const committedObject = isJsonObject(committed) ? committed : {};
  const localObject = isJsonObject(local) ? local : {};
  return deepMerge(committedObject, localObject) as JsonObject;
}

/**
 * Inject the live config into the console HTML as a script tag. The JSON is
 * escaped so a value containing `</script>` cannot break out of the tag.
 * @param html - Packaged console HTML
 * @param config - Merged live config
 * @returns HTML with the injected config
 */
export function injectLiveConfig(html: string, config: JsonObject): string {
  const payload = JSON.stringify(config).replace(/<\//g, "<\\/");
  const tag = `<script>window.LISA_LIVE_CONFIG = ${payload};</script>`;
  return html.replace("</body>", `${tag}\n</body>`);
}

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
      "content-type": "text/plain; charset=utf-8",
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
 * Build the request handler after validating the complete probe registry.
 * @param page - Hydrated settings console HTML
 * @param probes - Live-status probes registered for this server
 * @returns Loopback HTTP request handler
 */
function createUiRequestHandler(
  page: string,
  probes: readonly StatusProbe[]
): http.RequestListener {
  const readSnapshot = createStatusSnapshotReader(probes);
  validateStatusProbes(probes);
  return (request, response) => {
    const pathname = requestPathname(request.url ?? "/");
    if (pathname === undefined) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Bad request");
      return;
    }
    if (pathname === "/api/status") {
      serveStatus(request, response, readSnapshot);
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

/**
 * Run the `lisa ui` command: sync, then serve the console until interrupted.
 * @param targetPath - Project path argument (defaults to the current directory)
 * @param options - CLI options
 * @param dependencies - Optional status probes for tests and extensions
 * @returns The listening server (callers/tests are responsible for closing it)
 */
export async function runUi(
  targetPath: string | undefined,
  options: UiCmdOptions = {},
  dependencies: UiRuntimeDependencies = {}
): Promise<http.Server> {
  const destDir = path.resolve(targetPath ?? ".");
  const port = Number.parseInt(options.port ?? `${DEFAULT_UI_PORT}`, 10);
  if (Number.isNaN(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid --port value: ${options.port}`);
  }
  if (options.sync !== false) {
    const report = await runConfigSync(destDir);
    printSyncReport(report);
  }
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const htmlPath = findUiHtml(moduleDir);
  const html = await readFile(htmlPath, "utf8");
  const config = await readMergedConfig(destDir);
  const page = injectLiveConfig(html, config);
  const probes = dependencies.probes ?? [createGithubAuthProbe(destDir)];
  const server = http.createServer(createUiRequestHandler(page, probes));
  await new Promise<void>(resolve => {
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  const boundPort =
    typeof address === "object" && address !== null ? address.port : port;
  console.log(`Lisa console for ${destDir}`);
  console.log(`  → http://127.0.0.1:${boundPort}`);
  console.log("Press Ctrl+C to stop.");
  return server;
}
