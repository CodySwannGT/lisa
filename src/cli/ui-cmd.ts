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

/** Default port for the settings console. */
export const DEFAULT_UI_PORT = 4780;

/** CLI options for `lisa ui`. */
export interface UiCmdOptions {
  /** Port to listen on (string because Commander passes raw option values) */
  readonly port?: string;
  /** Set false (via --no-sync) to skip the config sync on startup */
  readonly sync?: boolean;
}

/** Secret/variable and generated-artifact status exposed to the console. */
export interface RemoteEnvironmentStatus {
  /** Whether each supported variable is visible to the `lisa ui` process. */
  readonly variables: Readonly<Record<string, boolean>>;
  /** Whether each remote-environment startup artifact exists in the project. */
  readonly artifacts: Readonly<Record<string, boolean>>;
}

/** Variables the remote AWS bootstrap understands. Values are never exposed. */
export const REMOTE_ENVIRONMENT_VARIABLES = [
  "LISA_AWS_BOOTSTRAP_JSON",
  "LISA_REMOTE_AGENT",
  "LISA_AWS_DEFAULT_PROFILE",
] as const;

/** Project-relative artifacts used by remote coding environments. */
export const REMOTE_ENVIRONMENT_ARTIFACTS = [
  "scripts/remote-agent-aws-setup.sh",
  ".cursor/environment.json",
  ".github/workflows/copilot-setup-steps.yml",
] as const;

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
 * Inspect remote-environment readiness without ever reading a variable value
 * into the browser payload.
 * @param destDir - Project root
 * @param environment - Environment visible to the Lisa process
 * @returns Boolean-only variable and artifact status
 */
export function inspectRemoteEnvironment(
  destDir: string,
  environment: NodeJS.ProcessEnv = getProcessEnvironment()
): RemoteEnvironmentStatus {
  return {
    variables: Object.fromEntries(
      REMOTE_ENVIRONMENT_VARIABLES.map(name => [
        name,
        typeof environment[name] === "string" && environment[name]!.length > 0,
      ])
    ),
    artifacts: Object.fromEntries(
      REMOTE_ENVIRONMENT_ARTIFACTS.map(relativePath => [
        relativePath,
        existsSync(path.join(destDir, relativePath)),
      ])
    ),
  };
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
 * @param remoteEnvironment - Boolean-only secret and startup-artifact status
 * @returns HTML with the injected config
 */
export function injectLiveConfig(
  html: string,
  config: JsonObject,
  remoteEnvironment: RemoteEnvironmentStatus = {
    variables: {},
    artifacts: {},
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
 * Run the `lisa ui` command: sync, then serve the console until interrupted.
 * @param targetPath - Project path argument (defaults to the current directory)
 * @param options - CLI options
 * @returns The listening server (callers/tests are responsible for closing it)
 */
export async function runUi(
  targetPath: string | undefined,
  options: UiCmdOptions = {}
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
  const remoteEnvironment = inspectRemoteEnvironment(destDir);
  const page = injectLiveConfig(html, config, remoteEnvironment);

  const server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    if (url === "/" || url.startsWith("/index.html") || url.startsWith("/#")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(page);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
  });
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
