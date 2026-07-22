/**
 * `lisa ui` — serve the Lisa settings console for a project.
 *
 * Runs a config sync first (so the config file is fully populated — the UI's
 * contract is "no unset configs"), then serves the packaged `ui/index.html`
 * with the project's merged live config injected as
 * `window.LISA_LIVE_CONFIG`, which the page uses to hydrate its controls.
 * @module cli/ui-cmd
 */
/* eslint-disable max-lines -- the central UI route registry stays auditable in one module */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as http from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runConfigSync } from "../sync/config-sync.js";
import type { JsonObject } from "../sync/json-path.js";
import { printSyncReport } from "./sync-cmd.js";
import {
  inspectRemoteEnvironment,
  type RemoteEnvironmentStatus,
} from "./remote-environment.js";
import { createCiQualityJobsProbe } from "./ui-ci-quality-jobs.js";
import { createDeployPipelineProbe } from "./ui-deploy-pipeline.js";
import { createDetectedStacksProbe } from "./ui-detected-stacks.js";
import { createGithubRepoProbe } from "./ui-github-repo.js";
import { createLisaVersionProbe } from "./ui-lisa-version.js";
import {
  createGithubAuthProbe,
  readStatusSnapshot,
  validateStatusProbes,
  type ProbeResult,
  type StatusProbe,
} from "./ui-status.js";
import { createEnabledPluginsProbe } from "./ui-enabled-plugins.js";
import { createAutomationsProbe } from "./ui-automations.js";
import { createObservabilityProviderProbes } from "./ui-observability-providers.js";
import { serveConfigWrite } from "./ui-config-write.js";
import {
  createUiHealthHandler,
  type UiHealthDependencies,
} from "./ui-health.js";
import {
  createSetupReadinessReader,
  readMergedUiConfig,
  type SetupReadinessDependencies,
  type SetupReadinessResult,
} from "./ui-setup-readiness.js";
export {
  createGithubAuthProbe,
  runProbe,
  type GitRemoteReader,
  type GithubAuthCheck,
  type ProbeResult,
  type StatusProbe,
} from "./ui-status.js";
export { createGithubRepoProbe } from "./ui-github-repo.js";
export {
  createEnabledPluginsProbe,
  buildEnabledPluginsValue,
  listMarketplacePluginsFromDisk,
  type EnabledPluginRow,
  type EnabledPluginsValue,
  type MarketplacePlugin,
} from "./ui-enabled-plugins.js";
export {
  createDeployPipelineProbe,
  DEPLOY_PIPELINE_PROBE_ID,
  type DeployPipelineStage,
  type DeployPipelineValue,
} from "./ui-deploy-pipeline.js";
export {
  createDetectedStacksProbe,
  DETECTED_STACKS_PROBE_ID,
} from "./ui-detected-stacks.js";
export {
  createLisaVersionProbe,
  mapLisaVersionCheck,
  type LisaVersionValue,
} from "./ui-lisa-version.js";
export {
  createCiQualityJobsProbe,
  computeCiQualityJobs,
  parseCiWorkflowInputs,
  CI_QUALITY_JOBS_PROBE_ID,
  type CiQualityJobEntry,
  type CiQualityJobsValue,
  type CiWorkflowInputs,
  type RepoSecretsPresence,
} from "./ui-ci-quality-jobs.js";
export { createObservabilityProviderProbes } from "./ui-observability-providers.js";
export { inspectRemoteEnvironment } from "./remote-environment.js";

/** Default port for the settings console. */
export const DEFAULT_UI_PORT = 4780;
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const NO_STORE = "no-store";
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

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
  /** Health storage and execution boundaries exposed by /api/health. */
  readonly health?: Partial<UiHealthDependencies>;
  /** Read-only setup-readiness boundaries exposed by /api/setup-readiness. */
  readonly setupReadiness?: SetupReadinessDependencies;
}

/**
 * Read the CLI process environment through one explicit, reviewable exception.
 * Only boolean presence checks derived from this map reach the browser.
 * @returns Current process environment
 */
function getProcessEnvironment(): NodeJS.ProcessEnv {
  // eslint-disable-next-line no-restricted-syntax -- CLI status view must inspect externally supplied remote-environment variables once
  return process.env;
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
 * Inject the live config into the console HTML as a script tag. The JSON is
 * escaped so a value containing `</script>` cannot break out of the tag.
 * @param html - Packaged console HTML
 * @param config - Merged live config
 * @param remoteEnvironment - Boolean-only secret and startup-artifact status
 * @returns HTML with the injected config
 */
export function injectLiveConfig(
  html: string,
  config: JsonObject,
  remoteEnvironment: RemoteEnvironmentStatus = {
    projectTypes: [],
    variables: [],
    startupScripts: [],
  }
): string {
  const payload = JSON.stringify(config).replace(/<\//g, "<\\/");
  const remotePayload = JSON.stringify(remoteEnvironment).replace(
    /<\//g,
    "<\\/"
  );
  const tag = `<script>window.LISA_LIVE_CONFIG = ${payload}; window.LISA_REMOTE_ENVIRONMENT = ${remotePayload};</script>`;
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
 * Coalesce concurrent first-open setup reads without caching later requests.
 * @param readCurrent - Current projection reader
 * @returns Single-flight reader that clears after settlement
 */
function createSetupReadinessSnapshotReader(
  readCurrent: () => Promise<SetupReadinessResult>
): () => Promise<SetupReadinessResult> {
  // eslint-disable-next-line functional/no-let -- single-flight state clears after settlement
  let inFlight: Promise<SetupReadinessResult> | undefined;
  return () => {
    if (inFlight === undefined) {
      const pending = readCurrent();
      inFlight = pending;
      const clear = (): void => {
        if (inFlight === pending) inFlight = undefined;
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
 * Serve a current, non-persisted Setup readiness projection.
 * @param request - Incoming loopback request
 * @param response - Response associated with the request
 * @param readCurrent - Current projection reader
 */
function serveSetupReadiness(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  readCurrent: () => Promise<SetupReadinessResult>
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
  void readCurrent().then(
    result => {
      response.writeHead(200, {
        "cache-control": NO_STORE,
        "content-type": JSON_CONTENT_TYPE,
      });
      response.end(JSON.stringify(result));
    },
    () => {
      response.writeHead(500, {
        "cache-control": NO_STORE,
        "content-type": JSON_CONTENT_TYPE,
      });
      response.end(
        JSON.stringify({ error: "Unable to observe setup readiness" })
      );
    }
  );
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
 * @param healthDependencies - Injectable Health v1 storage/run boundaries
 * @param setupReadinessDependencies - Injectable read-only Setup boundaries
 * @returns Loopback HTTP request handler
 */
function createUiRequestHandler(
  page: string,
  probes: readonly StatusProbe[],
  destDir: string,
  healthDependencies: Partial<UiHealthDependencies> = {},
  setupReadinessDependencies: SetupReadinessDependencies = {}
): http.RequestListener {
  const readSnapshot = createStatusSnapshotReader(probes);
  const serveHealth = createUiHealthHandler(destDir, healthDependencies);
  const readCurrentSetup = createSetupReadinessSnapshotReader(
    createSetupReadinessReader(destDir, setupReadinessDependencies)
  );
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
    if (pathname === "/api/health") {
      serveHealth(request, response);
      return;
    }
    if (pathname === "/api/setup-readiness") {
      serveSetupReadiness(request, response, readCurrentSetup);
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
  // Keep the read-only console available when config is malformed or unsafe;
  // probes receive no claims instead of importing untrusted evidence. The
  // config write endpoint still reads the originals strictly and fails closed.
  const config = await readMergedUiConfig(destDir).catch(() => ({}));
  const remoteEnvironment = await inspectRemoteEnvironment(
    destDir,
    config,
    getProcessEnvironment()
  );
  const page = injectLiveConfig(html, config, remoteEnvironment);
  const probes = dependencies.probes ?? [
    createGithubAuthProbe(destDir),
    createEnabledPluginsProbe(destDir),
    createDetectedStacksProbe(destDir),
    createLisaVersionProbe(),
    createCiQualityJobsProbe(destDir, config),
    createDeployPipelineProbe(destDir),
    createGithubRepoProbe(destDir, config),
    ...createObservabilityProviderProbes(),
    createAutomationsProbe({ cwd: destDir }),
  ];
  const server = http.createServer(
    createUiRequestHandler(
      page,
      probes,
      destDir,
      dependencies.health,
      dependencies.setupReadiness
    )
  );
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
/* eslint-enable max-lines -- restore repository default */
