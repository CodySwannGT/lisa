/** Exact immutable wrapper registry for every managed public route. */
import { describe, expect, it } from "vitest";

import {
  resolveScratchRouteProfile,
  type ScratchRouteProfileName,
} from "../../../src/configs/vitest/scratch-route-profile.js";

const ROUTES: readonly ScratchRouteProfileName[] = [
  "lisa",
  "typescript",
  "nestjs",
  "cdk",
  "harper-fabric",
  "phaser",
];

describe("lisa-test-run scratch route profiles", () => {
  it.each(ROUTES)("freezes the explicit %s registry", route => {
    const profile = resolveScratchRouteProfile(route, {});

    expect(profile.name).toBe(route);
    expect(profile.suiteLabel).toBe(route);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.registeredPrefixes)).toBe(true);
  });

  it("binds the CDK route to its real default assembly prefix", () => {
    expect(resolveScratchRouteProfile("cdk", {})).toEqual({
      name: "cdk",
      suiteLabel: "cdk",
      registeredPrefixes: ["cdk.out"],
    });
  });

  it("binds the Lisa route to its committed fixture registry", () => {
    expect(resolveScratchRouteProfile("lisa", {}).registeredPrefixes).toEqual([
      "changelog-",
      "derived-",
      "e2e-",
      "failure-signatures-",
      "invoked-",
      "lisa-",
      "maestro-",
      "node-",
      "review-",
      "skipreq-",
      "state-",
      "vacuity-",
      "wiki-",
    ]);
  });

  it("canonicalizes operator additions and refuses suite conflicts", () => {
    expect(
      resolveScratchRouteProfile("typescript", {
        LISA_TEST_SCRATCH_PREFIXES: '["fixture-","fixture-"]',
      }).registeredPrefixes
    ).toEqual(["fixture-"]);
    expect(() =>
      resolveScratchRouteProfile("cdk", {
        LISA_TEST_SCRATCH_SUITE: "typescript",
      })
    ).toThrow(/conflicts/iu);
  });

  it.each(["", "unknown", "../cdk"])("refuses profile %j", profile => {
    expect(() => resolveScratchRouteProfile(profile, {})).toThrow(/profile/iu);
  });
});
