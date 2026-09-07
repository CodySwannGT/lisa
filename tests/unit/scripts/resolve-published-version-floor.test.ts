/**
 * The version a release cuts must be chosen from evidence that is current.
 *
 * Measured (CodySwannGT/lisa#3685) immediately after `4.33.8` published: three
 * cached registry views still named `4.33.6` while two uncached ones already
 * named `4.33.8`, and they stayed disagreed for roughly thirteen minutes. The
 * release workflow's "keep the next version above the published one" guard was
 * fed the most-cached of them, so a release cut inside that window compared
 * against a version that was no longer the newest and under-corrected — while
 * still reporting that it had checked.
 *
 * Every case drives the real module with an injected `fetch`, so what is
 * asserted is the decision the resolver makes rather than a paraphrase of it.
 * Three properties matter and none is visible from a happy-path test:
 *
 * 1. **The URL carries `write=true`, always.** Dropping it still returns a
 *    packument and still parses — it just returns the stale one, which is the
 *    entire defect. The requested URLs are captured and asserted.
 * 2. **The floor comes from the `versions` map, never a mutable pointer.** A
 *    packument carries both; a body whose pointer disagrees with its map proves
 *    which one was read.
 * 3. **"Could not ask" is not "nothing published".** An unreadable registry
 *    yields `unprovable` and a non-zero exit, so the caller refuses rather than
 *    choosing a version from evidence it never obtained.
 *
 * Imported from `all/copy-overwrite/` rather than `scripts/`: that is the file
 * `lisa apply` writes into a host project, and Lisa's own `scripts/` entry is a
 * re-export that runs the CLI on import.
 * @module tests/unit/scripts/resolve-published-version-floor
 */
import { describe, expect, it, vi } from "vitest";

import {
  highestStableVersion,
  isStableRelease,
  main,
  packumentUrl,
  resolvePublishedFloor,
} from "../../../all/copy-overwrite/scripts/resolve-published-version-floor.mjs";

const PACKAGE = "@scope/package";
const REGISTRY = "https://registry.example.test";
const EXPECTED_URL = `${REGISTRY}/@scope%2fpackage?write=true`;
const PACKAGE_FLAG = "--package";
const REGISTRY_FLAG = "--registry";
const ATTEMPTS_FLAG = "--attempts";

/** A response the injected fetch should return, or an error it should throw. */
interface StubResponse {
  /** HTTP status code. */
  readonly status: number;
  /** Body the caller will parse; omitted means the parse throws. */
  readonly body?: unknown;
}

/** Everything one resolution reveals about itself. */
interface Run {
  /** The verdict word. */
  readonly verdict: string;
  /** The floor, or null when there is none. */
  readonly version: string | null;
  /** Human-readable cause. */
  readonly detail: string;
  /** Every URL the resolution requested, in order. */
  readonly urls: readonly string[];
}

/**
 * Build a packument body from a list of version strings.
 * @param versions - Versions the registry should claim exist.
 * @param latest - What the packument's mutable pointer claims, if anything.
 * @returns A packument-shaped body.
 */
function packument(
  versions: readonly string[],
  latest?: string
): Record<string, unknown> {
  return {
    name: PACKAGE,
    ...(latest === undefined ? {} : { "dist-tags": { latest } }),
    versions: Object.fromEntries(versions.map(v => [v, { version: v }])),
  };
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
 * Resolve the floor against canned registry answers.
 * @param answers - What the registry returns, per attempt.
 * @param attempts - How many times to ask.
 * @returns The verdict and the URLs it asked for.
 */
async function run(
  answers: readonly (StubResponse | Error)[],
  attempts = 3
): Promise<Run> {
  const seen: string[] = [];
  const outcome = await resolvePublishedFloor({
    packageName: PACKAGE,
    registry: REGISTRY,
    attempts,
    delayMs: 0,
    fetchImpl: stubFetch(answers, seen),
    sleep: async (): Promise<void> => undefined,
  });
  return { ...outcome, urls: seen };
}

describe("resolve-published-version-floor asks an uncached endpoint", () => {
  it("requests the packument with write=true", async () => {
    const { urls } = await run([{ status: 200, body: packument(["1.0.0"]) }]);

    expect(urls).toEqual([EXPECTED_URL]);
  });

  it("carries write=true on every path, not just the happy one", async () => {
    // A fallback that dropped the parameter when the first read failed would
    // pass a success-only version of this case and reintroduce the whole
    // defect: the cached answer is a perfectly well-formed wrong answer.
    const paths = [
      await run([{ status: 200, body: packument(["1.0.0"]) }]),
      await run([{ status: 404 }]),
      await run([{ status: 503 }]),
      await run([new Error("ECONNRESET")]),
    ];

    for (const { urls } of paths) {
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url).toBe(EXPECTED_URL);
        expect(url).toContain("write=true");
      }
    }
  });

  it("percent-encodes a scoped name and leaves an unscoped one alone", () => {
    expect(packumentUrl(REGISTRY, "@scope/package")).toBe(EXPECTED_URL);
    expect(packumentUrl(REGISTRY, "package")).toBe(
      `${REGISTRY}/package?write=true`
    );
  });

  it("builds the URL without a doubled slash after the registry origin", () => {
    expect(packumentUrl(`${REGISTRY}//`, "package")).toBe(
      `${REGISTRY}/package?write=true`
    );
  });
});

describe("the floor comes from the versions map, not a mutable pointer", () => {
  it("ignores a dist-tag that disagrees with the versions map", async () => {
    // This body is the measured incident in miniature: the map already knows
    // about the newest release while the pointer still names an older one.
    // Whichever field is read is decided by which number comes back.
    const { verdict, version } = await run([
      { status: 200, body: packument(["4.33.6", "4.33.8"], "4.33.6") },
    ]);

    expect(verdict).toBe("resolved");
    expect(version).toBe("4.33.8");
  });

  it("takes the numerically highest release, not the last one listed", async () => {
    const { version } = await run([
      { status: 200, body: packument(["1.9.0", "1.10.0", "1.2.0"]) },
    ]);

    expect(version).toBe("1.10.0");
  });

  it("excludes prereleases so an environment-scoped tag cannot lift the floor", async () => {
    // Release tags are environment-scoped (CodySwannGT/lisa#3741): every
    // non-production environment cuts `vX.Y.Z-<environment>.<epoch>`. That
    // suffix is supposed to stay in the git tag, but a suffixed version
    // reaching the registry by any route must not push production's next clean
    // release from 4.5.10 to 4.6.0.
    const { version } = await run([
      {
        status: 200,
        body: packument([
          "4.5.9",
          "4.5.10",
          "4.6.0-staging.1757000000",
          "4.7.0-beta.1",
        ]),
      },
    ]);

    expect(version).toBe("4.5.10");
  });

  it("classifies version shapes the floor may and may not be built from", () => {
    expect(isStableRelease("4.5.10")).toBe(true);
    expect(isStableRelease("4.6.0-staging.1757000000")).toBe(false);
    expect(isStableRelease("1.2.3+build.5")).toBe(false);
    expect(isStableRelease("1.2")).toBe(false);
    expect(isStableRelease("1.2.3.4")).toBe(false);
    expect(isStableRelease("1.2.x")).toBe(false);
    expect(isStableRelease("1..3")).toBe(false);
    expect(isStableRelease("")).toBe(false);
    expect(isStableRelease(undefined)).toBe(false);
  });

  it("returns no floor for a map that is not an object", () => {
    expect(highestStableVersion(null)).toBeNull();
    expect(highestStableVersion("4.5.10")).toBeNull();
  });
});

describe("resolve-published-version-floor verdicts", () => {
  it("reports unpublished for a package the registry has never seen", async () => {
    const { verdict, version } = await run([{ status: 404 }]);

    expect(verdict).toBe("unpublished");
    expect(version).toBeNull();
  });

  it("reports unpublished when every release is a prerelease", async () => {
    const { verdict, version } = await run([
      { status: 200, body: packument(["1.0.0-rc.1"]) },
    ]);

    expect(verdict).toBe("unpublished");
    expect(version).toBeNull();
  });

  it("reports unprovable, NOT unpublished, when the registry cannot be reached", async () => {
    // The distinction is the fix. Treating an unreachable registry as "nothing
    // is published" is what let the old guard choose a version from evidence it
    // never obtained.
    const { verdict, version } = await run([new Error("ECONNRESET")]);

    expect(verdict).toBe("unprovable");
    expect(version).toBeNull();
  });

  it("reports unprovable, NOT unpublished, on a 5xx", async () => {
    const { verdict, detail } = await run([{ status: 503 }]);

    expect(verdict).toBe("unprovable");
    expect(detail).toContain("503");
  });

  it("reports unprovable when a 200 carries no versions map", async () => {
    const { verdict } = await run([
      { status: 200, body: { "dist-tags": { latest: "4.33.6" } } },
    ]);

    expect(verdict).toBe("unprovable");
  });

  it("reports unprovable when a 200 carries an unparseable body", async () => {
    const { verdict } = await run([{ status: 200 }]);

    expect(verdict).toBe("unprovable");
  });

  it("retries a non-answer and accepts the answer that follows", async () => {
    const { verdict, version, urls } = await run([
      { status: 503 },
      { status: 200, body: packument(["2.0.0"]) },
    ]);

    expect(urls).toHaveLength(2);
    expect(verdict).toBe("resolved");
    expect(version).toBe("2.0.0");
  });

  it("stops asking once the registry has answered", async () => {
    const { urls } = await run([{ status: 404 }]);

    expect(urls).toHaveLength(1);
  });

  it("never upgrades a non-answer to a floor across retries", async () => {
    const { verdict, version } = await run([{ status: 500 }], 4);

    expect(verdict).toBe("unprovable");
    expect(version).toBeNull();
  });
});

describe("each registry attempt has its own complete deadline", () => {
  it("uses a fresh abort signal for every retry", async () => {
    const controllers: AbortController[] = [];
    const seen: string[] = [];

    await resolvePublishedFloor({
      packageName: PACKAGE,
      registry: REGISTRY,
      attempts: 3,
      delayMs: 0,
      fetchImpl: stubFetch([{ status: 503 }], seen),
      sleep: async (): Promise<void> => undefined,
      createAbortController: (): AbortController => {
        const controller = new AbortController();
        controllers.push(controller);
        return controller;
      },
    });

    expect(controllers).toHaveLength(3);
    expect(new Set(controllers).size).toBe(3);
  });

  it("aborts and reports an unprovable stalled response body", async () => {
    // A body that never settles must not hang the release step forever, and
    // an expired deadline is `unprovable` — the absence of an answer, never a
    // floor of none.
    let expire: (() => void) | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => ({
      status: 200,
      ok: true,
      json: () =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    })) as unknown as typeof fetch;
    const pending = resolvePublishedFloor({
      packageName: PACKAGE,
      registry: REGISTRY,
      attempts: 1,
      attemptTimeoutMs: 25,
      fetchImpl,
      setAttemptTimer: ((callback: () => void) => {
        expire = callback;
        return { timer: true };
      }) as unknown as typeof setTimeout,
      clearAttemptTimer: (() => undefined) as unknown as typeof clearTimeout,
    });

    await Promise.resolve();
    expire?.();

    await expect(pending).resolves.toMatchObject({
      verdict: "unprovable",
      version: null,
      detail: "attempt exceeded 25ms deadline",
    });
  });
});

describe("resolve-published-version-floor exit codes and report", () => {
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
        [PACKAGE_FLAG, PACKAGE, REGISTRY_FLAG, REGISTRY, ATTEMPTS_FLAG, "1"],
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

  it("exits 0 and names the floor on stdout", async () => {
    const { code, stdout } = await cli([
      { status: 200, body: packument(["4.33.6", "4.33.8"], "4.33.6") },
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain(
      `npm-published-floor: resolved package=${PACKAGE} version=4.33.8`
    );
  });

  it("exits 0 and reports no floor for an unpublished package", async () => {
    const { code, stdout } = await cli([{ status: 404 }]);

    expect(code).toBe(0);
    expect(stdout).toContain("version=none");
  });

  it("prints exactly one stdout line, so a shell can parse it without a parser", async () => {
    // The workflow takes the text after the last `version=`. A second stdout
    // line would silently change which value that is.
    const { stdout } = await cli([{ status: 200, body: packument(["1.0.0"]) }]);

    expect(stdout.split("\n").filter(line => line.length > 0)).toHaveLength(1);
  });

  it("exits non-zero and prints NO floor when the registry cannot be read", async () => {
    // Both halves matter. The non-zero exit is what makes the caller refuse;
    // the empty stdout is what stops a caller that ignores exit codes from
    // reading a floor out of a failure.
    const { code, stdout, stderr } = await cli([{ status: 503 }]);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("Could not read the published version floor");
  });

  it("says an unreadable registry is not evidence that nothing is published", async () => {
    const { stderr } = await cli([new Error("ECONNRESET")]);

    expect(stderr).toContain("is NOT");
    expect(stderr).toContain("nothing is published");
  });

  it("refuses a call with no package rather than resolving something else", async () => {
    await expect(main([REGISTRY_FLAG, REGISTRY])).rejects.toThrow(PACKAGE_FLAG);
  });

  it("treats a flag-shaped value as a missing option", async () => {
    await expect(main([PACKAGE_FLAG, REGISTRY_FLAG])).rejects.toThrow(
      PACKAGE_FLAG
    );
  });

  it("refuses a non-positive attempt count", async () => {
    await expect(
      main([PACKAGE_FLAG, PACKAGE, ATTEMPTS_FLAG, "0"])
    ).rejects.toThrow(ATTEMPTS_FLAG);
  });
});
