/**
 * Runs the shipped nightly guard at its HTTP boundary, including exit status,
 * runner outputs and summary. List snapshots may disagree independently of
 * single-run detail reads, which an imported-function stub cannot prove.
 * @module tests/helpers/nightly-e2e-discovery-cli-harness
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
export type DiscoveryRun = ReturnType<typeof discoveryRun>;

/** HTTP snapshot and independent-detail inputs. */
interface DiscoveryOptions {
  readonly lists: readonly (readonly DiscoveryRun[])[];
  readonly details: Readonly<Record<number, DiscoveryRun | null>>;
  readonly jobs?: Readonly<
    Record<number, readonly { name: string; conclusion: string }[]>
  >;
  readonly scriptPath?: string;
}

/**
 * Serializes one mapped HTTP fixture, recording the request at the boundary.
 * @param options - Snapshots and independent detail records
 * @param request - Native request
 * @param response - Native response
 * @param state - Per-listener request trace and snapshot cursor
 * @param state.requests - Requests observed at the HTTP boundary
 * @param state.listIndex - Snapshot cursor for list requests
 */
function respondToDiscoveryRequest(
  options: DiscoveryOptions,
  request: IncomingMessage,
  response: ServerResponse,
  state: { requests: string[]; listIndex: number }
): void {
  /* eslint-disable functional/no-let, functional/immutable-data -- native HTTP response and per-listener request trace require bounded mutation */
  const url = new URL(request.url ?? "/", "http://localhost");
  let body: unknown;
  const match = /\/actions\/runs\/(\d+)(\/jobs|\/artifacts)?$/u.exec(
    url.pathname
  );
  state.requests.push(`${request.method} ${url.pathname}${url.search}`);
  if (url.pathname.endsWith("/workflows/e2e.yml/runs")) {
    body = {
      workflow_runs:
        options.lists[Math.min(state.listIndex, options.lists.length - 1)] ??
        [],
    };
    state.listIndex += 1;
  } else if (match !== null) {
    const id = Number(match[1]);
    if (match[2] === "/jobs")
      body = {
        jobs: options.jobs?.[id] ?? [{ name: "e2e", conclusion: "success" }],
      };
    else if (match[2] === "/artifacts")
      body = { artifacts: [{ name: "scope-full-web" }] };
    else {
      body = options.details[id];
      if (body == null) response.statusCode = 404;
    }
  } else {
    response.statusCode = 404;
    body = { message: "Unmapped HTTP fixture" };
  }
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body ?? {}));
  /* eslint-enable functional/no-let, functional/immutable-data -- remaining harness logic uses immutable records */
}

/**
 * Executes the ordinary guard without hiding its failure exit behind --json.
 * @param scriptPath - Source or released script
 * @param env - Isolated runner environment
 * @returns Process status and unmodified streams
 */
async function executeDiscoveryCli(scriptPath: string, env: NodeJS.ProcessEnv) {
  try {
    const result = await execute(process.execPath, [scriptPath], {
      cwd: ROOT,
      timeout: 20_000,
      env,
    });
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
  const state = { requests: [] as string[], listIndex: 0 };
  const server = createServer((request, response) =>
    respondToDiscoveryRequest(options, request, response, state)
  );
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing listener port");
  try {
    const result = await executeDiscoveryCli(options.scriptPath ?? GUARD_REL, {
      GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
      GITHUB_REPOSITORY: "o/r",
      GITHUB_TOKEN: "fixture-token",
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      NIGHTLY_BRANCH: "main",
      NIGHTLY_SUITES: JSON.stringify([
        { label: "Web e2e", workflow: "e2e.yml", match: { mode: "run" } },
      ]),
      NIGHTLY_API_MAX_ATTEMPTS: "3",
      NIGHTLY_API_RETRY_MAX_SECONDS: "0.001",
    });
    return {
      ...result,
      requests: state.requests,
      output: await readFile(output, "utf8"),
      summary: await readFile(summary, "utf8"),
    };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
    await rm(directory, { recursive: true, force: true });
  }
}
