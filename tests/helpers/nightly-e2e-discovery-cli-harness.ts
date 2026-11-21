/**
 * Runs the shipped nightly guard at its HTTP boundary, including exit status,
 * runner outputs and summary. List snapshots may disagree independently of
 * single-run detail reads, which an imported-function stub cannot prove.
 * @module tests/helpers/nightly-e2e-discovery-cli-harness
 */
import { execFile } from "node:child_process";
import { on } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "../..");
const GUARD_REL =
  "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs";

/**
 * Actual Actions run shape, with independently checked workflow identity.
 * @param id - Run identity
 * @param ageHours - Age relative to the real subprocess clock
 * @returns The vendor-shaped run
 */
export function discoveryRun(id: number, ageHours = 1) {
  return {
    id,
    workflow_id: 50,
    path: ".github/workflows/e2e.yml",
    status: "completed",
    conclusion: "success",
    head_branch: "main",
    head_sha: "a".repeat(40),
    event: "schedule",
    created_at: new Date(Date.now() - ageHours * 3_600_000).toISOString(),
    html_url: `https://example.test/runs/${id}`,
  };
}

/** Independent Actions run fixture. */
type DiscoveryRun = ReturnType<typeof discoveryRun>;

/** HTTP snapshot and independent-detail inputs. */
interface DiscoveryOptions {
  readonly lists: readonly (readonly DiscoveryRun[])[];
  readonly details: Readonly<Record<number, DiscoveryRun | null>>;
  readonly jobs?: Readonly<
    Record<number, readonly { name: string; conclusion: string }[]>
  >;
  readonly scriptPath?: string;
  readonly workflowRegistered?: boolean;
  readonly workflowInWorkspace?: boolean;
  readonly bootstrapUntil?: string;
}

/** The listener's trace: requests seen so far and the list-snapshot cursor. */
interface DiscoveryTrace {
  readonly requests: readonly string[];
  readonly listIndex: number;
}

/**
 * Resolves the mapped fixture body for one request path.
 * @param options - Snapshots and independent detail records
 * @param pathname - Request path
 * @param listIndex - Snapshot cursor for list requests
 * @returns HTTP status and JSON body
 */
function discoveryResponse(
  options: DiscoveryOptions,
  pathname: string,
  listIndex: number
): { readonly status: number; readonly body: unknown } {
  const match = /\/actions\/runs\/(\d+)(\/jobs|\/artifacts)?$/u.exec(pathname);
  if (pathname.endsWith("/workflows/e2e.yml/runs"))
    return {
      status: options.workflowRegistered === false ? 404 : 200,
      body: {
        workflow_runs:
          options.lists[Math.min(listIndex, options.lists.length - 1)] ?? [],
      },
    };
  if (match === null)
    return { status: 404, body: { message: "Unmapped HTTP fixture" } };
  const id = Number(match[1]);
  if (match[2] === "/jobs")
    return {
      status: 200,
      body: {
        jobs: options.jobs?.[id] ?? [{ name: "e2e", conclusion: "success" }],
      },
    };
  if (match[2] === "/artifacts")
    return { status: 200, body: { artifacts: [{ name: "scope-full-web" }] } };
  const detail = options.details[id];
  return { status: detail == null ? 404 : 200, body: detail };
}

/**
 * Serializes one mapped HTTP fixture, recording the request at the boundary.
 * @param options - Snapshots and independent detail records
 * @param request - Native request
 * @param response - Native response
 * @param trace - Requests observed before this one, and the list cursor
 * @returns The trace including this request
 */
function respondToDiscoveryRequest(
  options: DiscoveryOptions,
  request: IncomingMessage,
  response: ServerResponse,
  trace: DiscoveryTrace
): DiscoveryTrace {
  const url = new URL(request.url ?? "/", "http://localhost");
  const { status, body } = discoveryResponse(
    options,
    url.pathname,
    trace.listIndex
  );
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body ?? {}));
  return {
    requests: [
      ...trace.requests,
      `${request.method} ${url.pathname}${url.search}`,
    ],
    listIndex:
      trace.listIndex +
      (url.pathname.endsWith("/workflows/e2e.yml/runs") ? 1 : 0),
  };
}

/** One request the listener received, with its response. */
type DiscoveryExchange = [IncomingMessage, ServerResponse];

/**
 * Answer the listener's requests in arrival order until it is told to stop,
 * handing each request's trace to the next.
 * @param options - Snapshots and independent detail records
 * @param requests - The listener's requests, ended by aborting their signal
 * @param trace - Requests observed so far and the list cursor
 * @returns The complete trace once the requests stop
 */
async function answerDiscoveryRequests(
  options: DiscoveryOptions,
  requests: AsyncIterator<DiscoveryExchange>,
  trace: DiscoveryTrace
): Promise<DiscoveryTrace> {
  const next = await requests.next().catch((error: unknown) => {
    if (error instanceof Error && error.name === "AbortError")
      return { done: true, value: undefined } as const;
    throw error;
  });
  if (next.done === true) return trace;
  const [request, response] = next.value;
  return answerDiscoveryRequests(
    options,
    requests,
    respondToDiscoveryRequest(options, request, response, trace)
  );
}

/**
 * Executes the ordinary guard without hiding its failure exit behind --json.
 * @param scriptPath - Source or released script
 * @param directory - Isolated checkout
 * @param env - Isolated runner environment
 * @returns Process status and unmodified streams
 */
async function executeDiscoveryCli(
  scriptPath: string,
  directory: string,
  env: NodeJS.ProcessEnv
) {
  try {
    const result = await execute(
      process.execPath,
      [path.resolve(ROOT, scriptPath)],
      {
        cwd: directory,
        timeout: 20_000,
        env,
      }
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

/**
 * Replays independently provided discovery snapshots and run-detail records.
 * @param options - HTTP snapshots, details, jobs and optional released script
 * @returns Exit status, streams, runner outputs, summary and HTTP request trace
 */
export async function runDiscoveryCli(options: DiscoveryOptions) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "lisa-nightly-discovery-")
  );
  const output = path.join(directory, "output");
  const summary = path.join(directory, "summary");
  await Promise.all([writeFile(output, ""), writeFile(summary, "")]);
  if (options.workflowInWorkspace === true) {
    const workflows = path.join(directory, ".github", "workflows");
    await mkdir(workflows, { recursive: true });
    await writeFile(path.join(workflows, "e2e.yml"), "name: Fixture e2e\n");
  }
  const server = createServer();
  const stop = new AbortController();
  const answered = answerDiscoveryRequests(
    options,
    on(server, "request", {
      signal: stop.signal,
    }) as AsyncIterableIterator<DiscoveryExchange>,
    { requests: [], listIndex: 0 }
  );
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing listener port");
  try {
    const result = await executeDiscoveryCli(
      options.scriptPath ?? GUARD_REL,
      directory,
      {
        GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
        GITHUB_REPOSITORY: "o/r",
        GITHUB_TOKEN: "fixture-token",
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        NIGHTLY_BRANCH: "main",
        NIGHTLY_BOOTSTRAP_UNTIL: options.bootstrapUntil ?? "",
        NIGHTLY_SUITES: JSON.stringify([
          { label: "Web e2e", workflow: "e2e.yml", match: { mode: "run" } },
        ]),
        NIGHTLY_API_MAX_ATTEMPTS: "3",
        NIGHTLY_API_RETRY_MAX_SECONDS: "0.001",
      }
    );
    stop.abort();
    return {
      ...result,
      requests: (await answered).requests,
      output: await readFile(output, "utf8"),
      summary: await readFile(summary, "utf8"),
    };
  } finally {
    stop.abort();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
    await rm(directory, { recursive: true, force: true });
  }
}
