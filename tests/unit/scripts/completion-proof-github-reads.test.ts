/**
 * The completion-proof transport's raw downloads and read-failure reports
 * (CodySwannGT/lisa#4773).
 *
 * Since gh v2.97.0 (GHSA-3m3g-3wcr-px46) `gh api` refuses to print a raw body
 * that holds terminal escape sequences unless `--allow-escape-sequences` is
 * passed, and an older gh rejects that flag as unknown. An evidence attachment
 * holding an ANSI-coloured test log therefore failed every terminal transition
 * on the CI runner's gh 2.103.3 while reading fine on a laptop's gh 2.88.1, and
 * the refusal said only "a required read did not complete". These cases pin
 * both gh behaviours and a failure report that names the read that failed.
 * @module tests/unit/scripts/completion-proof-github-reads
 */
import { describe, expect, it } from "vitest";

import { githubProofTransport } from "../../../all/copy-overwrite/scripts/lib/completion-proof-github.mjs";

const REPOSITORY = "acme/code";
const ROOT = `repos/${REPOSITORY}`;
const OCTET = "Accept: application/octet-stream";
const ESCAPE_FLAG = "--allow-escape-sequences";
const READ_ERROR = "read-error";
/** Retried reads skip the backoff wait (#4733). */
const NO_WAIT = { sleep: () => undefined };
/** A raw test log as a coloured reporter writes it: ESC bytes included. */
const ANSI_LOG = Buffer.from(
  "\u001b[32m✓\u001b[39m suite > case\nTests 1 passed\n"
);
/** gh >= 2.97's refusal, verbatim. */
const GH_2103_REFUSAL =
  "the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway\n";
/** gh < 2.97's refusal of the flag, verbatim. */
const GH_2881_REFUSAL = `unknown flag: ${ESCAPE_FLAG}\n\nUsage:  gh api <endpoint> [flags]\n`;
/** A fake credential of the shape gh can echo; it must never be reported. */
const FAKE_TOKEN = `ghs_${"A1b2C3d4".repeat(4)}`;

interface Call {
  args: string[];
}

/**
 * Native-shaped metadata for one stub asset.
 * @param id - Native asset identifier.
 * @param size - Byte size the metadata declares.
 * @returns Release-asset metadata as GitHub reports it.
 */
function metadata(id: number, size: number) {
  return {
    id,
    name: `evidence-${id}.log`,
    state: "uploaded",
    size,
    browser_download_url: `https://github.com/${REPOSITORY}/releases/download/pr-assets/evidence-${id}.log`,
  };
}

/**
 * A stub `gh` modelling one CLI version's escape-sequence behaviour.
 * @param version - "2.103" refuses ESC bodies without the flag; "2.88" rejects the flag.
 * @param calls - Every argument vector the transport ran, in order.
 * @returns A `run` compatible with the canonical runner.
 */
function ghStub(version: "2.103" | "2.88", calls: Call[]) {
  return (_command: string, args: string[]) => {
    calls.push({ args });
    const raw = args.includes(OCTET);
    if (version === "2.88" && args.includes(ESCAPE_FLAG))
      return { status: 1, stdout: Buffer.alloc(0), stderr: GH_2881_REFUSAL };
    if (raw) {
      if (version === "2.103" && !args.includes(ESCAPE_FLAG))
        return { status: 1, stdout: Buffer.alloc(0), stderr: GH_2103_REFUSAL };
      return { status: 0, stdout: ANSI_LOG, stderr: "" };
    }
    const id = Number(args.at(-1)?.split("/").at(-1));
    return {
      status: 0,
      stdout: JSON.stringify(metadata(id, ANSI_LOG.length)),
      stderr: "",
    };
  };
}

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

describe("raw evidence downloads across gh versions", () => {
  it("downloads an ANSI-coloured attachment on gh 2.103, which refuses escape sequences without the flag", () => {
    const calls: Call[] = [];
    const transport = githubProofTransport(ghStub("2.103", calls), REPOSITORY);
    const asset = transport.asset(7);
    expect(asset.bytes.equals(ANSI_LOG)).toBe(true);
    const downloads = calls.filter(call => call.args.includes(OCTET));
    expect(downloads.at(-1)?.args).toContain(ESCAPE_FLAG);
  });

  it("falls back to a flagless download on gh 2.88, which rejects the flag, and remembers it", () => {
    const calls: Call[] = [];
    const transport = githubProofTransport(ghStub("2.88", calls), REPOSITORY);
    expect(transport.asset(7).bytes.equals(ANSI_LOG)).toBe(true);
    expect(transport.asset(8).bytes.equals(ANSI_LOG)).toBe(true);
    const downloads = calls.filter(call => call.args.includes(OCTET));
    // One rejected probe, then flagless reads only.
    expect(
      downloads.filter(call => call.args.includes(ESCAPE_FLAG))
    ).toHaveLength(1);
    expect(downloads.at(-1)?.args).not.toContain(ESCAPE_FLAG);
    expect(downloads).toHaveLength(3);
  });

  it("never adds the flag to JSON reads", () => {
    const calls: Call[] = [];
    githubProofTransport(ghStub("2.103", calls), REPOSITORY).asset(7);
    const reads = calls.filter(call => !call.args.includes(OCTET));
    expect(reads.length).toBeGreaterThan(0);
    for (const call of reads) expect(call.args).not.toContain(ESCAPE_FLAG);
  });
});

describe("a failed read names itself", () => {
  it("names kind, repository path, exit status and HTTP status, and redacts tokens", () => {
    const run = () => ({
      status: 1,
      stdout: "",
      stderr: `gh: Resource not accessible by integration (HTTP 403) token=${FAKE_TOKEN}\nsecond line\n`,
    });
    const error = refusal(() =>
      githubProofTransport(run, REPOSITORY, {}, NO_WAIT).json(
        `${ROOT}/branches/main`
      )
    );
    expect(error.category).toBe(READ_ERROR);
    expect(error.message).toContain(
      "A required GitHub completion-proof read did not complete"
    );
    expect(error.message).toContain("branch");
    expect(error.message).toContain("branches/main");
    expect(error.message).toContain("exit 1");
    expect(error.message).toContain("HTTP 403");
    expect(error.message).toContain("Resource not accessible by integration");
    expect(error.message).not.toContain(FAKE_TOKEN);
    expect(error.message).not.toContain("second line");
  });

  it("redacts a colour-wrapped token and strips the colour parameters", () => {
    const esc = String.fromCodePoint(0x1b);
    const run = () => ({
      status: 1,
      stdout: "",
      stderr: `gh: ${esc}[31m${FAKE_TOKEN}${esc}[0m denied (HTTP 401)\n`,
    });
    const error = refusal(() =>
      githubProofTransport(run, REPOSITORY, {}, NO_WAIT).json(
        `${ROOT}/branches/main`
      )
    );
    expect(error.message).not.toContain(FAKE_TOKEN);
    expect(error.message).not.toContain("ghs_");
    expect(error.message).not.toContain("31m");
    expect(error.message).not.toContain("0m denied");
    expect(error.message).toContain(
      "gh said: gh: [redacted] denied (HTTP 401)"
    );
  });

  it("names a failed asset download by kind and asset id", () => {
    const run = (_command: string, args: string[]) =>
      args.includes(OCTET)
        ? {
            status: 1,
            stdout: Buffer.alloc(0),
            stderr: "gh: Not Found (HTTP 404)\n",
          }
        : {
            status: 0,
            stdout: JSON.stringify(metadata(739021859, 10)),
            stderr: "",
          };
    const error = refusal(() =>
      githubProofTransport(run, REPOSITORY, {}, NO_WAIT).asset(739021859)
    );
    expect(error.category).toBe(READ_ERROR);
    expect(error.message).toContain("asset-download");
    expect(error.message).toContain("releases/assets/739021859");
    expect(error.message).toContain("HTTP 404");
  });

  it.each([
    [
      "a timeout",
      {
        status: null,
        stdout: "",
        stderr: "",
        error: Object.assign(new Error("spawnSync gh ETIMEDOUT"), {
          code: "ETIMEDOUT",
        }),
      },
      "timed out",
    ],
    [
      "an output overflow",
      {
        status: null,
        stdout: "",
        stderr: "",
        error: Object.assign(new Error("spawnSync gh ENOBUFS"), {
          code: "ENOBUFS",
        }),
      },
      "ENOBUFS",
    ],
  ])("names %s", (_label, result, expected) => {
    const error = refusal(() =>
      githubProofTransport(() => result, REPOSITORY, {}, NO_WAIT).json(
        `${ROOT}/pulls/7`
      )
    );
    expect(error.category).toBe(READ_ERROR);
    expect(error.message).toContain("pull");
    expect(error.message).toContain("pulls/7");
    expect(error.message).toContain(expected);
  });

  it("strips terminal control characters from the quoted stderr", () => {
    const run = () => ({
      status: 1,
      stdout: "",
      stderr: "\u001b[31mgh: boom (HTTP 502)\u001b[0m\n",
    });
    const error = refusal(() =>
      githubProofTransport(run, REPOSITORY, {}, NO_WAIT).json(
        `${ROOT}/commits/abc`
      )
    );
    expect(error.message).not.toContain("\u001b");
    expect(error.message).toContain("commit");
    expect(error.message).toContain("HTTP 502");
  });

  it("names the read whose response is not JSON", () => {
    const run = () => ({ status: 0, stdout: "{", stderr: "" });
    const error = refusal(() =>
      githubProofTransport(run, REPOSITORY, {}, NO_WAIT).json(
        `${ROOT}/actions/runs/31`
      )
    );
    expect(error.category).toBe(READ_ERROR);
    expect(error.message).toContain("actions-run");
    expect(error.message).toContain("actions/runs/31");
  });
});
