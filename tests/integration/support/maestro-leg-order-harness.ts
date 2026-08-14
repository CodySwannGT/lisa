/**
 * Harness for the Maestro leg-ordering tests.
 *
 * Two things the assertions need, neither of which may be re-implemented: a
 * fake GitHub jobs API that the workflow's own poll loop can be pointed at, and
 * a runner that executes step scripts taken verbatim out of the YAML. Copying a
 * poll loop or a platform fan-out into a test makes the test agree with itself
 * rather than with the workflow.
 *
 * The scripted API hands out one response per request by walking an iterator
 * and repeating the final entry — no request counter, because the property the
 * tests actually assert ("it kept asking until the answer changed") is readable
 * from the step's own stdout, which is better evidence than a number this file
 * made up.
 *
 * @module tests/integration/support/maestro-leg-order-harness
 */

import * as fs from "fs-extra";
import { execFile, execFileSync } from "node:child_process";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import type { SimulatedWorkflow } from "../../helpers/workflow-job-graph";

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** One entry of the Actions jobs API, trimmed to what the step reads. */
export interface ApiJob {
  name: string;
  status: string;
  conclusion: string | null;
}

/** A fake jobs API. */
export interface FakeApi {
  url: string;
  close: () => Promise<void>;
}

/** What running a step produced. */
export interface StepRun {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * An iOS job entry in whichever lifecycle state a test needs.
 *
 * The name carries the caller prefix on purpose: a reusable workflow's jobs are
 * reported by the API as `<caller job name> / <called job name>`, so a fixture
 * without it would pass against an equality match that can never fire in
 * production.
 *
 * @param status The API `status` field.
 * @param conclusion The API `conclusion` field, null while not completed.
 * @returns The job entry.
 */
export const iosApiJob = (
  status: string,
  conclusion: string | null
): ApiJob => ({
  name: "📱 Maestro Native E2E / 🍎 Maestro iOS",
  status,
  conclusion,
});

/** An Android job entry, which must never satisfy the iOS match. */
export const ANDROID_API_JOB: ApiJob = {
  name: "📱 Maestro Native E2E / 🤖 Maestro Android",
  status: "in_progress",
  conclusion: null,
};

/**
 * Publishes a listening server as a fake API handle.
 *
 * @param server The server to listen with.
 * @returns Its base URL and a shutdown hook.
 */
const publish = async (server: http.Server): Promise<FakeApi> => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>(resolve => {
        server.close(() => resolve());
      }),
  };
};

/**
 * Starts a fake GitHub jobs API serving a scripted sequence of job lists.
 *
 * @param script One job list per request; the final entry repeats forever.
 * @returns The base URL and a shutdown hook.
 */
export const startFakeApi = (script: ApiJob[][]): Promise<FakeApi> => {
  const remaining = script[Symbol.iterator]();
  const nextJobs = (): ApiJob[] => {
    const step = remaining.next();
    return step.done === true ? script[script.length - 1] : step.value;
  };
  return publish(
    http.createServer((_request, response) => {
      const jobs = nextJobs();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ total_count: jobs.length, jobs }));
    })
  );
};

/**
 * Starts a fake jobs API that refuses every request with the given status.
 *
 * @param status The HTTP status to answer with.
 * @returns The base URL and a shutdown hook.
 */
export const startRefusingApi = (status: number): Promise<FakeApi> =>
  publish(
    http.createServer((_request, response) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "Resource not accessible" }));
    })
  );

/**
 * Starts a fake jobs API that fails `failures` times, then serves `jobs`.
 *
 * The failures are 5xx — the transport-flake shape the poll loop must ride out
 * rather than treat as a verdict.
 *
 * @param failures How many leading requests answer 502.
 * @param jobs The job list served from then on.
 * @returns The base URL and a shutdown hook.
 */
export const startFlakyApi = (
  failures: number,
  jobs: ApiJob[]
): Promise<FakeApi> => {
  const script: ApiJob[][] = Array.from({ length: failures }, () => []);
  const remaining = script[Symbol.iterator]();
  return publish(
    http.createServer((_request, response) => {
      const step = remaining.next();
      if (step.done !== true) {
        response.writeHead(502, { "content-type": "text/html" });
        response.end("<html>bad gateway</html>");
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ total_count: jobs.length, jobs }));
    })
  );
};

/**
 * Runs the leg-ordering wait step's REAL shell against a fake jobs API.
 *
 * Deliberately asynchronous. The fake API lives in the test process, so a
 * synchronous child would block the event loop the server needs to answer
 * curl — the step would then hang forever against a server that is up.
 *
 * @param workflow The parsed workflow.
 * @param job The job id holding the wait step.
 * @param api The fake API to point it at.
 * @param overrides Env overrides on top of the step's own declared values.
 * @returns The exit status and captured output.
 */
export const runWaitStep = (
  workflow: SimulatedWorkflow,
  job: string,
  api: FakeApi,
  overrides: Record<string, string> = {}
): Promise<StepRun> => {
  const step = (workflow.jobs[job].steps ?? [])[0];
  if (!step?.run) throw new Error(`${job} wait step not found`);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-leg-order-"));
  return new Promise<StepRun>(resolve => {
    execFile(
      BASH,
      ["-c", step.run ?? ""],
      {
        cwd: scratch,
        encoding: "utf-8",
        env: {
          PATH: process.env.PATH ?? "",
          HOME: scratch,
          GH_TOKEN: "fake-token",
          API_URL: api.url,
          REPOSITORY: "acme/app",
          RUN_ID: "1",
          RUN_ATTEMPT: "1",
          IOS_JOB_NAME: String(workflow.jobs.ios.name),
          POLL_SECONDS: "0.05",
          PRE_SUITE_TIMEOUT_MINUTES: "1",
          DISCOVERY_SLACK_MINUTES: "1",
          MAX_PAGES: "10",
          MAX_TRANSIENT: "5",
          ...overrides,
        },
      },
      (error, stdout, stderr) =>
        resolve({
          status: typeof error?.code === "number" ? error.code : error ? -1 : 0,
          stdout,
          stderr,
        })
    );
  });
};

/**
 * Runs the preflight step's real shell and returns the outputs it wrote.
 *
 * The platform fan-out is preflight's decision; re-deriving it here would let
 * the simulation and the workflow disagree without any test noticing.
 *
 * @param workflow The parsed workflow.
 * @param platform The `platform` input value.
 * @returns The `$GITHUB_OUTPUT` key/value pairs the step wrote.
 */
export const runPreflight = (
  workflow: SimulatedWorkflow,
  platform: string
): Record<string, string> => {
  const step = (workflow.jobs.preflight.steps ?? []).find(
    candidate => candidate.id === "check"
  );
  if (!step?.run) throw new Error("preflight check step not found");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-preflight-"));
  const flowsDir = path.join(scratch, "flows");
  const outputFile = path.join(scratch, "github-output");
  fs.mkdirpSync(flowsDir);
  fs.writeFileSync(outputFile, "");
  execFileSync(BASH, ["-e", "-c", step.run], {
    cwd: scratch,
    encoding: "utf-8",
    env: {
      ...process.env,
      EXPO_TOKEN: "token",
      PLATFORM: platform,
      FLOWS_DIR: flowsDir,
      REQUIRE_PREREQUISITES: "false",
      GITHUB_OUTPUT: outputFile,
    },
  });
  return Object.fromEntries(
    fs
      .readFileSync(outputFile, "utf-8")
      .split("\n")
      .filter(line => line.includes("="))
      .map(line => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1),
      ])
  );
};

/**
 * Normalizes a job's `needs` to a list.
 *
 * @param workflow The parsed workflow.
 * @param job The job id.
 * @returns The dependency job names.
 */
export const needsOf = (workflow: SimulatedWorkflow, job: string): string[] => {
  const declared = workflow.jobs[job].needs;
  return typeof declared === "string" ? [declared] : (declared ?? []);
};
