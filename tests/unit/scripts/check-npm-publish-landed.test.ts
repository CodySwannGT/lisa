/**
 * A publish that reported success must be proved against the registry.
 *
 * Measured incident (CodySwannGT/lisa#3684): `v4.33.7` was tagged, a GitHub
 * Release was cut, a provenance statement reached the sigstore transparency
 * log — and `registry.npmjs.org/@codyswann/lisa/4.33.7` returned 404, and still
 * did a day later. The publish had failed with `E401` from npm's OIDC exchange;
 * the next release published fine 17 minutes later through the same code path.
 * Nothing retried and nothing flagged it, so the version counter moved on and
 * the hole became invisible in every downstream view.
 *
 * Every case here drives the real module with an injected `fetch`, so what is
 * asserted is the decision the script makes rather than a paraphrase of it. Two
 * properties matter most and neither is visible from a happy-path test:
 *
 * 1. **It never consults `dist-tags.latest`.** That endpoint lags a successful
 *    publish by several minutes (CodySwannGT/lisa#3685), so a check built on it
 *    reports a false miss for a publish that landed — and a check that cries
 *    wolf is a check somebody deletes. The requested URLs are captured and
 *    asserted, not the intent.
 * 2. **"Could not ask" is not "nothing found".** A transport error or a 5xx has
 *    proved nothing, and returning success for an input never examined is the
 *    exact defect this script exists to catch one layer up. It blocks — and it
 *    blocks under a DIFFERENT word from a proven 404, because the caller
 *    retracts a GitHub Release on one and merely reports the other.
 *
 * Imported from `all/copy-overwrite/` rather than `scripts/`: that is the file
 * `lisa apply` writes into a host project, and Lisa's own `scripts/` entry is a
 * re-export that runs the CLI on import.
 * @module tests/unit/scripts/check-npm-publish-landed
 */
import { describe, expect, it, vi } from "vitest";

import {
  exactVersionUrl,
  main,
  verifyPublish,
} from "../../../all/copy-overwrite/scripts/check-npm-publish-landed.mjs";

const PACKAGE = "@scope/package";
const VERSION = "1.2.3";
const REGISTRY = "https://registry.example.test";

/** A response the injected fetch should return, or an error it should throw. */
interface StubResponse {
  /** HTTP status code. */
  readonly status: number;
  /** Body the caller will parse; omitted means the parse throws. */
  readonly body?: unknown;
}

/** Everything one run of the check reveals about itself. */
interface Run {
  /** The verdict word. */
  readonly verdict: string;
  /** Human-readable cause. */
  readonly detail: string;
  /** Every URL the check requested, in order. */
  readonly urls: readonly string[];
}

/**
 * A fetch that replays canned answers and records what was asked.
 * @param answers - One entry per attempt; the last repeats.
 * @param seen - Collects every requested URL.
 * @returns A stand-in for global fetch.
 */
function stubFetch(
  answers: readonly (StubResponse | Error)[],
  seen: string[]
): typeof fetch {
  let index = 0;
  const impl = async (url: string): Promise<unknown> => {
    seen.push(url);
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    if (answer instanceof Error) throw answer;
    return {
      status: answer?.status,
      ok: (answer?.status ?? 0) >= 200 && (answer?.status ?? 0) < 300,
      json: async (): Promise<unknown> => {
        if (answer === undefined || !("body" in answer)) {
          throw new Error("Unexpected end of JSON input");
        }
        return answer.body;
      },
    };
  };
  return impl as unknown as typeof fetch;
}

/**
 * Run the check against canned registry answers.
 * @param answers - What the registry returns, per attempt.
 * @param attempts - How many times to ask.
 * @returns The verdict and the URLs it asked for.
 */
async function run(
  answers: readonly (StubResponse | Error)[],
  attempts = 3
): Promise<Run> {
  const seen: string[] = [];
  const outcome = await verifyPublish({
    packageName: PACKAGE,
    version: VERSION,
    registry: REGISTRY,
    attempts,
    delayMs: 0,
    fetchImpl: stubFetch(answers, seen),
    sleep: async (): Promise<void> => undefined,
  });
  return { ...outcome, urls: seen };
}

describe("check-npm-publish-landed asks only about the exact version", () => {
  it("requests the exact-version manifest URL", async () => {
    const { urls } = await run([{ status: 200, body: { version: VERSION } }]);

    expect(urls).toEqual([`${REGISTRY}/${PACKAGE}/${VERSION}`]);
  });

  it("never requests dist-tags or the packument, on any path", async () => {
    // Asserted across every outcome, not just the happy one: a fallback that
    // consulted `latest` only when the exact endpoint 404s would pass a
    // success-only version of this case and reintroduce the whole defect.
    const paths = [
      await run([{ status: 200, body: { version: VERSION } }]),
      await run([{ status: 404 }]),
      await run([{ status: 503 }]),
      await run([new Error("ECONNRESET")]),
    ];

    for (const { urls } of paths) {
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url).toBe(`${REGISTRY}/${PACKAGE}/${VERSION}`);
        expect(url).not.toContain("dist-tags");
        expect(url).not.toContain("latest");
      }
    }
  });

  it("builds the URL without a doubled slash after the registry origin", () => {
    expect(exactVersionUrl(`${REGISTRY}/`, PACKAGE, VERSION)).toBe(
      `${REGISTRY}/${PACKAGE}/${VERSION}`
    );
  });
});

describe("check-npm-publish-landed verdicts", () => {
  it("reports published when the registry serves this exact version", async () => {
    const { verdict } = await run([
      { status: 200, body: { version: VERSION } },
    ]);

    expect(verdict).toBe("published");
  });

  it("stops asking once the version is proved present", async () => {
    const { urls } = await run(
      [{ status: 200, body: { version: VERSION } }],
      5
    );

    expect(urls).toHaveLength(1);
  });

  it("reports missing on a settled 404 — the shape of the incident", async () => {
    const { verdict, detail } = await run([{ status: 404 }]);

    expect(verdict).toBe("missing");
    expect(detail).toContain("404");
  });

  it("retries a 404 before settling, so propagation is not read as absence", async () => {
    const { verdict, urls } = await run(
      [
        { status: 404 },
        { status: 404 },
        { status: 200, body: { version: VERSION } },
      ],
      3
    );

    expect(verdict).toBe("published");
    expect(urls).toHaveLength(3);
  });

  it("reports unprovable, NOT published, when the registry cannot be reached", async () => {
    // The whole point. A transport failure has proved nothing about the
    // package, and calling it success is the defect this script exists to stop.
    const { verdict, detail } = await run([new Error("ECONNRESET")]);

    expect(verdict).toBe("unprovable");
    expect(detail).toContain("ECONNRESET");
  });

  it("reports unprovable, NOT missing, on a 5xx", async () => {
    // Distinct from `missing` on purpose: the caller retracts a GitHub Release
    // on a proven miss, and doing that on a registry blip would be a false
    // accusation against a version that may well be installable.
    const { verdict, detail } = await run([{ status: 503 }]);

    expect(verdict).toBe("unprovable");
    expect(detail).toContain("503");
  });

  it("reports unprovable when a 200 names a different version", async () => {
    const { verdict, detail } = await run([
      { status: 200, body: { version: "9.9.9" } },
    ]);

    expect(verdict).toBe("unprovable");
    expect(detail).toContain("9.9.9");
  });

  it("reports unprovable when a 200 carries an unparseable body", async () => {
    const { verdict } = await run([{ status: 200 }]);

    expect(verdict).toBe("unprovable");
  });

  it("never upgrades a non-answer to published across retries", async () => {
    const { verdict, urls } = await run(
      [{ status: 503 }, new Error("ECONNRESET"), { status: 404 }],
      3
    );

    expect(urls).toHaveLength(3);
    expect(verdict).toBe("missing");
  });
});

describe("each registry attempt has its own complete deadline", () => {
  it("uses a fresh abort signal for every retry", async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      return { status: 404, ok: false };
    }) as unknown as typeof fetch;

    await verifyPublish({
      packageName: PACKAGE,
      version: VERSION,
      registry: REGISTRY,
      attempts: 3,
      delayMs: 0,
      fetchImpl,
      sleep: async (): Promise<void> => undefined,
    });

    expect(signals).toHaveLength(3);
    expect(new Set(signals).size).toBe(3);
  });

  it("keeps the deadline armed until response.json settles", async () => {
    let finishBody: ((value: unknown) => void) | undefined;
    const body = new Promise(resolve => {
      finishBody = resolve;
    });
    const cleared: unknown[] = [];
    const token = { timer: true };
    const pending = verifyPublish({
      packageName: PACKAGE,
      version: VERSION,
      registry: REGISTRY,
      attempts: 1,
      fetchImpl: (async () => ({
        status: 200,
        ok: true,
        json: async () => body,
      })) as unknown as typeof fetch,
      setAttemptTimer: (() => token) as unknown as typeof setTimeout,
      clearAttemptTimer: (value: unknown) => cleared.push(value),
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(cleared).toEqual([]);

    finishBody?.({ version: VERSION });
    await expect(pending).resolves.toMatchObject({ verdict: "published" });
    expect(cleared).toEqual([token]);
  });

  it("aborts and reports an unprovable stalled response body", async () => {
    let expire: (() => void) | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => ({
      status: 200,
      ok: true,
      json: () =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted"))
          );
        }),
    })) as unknown as typeof fetch;
    const pending = verifyPublish({
      packageName: PACKAGE,
      version: VERSION,
      registry: REGISTRY,
      attempts: 1,
      attemptTimeoutMs: 25,
      fetchImpl,
      setAttemptTimer: (callback: () => void) => {
        expire = callback;
        return { timer: true };
      },
      clearAttemptTimer: () => undefined,
    });

    await Promise.resolve();
    expire?.();

    await expect(pending).resolves.toMatchObject({
      verdict: "unprovable",
      detail: "attempt exceeded 25ms deadline",
    });
  });
});

describe("check-npm-publish-landed exit codes and report", () => {
  /**
   * Drive the CLI body and capture both streams.
   * @param answers - What the registry returns.
   * @returns Exit code and captured output.
   */
  async function cli(
    answers: readonly (StubResponse | Error)[]
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const outSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(chunk => {
        stdout.push(String(chunk));
        return true;
      });
    const errSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(chunk => {
        stderr.push(String(chunk));
        return true;
      });
    try {
      const code = await main(
        [
          "--package",
          PACKAGE,
          "--version",
          VERSION,
          "--registry",
          REGISTRY,
          "--attempts",
          "1",
        ],
        {
          fetchImpl: stubFetch(answers, []),
          sleep: async (): Promise<void> => undefined,
        }
      );
      return { code, stdout: stdout.join(""), stderr: stderr.join("") };
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }
  }

  it("exits 0 and names the verdict when the version is on the registry", async () => {
    const { code, stdout } = await cli([
      { status: 200, body: { version: VERSION } },
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain(
      `npm-publish-landed: published package=${PACKAGE} version=${VERSION}`
    );
  });

  it("exits non-zero on a proven miss", async () => {
    const { code, stdout, stderr } = await cli([{ status: 404 }]);

    expect(code).not.toBe(0);
    expect(stdout).toContain("npm-publish-landed: missing");
    expect(stderr).toContain("is NOT on the registry");
  });

  it("exits non-zero when it could not ask, and says that is not a clean result", async () => {
    const { code, stdout, stderr } = await cli([{ status: 503 }]);

    expect(code).not.toBe(0);
    expect(stdout).toContain("npm-publish-landed: unprovable");
    expect(stderr).toContain("NOT a clean result");
  });

  it("prints exactly one verdict line, so a caller can grep for it", async () => {
    const { stdout } = await cli([{ status: 404 }]);

    const verdictLines = stdout
      .split("\n")
      .filter(line => line.startsWith("npm-publish-landed:"));
    expect(verdictLines).toHaveLength(1);
  });

  it("refuses a call with no version rather than checking something else", async () => {
    await expect(main(["--package", PACKAGE])).rejects.toThrow("--version");
  });

  it("refuses a call with no package", async () => {
    await expect(main(["--version", VERSION])).rejects.toThrow("--package");
  });

  it("treats a flag-shaped value as a missing option", async () => {
    await expect(main(["--package", "--version", VERSION])).rejects.toThrow(
      "--package"
    );
  });

  it.each(["0", "-1", "Infinity", "NaN", "9007199254740992"])(
    "refuses an invalid attempt count (%s) before asking the registry",
    async attempts => {
      await expect(
        main([
          "--package",
          PACKAGE,
          "--version",
          VERSION,
          "--attempts",
          attempts,
        ])
      ).rejects.toThrow("--attempts must be a positive safe integer");
    }
  );
});
