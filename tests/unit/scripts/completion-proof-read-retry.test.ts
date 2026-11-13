/**
 * The completion-proof transport retries a transient GitHub read a bounded
 * number of times, then still fails closed (CodySwannGT/lisa#4733).
 *
 * A publish makes about a hundred reads. Replaying one caller repo's read set
 * found roughly 1% of calls failing at random — a connect timeout, a TLS
 * handshake timeout, a truncated asset body — and each one aborted the whole
 * publish. A retry absorbs that noise; a refusal GitHub actually meant (403,
 * 404, a byte ceiling, gh not installed) is still reported on the first try.
 * @module tests/unit/scripts/completion-proof-read-retry
 */
import { describe, expect, it } from "vitest";

import { githubProofTransport } from "../../../all/copy-overwrite/scripts/lib/completion-proof-github.mjs";

const REPOSITORY = "acme/code";
const ROOT = `repos/${REPOSITORY}`;
const OCTET = "Accept: application/octet-stream";
const READ_ERROR = "read-error";
const BODY = Buffer.from('{"recorded":true}\n');
const FOUR_ATTEMPTS = "after 4 attempts";
const NOT_FOUND = "gh: Not Found (HTTP 404)\n";
const BAD_GATEWAY = "gh: Bad Gateway (HTTP 502)\n";

interface Result {
  status: number | null;
  stdout: string | Buffer;
  stderr: string;
  error?: Error & { code?: string };
}

/**
 * A runner that answers from a script of results, one per call, then repeats
 * the last; every argument vector it ran is kept.
 * @param results - The scripted outcomes, in call order.
 * @returns The runner and the calls it saw.
 */
function scripted(results: Result[]) {
  const calls: string[][] = [];
  const run = (_command: string, args: string[]) => {
    calls.push(args);
    return results[Math.min(calls.length - 1, results.length - 1)];
  };
  return { run, calls };
}

/**
 * A transport whose retry backoff is recorded instead of slept.
 * @param run - The scripted runner.
 * @returns The transport and the delays it waited.
 */
function instant(run: ReturnType<typeof scripted>["run"]) {
  const waited: number[] = [];
  const transport = githubProofTransport(
    run,
    REPOSITORY,
    {},
    {
      sleep: (ms: number) => {
        waited.push(ms);
      },
    }
  );
  return { transport, waited };
}

const ok = (stdout: string | Buffer): Result => ({
  status: 0,
  stdout,
  stderr: "",
});
const failed = (stderr: string): Result => ({ status: 1, stdout: "", stderr });
const spawnError = (code: string): Result => ({
  status: null,
  stdout: "",
  stderr: "",
  error: Object.assign(new Error(`spawnSync gh ${code}`), { code }),
});

/**
 * Run one read and capture its refusal.
 * @param read - The transport read under test.
 * @returns The thrown completion-proof error.
 */
function refusal(read: () => unknown) {
  try {
    read();
  } catch (error) {
    return error as Error & { category?: string };
  }
  throw new Error("the read was expected to fail");
}

describe("transient reads are retried", () => {
  it("recovers from a TLS handshake timeout on the second attempt", () => {
    const { run, calls } = scripted([
      failed("Get https://api.github.com/: net/http: TLS handshake timeout\n"),
      ok('{"id":7}'),
    ]);
    const { transport, waited } = instant(run);
    expect(transport.json(`${ROOT}/pulls/7`)).toEqual({ id: 7 });
    expect(calls).toHaveLength(2);
    expect(waited).toEqual([250]);
  });

  it.each([
    [
      "a connect timeout",
      failed("dial tcp 140.82.114.6:443: connect: operation timed out\n"),
    ],
    ["a connection reset", failed("read tcp: connection reset by peer\n")],
    [
      "an unexpected EOF",
      failed("Post https://api.github.com/graphql: unexpected EOF\n"),
    ],
    ["an i/o timeout", failed("read tcp 10.0.0.1:443: i/o timeout\n")],
    ["HTTP 502", failed(BAD_GATEWAY)],
    ["a spawn timeout", spawnError("ETIMEDOUT")],
  ])("recovers from %s", (_label, first) => {
    const { run, calls } = scripted([first, ok('{"id":7}')]);
    expect(instant(run).transport.json(`${ROOT}/pulls/7`)).toEqual({ id: 7 });
    expect(calls).toHaveLength(2);
  });

  it("recovers from a truncated JSON body by reading it again", () => {
    const { run, calls } = scripted([ok('{"id":'), ok('{"id":7}')]);
    expect(instant(run).transport.json(`${ROOT}/commits/abc`)).toEqual({
      id: 7,
    });
    expect(calls).toHaveLength(2);
  });

  it("retries a raw call such as the publisher identity read", () => {
    const { run, calls } = scripted([
      failed("gh: Service Unavailable (HTTP 503)\n"),
      ok('{"id":1}'),
    ]);
    expect(String(instant(run).transport.call(["api", "user"]))).toBe(
      '{"id":1}'
    );
    expect(calls).toHaveLength(2);
  });

  it("retries a call that names GET explicitly", () => {
    const { run, calls } = scripted([failed(BAD_GATEWAY), ok("{}")]);
    instant(run).transport.call(["api", "--method", "GET", `${ROOT}/pulls/7`]);
    expect(calls).toHaveLength(2);
  });

  it("fails closed after four attempts, naming the endpoint and the attempt count", () => {
    const { run, calls } = scripted([
      failed("gh: Service Unavailable (HTTP 503)\n"),
    ]);
    const { transport, waited } = instant(run);
    const error = refusal(() => transport.json(`${ROOT}/compare/a...b`));
    expect(error.category).toBe(READ_ERROR);
    expect(error.message).toContain("compare/a...b");
    expect(error.message).toContain("HTTP 503");
    expect(error.message).toContain(FOUR_ATTEMPTS);
    expect(calls).toHaveLength(4);
    expect(waited).toEqual([250, 1000, 3000]);
  });

  it("names the endpoint and attempt count when the body never parses", () => {
    const { run, calls } = scripted([ok("{")]);
    const error = refusal(() =>
      instant(run).transport.json(`${ROOT}/actions/runs/31`)
    );
    expect(error.category).toBe(READ_ERROR);
    expect(error.message).toContain("not complete JSON");
    expect(error.message).toContain("actions/runs/31");
    expect(error.message).toContain(FOUR_ATTEMPTS);
    expect(calls).toHaveLength(4);
  });
});

describe("refusals GitHub meant are not retried", () => {
  it.each([
    ["HTTP 401", failed("gh: Bad credentials (HTTP 401)\n")],
    [
      "HTTP 403",
      failed("gh: Resource not accessible by integration (HTTP 403)\n"),
    ],
    ["HTTP 404", failed(NOT_FOUND)],
    ["HTTP 422", failed("gh: Validation Failed (HTTP 422)\n")],
    ["a byte-ceiling overflow", spawnError("ENOBUFS")],
    ["gh not being runnable", spawnError("ENOENT")],
    ["an unknown flag", failed("unknown flag: --frobnicate\n")],
  ])("fails %s on the first attempt", (_label, result) => {
    const { run, calls } = scripted([result, ok('{"id":7}')]);
    const { transport, waited } = instant(run);
    const error = refusal(() => transport.json(`${ROOT}/pulls/7`));
    expect(error.category).toBe(READ_ERROR);
    expect(error.message).toContain("pulls/7");
    expect(error.message).not.toContain("attempts");
    expect(calls).toHaveLength(1);
    expect(waited).toEqual([]);
  });

  it.each([
    ["-X POST", ["api", "-X", "POST", `${ROOT}/issues/1/comments`]],
    ["--method=PATCH", ["api", "--method=PATCH", `${ROOT}/issues/1`]],
    ["-f", ["api", `${ROOT}/issues/1/comments`, "-f", "body=x"]],
    ["-F", ["api", `${ROOT}/issues/1/comments`, "-F", "body=x"]],
    ["--field", ["api", `${ROOT}/issues/1/comments`, "--field", "body=x"]],
    [
      "--raw-field",
      ["api", `${ROOT}/issues/1/comments`, "--raw-field", "body=x"],
    ],
    ["--input", ["api", `${ROOT}/issues/1/comments`, "--input", "-"]],
  ])("runs a writing call (%s) exactly once, even on a 502", (_label, args) => {
    const { run, calls } = scripted([failed(BAD_GATEWAY), ok("{}")]);
    const { transport, waited } = instant(run);
    const error = refusal(() => transport.call(args));
    expect(error.category).toBe(READ_ERROR);
    expect(error.message).toContain("HTTP 502");
    expect(calls).toHaveLength(1);
    expect(waited).toEqual([]);
  });

  it("does not retry a pagination bound that is genuinely exceeded", () => {
    const pages = JSON.stringify(Array.from({ length: 101 }, () => []));
    const { run, calls } = scripted([ok(pages)]);
    const error = refusal(() =>
      instant(run).transport.json(`${ROOT}/releases/9/assets`, true)
    );
    expect(error.message).toContain("pagination");
    expect(calls).toHaveLength(1);
  });
});

describe("asset downloads", () => {
  /**
   * Native-shaped metadata for one asset of the given size.
   * @param id - Native asset identifier.
   * @returns Release-asset metadata as GitHub reports it.
   */
  function metadata(id: number) {
    return JSON.stringify({
      id,
      name: `evidence-${id}.json`,
      state: "uploaded",
      size: BODY.length,
      browser_download_url: `https://github.com/${REPOSITORY}/releases/download/pr-assets/evidence-${id}.json`,
    });
  }

  /**
   * A runner serving metadata, then the given raw download results in turn.
   * @param downloads - Raw download outcomes, in order; the last repeats.
   * @returns The runner and the raw download calls it saw.
   */
  function downloads(downloads: Result[]) {
    const raw: string[][] = [];
    const run = (_command: string, args: string[]) => {
      if (!args.includes(OCTET)) return ok(metadata(7));
      raw.push(args);
      return downloads[Math.min(raw.length - 1, downloads.length - 1)];
    };
    return { run, raw };
  }

  it("downloads again when the first body is truncated", () => {
    const { run, raw } = downloads([ok(BODY.subarray(0, 5)), ok(BODY)]);
    const { transport, waited } = instant(run);
    expect(transport.asset(7).bytes.equals(BODY)).toBe(true);
    expect(raw).toHaveLength(2);
    expect(waited).toEqual([250]);
  });

  it("refuses a download that stays incomplete, naming the attempt count", () => {
    const { run, raw } = downloads([ok(BODY.subarray(0, 5))]);
    const error = refusal(() => instant(run).transport.asset(7));
    expect(error.message).toContain("download is incomplete");
    expect(error.message).toContain(FOUR_ATTEMPTS);
    expect(raw).toHaveLength(4);
  });

  it("does not count gh rejecting the escape flag as a failed attempt", () => {
    const { run, raw } = downloads([
      failed("unknown flag: --allow-escape-sequences\n"),
      failed("dial tcp: connect: operation timed out\n"),
      ok(BODY),
    ]);
    const { transport, waited } = instant(run);
    expect(transport.asset(7).bytes.equals(BODY)).toBe(true);
    expect(raw).toHaveLength(3);
    expect(waited).toEqual([250]);
  });
});

describe("collaborator authority reads", () => {
  const user = { id: 41, login: "octo", type: "User" };
  const PERMISSION = `${ROOT}/collaborators/octo/permission`;

  it("treats a 404 as not a collaborator, on the first attempt", () => {
    const { run, calls } = scripted([failed(NOT_FOUND)]);
    expect(instant(run).transport.eligibleCommentAuthor(user, 1)).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("retries a transient failure before deciding", () => {
    const { run, calls } = scripted([
      failed("net/http: TLS handshake timeout\n"),
      ok(JSON.stringify({ user: { id: 41 }, permission: "write" })),
    ]);
    expect(instant(run).transport.eligibleCommentAuthor(user, 1)).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("names the endpoint when the permission never parses", () => {
    const { run } = scripted([ok("{")]);
    const error = refusal(() =>
      instant(run).transport.eligibleCommentAuthor(user, 1)
    );
    expect(error.category).toBe(READ_ERROR);
    expect(error.message).toContain("unreadable");
    expect(error.message).toContain(PERMISSION.slice(ROOT.length + 1));
    expect(error.message).toContain(FOUR_ATTEMPTS);
  });
});

describe("optional reads", () => {
  it("answers null for an explicit 404 without retrying", () => {
    const { run, calls } = scripted([failed(NOT_FOUND)]);
    expect(
      instant(run).transport.optionalJson(`${ROOT}/releases/tags/pr-assets`)
    ).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("retries a 5xx and names the release endpoint when it persists", () => {
    const { run, calls } = scripted([
      failed("gh: Internal Server Error (HTTP 500)\n"),
    ]);
    const error = refusal(() =>
      instant(run).transport.optionalJson(`${ROOT}/releases/tags/pr-assets`)
    );
    expect(error.category).toBe(READ_ERROR);
    expect(error.message).toContain("releases/tags/pr-assets");
    expect(error.message).toContain(FOUR_ATTEMPTS);
    expect(calls).toHaveLength(4);
  });

  it("names the release endpoint when its metadata is not JSON", () => {
    const { run } = scripted([ok("<html>")]);
    const error = refusal(() =>
      instant(run).transport.optionalJson(`${ROOT}/releases/tags/pr-assets`)
    );
    expect(error.message).toContain("not complete JSON");
    expect(error.message).toContain("releases/tags/pr-assets");
  });
});
