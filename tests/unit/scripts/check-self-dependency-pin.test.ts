/**
 * Lisa's own self-dependency pin must be reported when it stops tracking.
 *
 * `lisa apply` rewrites a stale `@codyswann/lisa` pin in every host repository
 * and deliberately does not do so here, so the one repository whose pin no
 * automation corrects is the one that ships the automation. It rotted two
 * majors twice — #2279 (2026-08-04) and #3662 (2026-09-03) — and both times the
 * only thing that noticed was a human reading a version string
 * (CodySwannGT/lisa#3768).
 *
 * Every case drives the real module with an injected `fetch`, so what is
 * asserted is the decision the script makes rather than a paraphrase of it.
 * Three properties matter and none is visible from a happy-path test:
 *
 * 1. **It goes red on the shape that actually happened.** `^2.328.0` against a
 *    published `4.34.14` is the exact state #3662 found, and the first case
 *    here is that state, asserted as a failing exit code — not as a warning.
 * 2. **A tagged-but-unpublished version is not a yardstick.** `v4.33.7` was
 *    tagged, released and attested and never reached npm (#3684). Measuring
 *    against it would report a pin stale against something no consumer can
 *    install, and failing on the gap would train everyone to ignore the check.
 * 3. **"Could not ask" is not "current".** A registry that cannot answer has
 *    proved nothing, and a check that returns success for an input it never
 *    examined is the recurring defect in this repository.
 * @module tests/unit/scripts/check-self-dependency-pin
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  checkSelfPin,
  compareSpec,
  locateSelfPin,
  main,
  publishedVersionsDescending,
  SELF_PACKAGE,
} from "../../../scripts/check-self-dependency-pin.mjs";

const REGISTRY = "https://registry.example.test";

/** The floor #2279 set and #3662 found two majors stale. */
const ROTTED_FLOOR = "^2.328.0";

/** The version published while that floor was still declared. */
const PUBLISHED_NOW = "4.34.14";

/** Tagged, GitHub-released, provenance-attested — and never on npm (#3684). */
const NEVER_PUBLISHED = "4.33.7";

/**
 * A version the packument lists and the registry will not serve.
 *
 * Deliberately the NEWEST entry: the drop-and-continue path only exists for a
 * candidate that would otherwise BE the yardstick, so a fixture where the
 * unservable version sorts below a good one never reaches the code it claims to
 * cover — which is exactly how this test read before a mutant survived it.
 */
const LISTED_BUT_UNSERVABLE = "4.35.0";

/** What one canned HTTP answer looks like. */
interface Answer {
  /** HTTP status code. */
  readonly status: number;
  /** Body the caller parses. */
  readonly body?: unknown;
}

/** Versions the fake registry serves, unless a case says otherwise. */
const CATALOGUE = ["2.328.0", "4.33.6", "4.33.8", PUBLISHED_NOW];

/**
 * Build a packument body carrying exactly these published versions.
 * @param versions - Versions the registry lists.
 * @returns A packument-shaped document.
 */
function packument(versions: readonly string[]): unknown {
  return {
    name: SELF_PACKAGE,
    versions: Object.fromEntries(versions.map(v => [v, { version: v }])),
  };
}

/**
 * A fetch standing in for the registry, recording every URL it is asked for.
 * @param options - The catalogue, per-version overrides and packument override.
 * @returns A stand-in for global fetch plus the URLs it saw.
 */
function fakeRegistry({
  versions = CATALOGUE,
  exact = {},
  packumentAnswer,
}: {
  readonly versions?: readonly string[];
  readonly exact?: Readonly<Record<string, Answer | Error>>;
  readonly packumentAnswer?: Answer | Error;
} = {}): { fetchImpl: typeof fetch; seen: string[] } {
  const seen: string[] = [];
  const base = `${REGISTRY}/${SELF_PACKAGE}`;
  const respond = (answer: Answer | Error): unknown => {
    if (answer instanceof Error) throw answer;
    return {
      status: answer.status,
      ok: answer.status >= 200 && answer.status < 300,
      json: async (): Promise<unknown> => answer.body,
    };
  };
  const impl = async (url: string): Promise<unknown> => {
    seen.push(url);
    if (url === base) {
      return respond(
        packumentAnswer ?? { status: 200, body: packument(versions) }
      );
    }
    const version = url.slice(base.length + 1);
    const override = exact[version];
    if (override !== undefined) return respond(override);
    return respond(
      versions.includes(version)
        ? { status: 200, body: { version } }
        : { status: 404 }
    );
  };
  return { fetchImpl: impl as unknown as typeof fetch, seen };
}

/**
 * Run the decision against a manifest declaring one spec.
 * @param spec - The spec to declare, or undefined to declare none.
 * @param registry - Injected registry seams.
 * @returns The outcome the script decided.
 */
async function decide(
  spec: string | undefined,
  registry = fakeRegistry()
): Promise<{ verdict: string; detail: string; newest: string | null }> {
  return checkSelfPin({
    manifest:
      spec === undefined
        ? { devDependencies: {} }
        : { devDependencies: { [SELF_PACKAGE]: spec } },
    registry: REGISTRY,
    fetchImpl: registry.fetchImpl,
    attempts: 2,
    sleep: async (): Promise<void> => undefined,
  });
}

/**
 * Drive the CLI end to end against a manifest written to disk.
 *
 * The exit code is the half that matters here: a verdict word nothing acts on
 * is a report, and this check is supposed to block.
 * @param spec - The spec the manifest declares.
 * @param registry - Injected registry seams.
 * @returns The exit code and what the run printed.
 */
async function runCli(
  spec: string,
  registry = fakeRegistry()
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  const stderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  const manifestPath = path.join(
    mkdtempSync(path.join(tmpdir(), "lisa-self-pin-")),
    "package.json"
  );
  writeFileSync(
    manifestPath,
    JSON.stringify({
      name: SELF_PACKAGE,
      devDependencies: { [SELF_PACKAGE]: spec },
    })
  );

  const code = await main(
    ["--registry", REGISTRY, "--manifest", manifestPath],
    {
      fetchImpl: registry.fetchImpl,
      attempts: 1,
      sleep: async (): Promise<void> => undefined,
    }
  );

  const printed = {
    code,
    stdout: stdout.mock.calls.map(call => String(call[0])).join(""),
    stderr: stderr.mock.calls.map(call => String(call[0])).join(""),
  };
  stdout.mockRestore();
  stderr.mockRestore();
  return printed;
}

describe("the self-dependency pin cannot rot unobserved (#3768)", () => {
  describe("the drift that actually happened is reported", () => {
    it("calls the two-majors-stale floor stale, against the published newest", async () => {
      const outcome = await decide(ROTTED_FLOOR);

      expect(outcome.verdict).toBe("stale");
      expect(outcome.newest).toBe(PUBLISHED_NOW);
      expect(outcome.detail).toContain("2 major(s) behind");
    });

    it("exits non-zero and names the surface it compared against", async () => {
      const run = await runCli(ROTTED_FLOOR);

      expect(run.code).toBe(1);
      expect(run.stdout).toContain("self-dependency-pin: stale");
      expect(run.stdout).toContain(`surface=npm-registry:${REGISTRY}`);
      expect(run.stderr).toContain("NOT the session plugin cache");
    });

    it("passes once the floor admits the newest published release", async () => {
      const outcome = await decide("^4.33.1");

      expect(outcome.verdict).toBe("current");
      expect(outcome.newest).toBe(PUBLISHED_NOW);
    });
  });

  describe("a tagged-but-unpublished version is not available (#3684)", () => {
    it("never measures against a version missing from the packument", async () => {
      const registry = fakeRegistry({
        versions: ["4.33.6", "4.33.8"],
        exact: { [NEVER_PUBLISHED]: { status: 404 } },
      });

      const outcome = await decide("^4.33.1", registry);

      expect(outcome.verdict).toBe("current");
      expect(outcome.newest).toBe("4.33.8");
      expect(registry.seen).not.toContain(
        `${REGISTRY}/${SELF_PACKAGE}/${NEVER_PUBLISHED}`
      );
    });

    it("drops the newest listed version the registry 404s and uses the next", async () => {
      const registry = fakeRegistry({
        versions: [...CATALOGUE, LISTED_BUT_UNSERVABLE],
        exact: { [LISTED_BUT_UNSERVABLE]: { status: 404 } },
      });

      const outcome = await decide(ROTTED_FLOOR, registry);

      // It asked about the newest, was told 404, and moved on rather than
      // stopping — the walk continuing is the whole behaviour under test.
      expect(registry.seen).toContain(
        `${REGISTRY}/${SELF_PACKAGE}/${LISTED_BUT_UNSERVABLE}`
      );
      expect(outcome.verdict).toBe("stale");
      expect(outcome.newest).toBe(PUBLISHED_NOW);
      expect(outcome.detail).not.toContain(LISTED_BUT_UNSERVABLE);
    });

    it("does not fail on the registry gap itself", async () => {
      const registry = fakeRegistry({
        versions: [...CATALOGUE, LISTED_BUT_UNSERVABLE],
        exact: { [LISTED_BUT_UNSERVABLE]: { status: 404 } },
      });

      const outcome = await decide("^4.33.1", registry);

      expect(outcome.verdict).toBe("current");
      expect(outcome.newest).toBe(PUBLISHED_NOW);
    });
  });

  describe("an unanswerable registry blocks rather than passing", () => {
    it("reports unprovable when the packument cannot be read", async () => {
      const registry = fakeRegistry({
        packumentAnswer: new Error("ECONNRESET"),
      });

      const outcome = await decide(ROTTED_FLOOR, registry);

      expect(outcome.verdict).toBe("unprovable");
      expect(outcome.detail).toContain("ECONNRESET");
    });

    it("retries a transport failure before settling", async () => {
      const registry = fakeRegistry({ packumentAnswer: { status: 503 } });

      await decide(ROTTED_FLOOR, registry);

      expect(registry.seen).toHaveLength(2);
    });

    it("reports unprovable when the newest candidate cannot be confirmed", async () => {
      const registry = fakeRegistry({
        exact: { [PUBLISHED_NOW]: { status: 500 } },
      });

      const outcome = await decide("^4.33.1", registry);

      expect(outcome.verdict).toBe("unprovable");
      expect(outcome.newest).toBeNull();
    });

    it("reports unprovable when the packument lists nothing published", async () => {
      const registry = fakeRegistry({ versions: [] });

      const outcome = await decide(ROTTED_FLOOR, registry);

      expect(outcome.verdict).toBe("unprovable");
    });

    // The verdict word and the exit code are two different claims, and only
    // the second one stops a merge. Asserting the word alone leaves the check
    // free to print "unprovable" and exit 0 — a control reporting success
    // while permitting exactly what it forbids.
    it("exits non-zero on unprovable, not merely says so", async () => {
      const run = await runCli(
        ROTTED_FLOOR,
        fakeRegistry({ packumentAnswer: { status: 503 } })
      );

      expect(run.code).toBe(1);
      expect(run.stdout).toContain("self-dependency-pin: unprovable");
      expect(run.stderr).toContain("nothing was measured");
    });

    it("exits zero when the floor still admits the newest release", async () => {
      const run = await runCli("^4.33.1");

      expect(run.code).toBe(0);
      expect(run.stdout).toContain("self-dependency-pin: current");
    });
  });

  describe("specs that are not a registry range", () => {
    it("leaves a local checkout alone", async () => {
      const outcome = await decide("file:../lisa");

      expect(outcome.verdict).toBe("local-checkout");
    });

    it("passes a manifest that declares no self-dependency", async () => {
      const outcome = await decide(undefined);

      expect(outcome.verdict).toBe("no-pin");
    });

    it("refuses to guess at an unparseable range", () => {
      expect(compareSpec("not-a-range", PUBLISHED_NOW).verdict).toBe(
        "unprovable"
      );
    });
  });

  describe("the pieces the decision is built from", () => {
    it("prefers a runtime dependency over a devDependency", () => {
      expect(
        locateSelfPin({
          dependencies: { [SELF_PACKAGE]: "^1.0.0" },
          devDependencies: { [SELF_PACKAGE]: "^2.0.0" },
        })
      ).toEqual({ section: "dependencies", spec: "^1.0.0" });
    });

    it("orders published versions newest first and drops prereleases", () => {
      expect(
        publishedVersionsDescending(
          packument(["4.9.0", "4.10.0-rc.1", "4.10.0"]) as never
        )
      ).toEqual(["4.10.0", "4.9.0"]);
    });
  });
});
