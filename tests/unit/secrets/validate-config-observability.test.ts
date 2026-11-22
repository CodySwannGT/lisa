/**
 * The `observability` block names a project's error tracker and analytics
 * provider, so stack guidance follows the project instead of assuming Sentry
 * and PostHog (CodySwannGT/lisa#4912).
 *
 * Both keys are optional and default to today's behaviour (`sentry`,
 * `posthog`), so an absent block must validate cleanly. A present value is a
 * closed vocabulary: a typo would otherwise silently fall through to a default
 * and send the agent to a tool the project does not have. A local override is
 * checked too, because the runtime reads local over committed.
 * @module tests/unit/secrets/validate-config-observability
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  readValidationConfig,
  validateConfig,
  validateObservability,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Make a project dir holding the given config files.
 * @param committed - `.lisa.config.json` contents
 * @param local - `.lisa.config.local.json` contents
 * @returns Project root
 */
function project(committed: unknown, local: unknown): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "lisa-vc-obs-"));
  roots.push(root);
  writeFileSync(
    path.join(root, ".lisa.config.json"),
    JSON.stringify(committed)
  );
  writeFileSync(
    path.join(root, ".lisa.config.local.json"),
    JSON.stringify(local)
  );
  return root;
}

describe("observability block", () => {
  it("accepts an absent block, since both providers have defaults", () => {
    expect(validateObservability(undefined)).toEqual([]);
  });

  it("accepts every documented provider value", () => {
    for (const errors of ["sentry", "none", "other"]) {
      for (const analytics of ["posthog", "none", "other"]) {
        expect(
          validateObservability({
            errorTracking: { provider: errors },
            analytics: { provider: analytics },
          })
        ).toEqual([]);
      }
    }
  });

  it("rejects an unknown error-tracking provider and names the allowed values", () => {
    const problems = validateObservability({
      errorTracking: { provider: "bugsnag" },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("observability.errorTracking.provider");
    expect(problems[0]).toContain('"bugsnag"');
    expect(problems[0]).toMatch(/sentry.*none.*other/);
  });

  it("rejects an unknown analytics provider", () => {
    const problems = validateObservability({
      analytics: { provider: "amplitude" },
    });
    expect(problems[0]).toContain("observability.analytics.provider");
    expect(problems[0]).toMatch(/posthog.*none.*other/);
  });

  it("rejects a block or sub-block that is not an object", () => {
    expect(validateObservability("sentry")[0]).toMatch(
      /observability must be an object/
    );
    expect(validateObservability({ errorTracking: "sentry" })[0]).toMatch(
      /observability.errorTracking must be an object/
    );
  });

  it("rejects a non-string provider", () => {
    expect(
      validateObservability({ errorTracking: { provider: true } })[0]
    ).toContain("observability.errorTracking.provider");
  });

  it("is part of validateConfig", () => {
    expect(
      validateConfig({ observability: { analytics: { provider: "x" } } })
    ).toHaveLength(1);
  });
});

describe("observability local override", () => {
  it("merges local over committed, so a bad local value is validated", () => {
    const root = project(
      { observability: { errorTracking: { provider: "sentry" } } },
      { observability: { analytics: { provider: "mixpanel" } } }
    );
    const cfg = readValidationConfig(root);
    expect(cfg?.observability).toEqual({
      errorTracking: { provider: "sentry" },
      analytics: { provider: "mixpanel" },
    });
    expect(validateConfig(cfg ?? {})[0]).toContain(
      "observability.analytics.provider"
    );
  });
});
