/**
 * Fake CLI fixture coverage for the Lisa-only harness parity council helpers.
 *
 * Issue #775 extends the council scaffolding with deterministic probe and
 * first-round capture fixtures so maintainers can validate success, missing,
 * failing, and hanging runtime behaviors without depending on real external
 * CLIs being installed or authenticated.
 * @module tests/unit/strategies/harness-parity-council-fixture-smoke
 */
/* eslint-disable jsdoc/require-jsdoc, @eslint-community/eslint-comments/disable-enable-pair -- Fixture-only local types/helpers are covered by the module-level contract. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const runtimeModuleUrl = pathToFileURL(
  path.resolve(".agents/skills/harness-parity-council/runtime-adapters.mjs")
).href;
const firstRoundModuleUrl = pathToFileURL(
  path.resolve(".agents/skills/harness-parity-council/first-round.mjs")
).href;

const adapters = await import(runtimeModuleUrl);
const council = await import(firstRoundModuleUrl);

const FIXTURE_ROOT = path.resolve("tests/fixtures/harness-parity-council");

type ProbeFixture = {
  readonly runtime: "cursor" | "codex" | "copilot" | "antigravity";
  readonly env: Record<string, string>;
  readonly helpResult: SpawnResultFixture;
  readonly versionResult: SpawnResultFixture;
  readonly expected: {
    readonly available: boolean;
    readonly authMissing: boolean | null;
    readonly command: string;
  };
};

type SpawnResultFixture = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: {
    readonly code: string | null;
    readonly message: string;
  };
};

type FirstRoundFixture = {
  readonly runtime: "cursor" | "codex" | "copilot" | "antigravity";
  readonly probe: {
    readonly available: boolean;
    readonly authMissing: boolean | null;
    readonly helpProbe: {
      readonly commandMissing: boolean;
      readonly error: {
        readonly code: string | null;
        readonly message: string;
      } | null;
    };
    readonly versionProbe: {
      readonly commandMissing: boolean;
      readonly error: {
        readonly code: string | null;
        readonly message: string;
      } | null;
    };
  };
  readonly result: {
    readonly exitStatus: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly timedOut: boolean;
    readonly authMissing: boolean | null;
    readonly error: {
      readonly code: string | null;
      readonly message: string;
    } | null;
  } | null;
  readonly expected: {
    readonly status: string;
    readonly unavailableReason?: string;
    readonly parsedOutput?: unknown;
  };
};

const readJsonFixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(path.join(FIXTURE_ROOT, `${name}.json`), "utf8")
  ) as T;

function buildFixtureRunner(fixture: ProbeFixture) {
  const queue = [fixture.helpResult, fixture.versionResult];

  return (
    _command: string,
    _args: string[],
    _options: { encoding: string; timeout: number }
  ) => {
    const next = queue.shift();
    if (!next) {
      throw new Error("Unexpected extra runtime probe call.");
    }

    return {
      status: next.status,
      stdout: next.stdout,
      stderr: next.stderr,
      signal: null,
      error: next.error
        ? Object.assign(new Error(next.error.message), {
            code: next.error.code,
          })
        : undefined,
    };
  };
}

describe("harness parity council probe fixtures (#775)", () => {
  for (const fixtureName of [
    "probe-success",
    "probe-command-missing",
    "probe-auth-missing",
  ] as const) {
    it(`normalizes ${fixtureName} deterministically`, () => {
      const fixture = readJsonFixture<ProbeFixture>(fixtureName);
      const result = adapters.probeRuntimeAdapter(
        fixture.runtime,
        fixture.env,
        buildFixtureRunner(fixture)
      );

      expect(result.command).toBe(fixture.expected.command);
      expect(result.available).toBe(fixture.expected.available);
      expect(result.authMissing).toBe(fixture.expected.authMissing);
    });
  }
});

describe("harness parity council first-round fixtures (#775)", () => {
  for (const fixtureName of [
    "first-round-responded",
    "first-round-unavailable",
    "first-round-failed",
    "first-round-timed-out",
  ] as const) {
    it(`captures ${fixtureName} without real CLI dependencies`, () => {
      const fixture = readJsonFixture<FirstRoundFixture>(fixtureName);
      const invocation = council.buildFirstRoundInvocation({
        topic: "Review council fixture coverage",
        runtime: fixture.runtime,
        context: {
          repository: "lisa",
          sourceArtifacts: ["Issue #775"],
        },
      });

      const capture = council.normalizeFirstRoundCapture({
        invocation,
        probe: {
          ...invocation,
          ...fixture.probe,
        },
        result: fixture.result ?? undefined,
      });

      expect(capture.status).toBe(fixture.expected.status);
      if (typeof fixture.expected.unavailableReason === "string") {
        expect(capture.unavailableReason).toBe(
          fixture.expected.unavailableReason
        );
      }
      if (fixture.expected.parsedOutput) {
        expect(capture.parsedOutput).toEqual(fixture.expected.parsedOutput);
      }
    });
  }
});
