/** Project-bound, same-origin caller of the existing starter landing command. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  runStarterSync,
  type StarterSyncCommandOptions,
} from "./starter-sync-command.js";
import { isExpectedLoopbackOrigin } from "./ui-request-origin.js";

/** Only the existing landing operation is replaceable by tests. */
export interface UiStarterSyncDependencies {
  readonly run: typeof runStarterSync;
}

/**
 * Serialize an outcome without allowing intermediary caching.
 * @param response - Request's response.
 * @param status - HTTP status.
 * @param outcome - Actual landing outcome or failure.
 */
function reply(
  response: ServerResponse,
  status: number,
  outcome: unknown
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(status === 405 ? { allow: "POST" } : {}),
  });
  response.end(JSON.stringify(outcome));
}

/**
 * Bind writes to the server's project and attribution, never request input.
 * Overlapping requests fail explicitly instead of starting another Git mutation.
 * @param options - Trusted server startup options.
 * @param capability - Secret generated for this console launch, never served over HTTP.
 * @param dependencies - Existing landing command boundary.
 * @returns POST handler with one active sync per console.
 */
export function createUiStarterSyncHandler(
  options: StarterSyncCommandOptions,
  capability: string,
  dependencies: Partial<UiStarterSyncDependencies> = {}
): (request: IncomingMessage, response: ServerResponse) => void {
  const run = dependencies.run ?? runStarterSync;
  // eslint-disable-next-line functional/no-let -- server-local mutation lock released only when the command settles
  let running = false;
  return (request, response) => {
    if (request.method !== "POST") {
      reply(response, 405, { state: "failed", error: "Method not allowed" });
      return;
    }
    if (
      !isExpectedLoopbackOrigin(request.headers.origin, request.headers.host) ||
      !hasLaunchCapability(request.headers["x-lisa-starter-token"], capability)
    ) {
      reply(response, 403, {
        state: "failed",
        error:
          "Open the console using its terminal launch link to authorize starter sync",
      });
      return;
    }
    if (running) {
      reply(response, 409, {
        state: "failed",
        error:
          "Starter sync is already running. Wait for its result before retrying.",
      });
      return;
    }
    running = true;
    void Promise.resolve()
      .then(() => run(options))
      .then(
        result => reply(response, 200, result),
        error =>
          reply(response, 500, {
            state: "failed",
            error:
              error instanceof Error
                ? error.message
                : "Unable to sync the starter. Check the Lisa console terminal for details.",
          })
      )
      .finally(() => {
        running = false;
      });
  };
}

/**
 * Authenticate a local caller independently of its forgeable HTTP headers.
 * @param supplied - Request capability header
 * @param expected - Per-launch capability known only to the initiating process
 * @returns Whether this request carries the current launch capability
 */
function hasLaunchCapability(
  supplied: string | string[] | undefined,
  expected: string
): boolean {
  return (
    typeof supplied === "string" &&
    /^[a-f0-9]{64}$/u.test(supplied) &&
    timingSafeEqual(
      Buffer.from(supplied, "utf8"),
      Buffer.from(expected, "utf8")
    )
  );
}
