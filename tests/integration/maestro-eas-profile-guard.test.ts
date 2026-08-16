/**
 * Tests that the EAS profile guard is wired where it can still save the build.
 *
 * The guard's value is entirely in its position: the two profile mistakes it
 * catches are free to detect before the build and cost a ninety-minute native
 * build to discover after it — and when they surface after, they surface as
 * flows failing on screens that are not part of the app, which reads as a
 * product bug rather than a configuration one.
 *
 * A test that only checked the step existed would pass with the step at the
 * end of the job, so ORDER is what is asserted here.
 * @module tests/integration/maestro-eas-profile-guard
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadWorkflow } from "../helpers/workflow-test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.resolve(
  __dirname,
  "..",
  "..",
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

const workflow = loadWorkflow(WORKFLOW);
const steps = workflow.jobs.build?.steps ?? [];

/** The guard step, named once so the assertions cannot drift from it. */
const GUARD = "Check the build profile";
const indexOf = (fragment: string) =>
  steps.findIndex(step => step.name?.includes(fragment));

describe("the EAS profile guard runs before anything expensive", () => {
  it("is present in the build job", () => {
    expect(indexOf(GUARD)).toBeGreaterThan(-1);
  });

  it("runs before the EAS build", () => {
    expect(indexOf(GUARD)).toBeLessThan(indexOf("Build with EAS"));
  });

  it("runs before EAS setup, so a bad profile costs no EAS session", () => {
    expect(indexOf(GUARD)).toBeLessThan(indexOf("Setup EAS"));
  });

  it("runs after install, because it resolves out of node_modules", () => {
    expect(indexOf(GUARD)).toBeGreaterThan(indexOf("Install dependencies"));
  });
});

describe("the guard resolves from the package, not a copied file", () => {
  const body = steps[indexOf(GUARD)]?.run ?? "";

  it("prefers the installed package", () => {
    const pkg = body.indexOf("node_modules/@codyswann/lisa");
    const local = body.indexOf('"scripts/lisa-assert-eas-profile.mjs"');
    expect(pkg).toBeGreaterThan(-1);
    expect(pkg).toBeLessThan(local === -1 ? Infinity : local);
  });

  it("passes the caller's profile rather than assuming a name", () => {
    expect(body).toContain("inputs.eas_profile");
  });

  it("does not fail a project whose Lisa predates the guard", () => {
    // The guard blocking builds over its own rollout would be a worse failure
    // than the one it prevents.
    expect(body).toContain("::warning title=EAS profile unchecked");
    expect(body).toContain("exit 0");
  });

  it("does not discard the guard's output", () => {
    expect(body).not.toContain("2>/dev/null");
    expect(body).toContain("set -euo pipefail");
  });

  it("cannot report success while the guard fails", () => {
    const step = steps[indexOf(GUARD)] as Record<string, unknown>;
    expect(step["continue-on-error"]).toBeUndefined();
  });
});

describe("the iOS driver timeout stays generous", () => {
  it("keeps a startup bound of at least 180s", () => {
    // The suite abandons itself if the XCUITest driver never binds its port,
    // so this bound must exceed a slow cold start on a fresh simulator.
    const input = workflow.on?.workflow_call?.inputs
      ?.ios_driver_startup_timeout_ms as { default?: number } | undefined;
    expect(Number(input?.default)).toBeGreaterThanOrEqual(180000);
  });
});
