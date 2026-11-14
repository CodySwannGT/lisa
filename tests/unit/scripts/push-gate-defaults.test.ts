/**
 * The stack's `pushGate` defaults (CodySwannGT/lisa#4611): a TypeScript host
 * gets the smart push gate switched on without writing it, anything it does
 * write wins, and a malformed block is left for the readers to refuse.
 * @module tests/unit/scripts/push-gate-defaults
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  isTypeScriptProject,
  pushGateDefaultsFor,
  TYPESCRIPT_PUSH_GATE_DEFAULTS,
  withPushGateDefaults,
} from "../../../all/copy-overwrite/scripts/lib/push-gate-defaults.mjs";
import { TypeScriptDetector } from "../../../src/detection/detectors/typescript.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * A private project root holding the given files.
 * @param files - Relative path to content
 * @returns Absolute root
 */
function project(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-push-gate-defaults-"));
  roots.push(root);
  for (const [file, body] of Object.entries(files))
    writeFileSync(path.join(root, file), body);
  return root;
}

const TS_MANIFEST = JSON.stringify({ devDependencies: { typescript: "5" } });

describe("isTypeScriptProject", () => {
  it.each([
    ["a root tsconfig.json", { "tsconfig.json": "{}" }, true],
    ["typescript in devDependencies", { "package.json": TS_MANIFEST }, true],
    [
      "typescript in dependencies",
      { "package.json": JSON.stringify({ dependencies: { typescript: "5" } }) },
      true,
    ],
    ["a manifest without typescript", { "package.json": "{}" }, false],
    ["an unreadable manifest", { "package.json": "{" }, false],
    ["nothing at all", {}, false],
  ])("agrees with src/detection for %s", async (_label, files, expected) => {
    const root = project(files);
    expect(isTypeScriptProject(root)).toBe(expected);
    expect(await new TypeScriptDetector().detect(root)).toBe(expected);
  });
});

describe("withPushGateDefaults", () => {
  it("fills in the TypeScript defaults when the project says nothing", () => {
    const root = project({ "tsconfig.json": "{}" });
    expect(withPushGateDefaults({}, root).pushGate).toEqual({
      cache: true,
      admission: true,
      affectedTests: true,
      affectedCoverage: "changed-files",
    });
  });

  it("does not default build-once on: a host's push gates do not build", () => {
    expect(TYPESCRIPT_PUSH_GATE_DEFAULTS).not.toHaveProperty("buildOnce");
  });

  it("lets every explicit value win, false included", () => {
    const root = project({ "tsconfig.json": "{}" });
    const config = {
      pushGate: {
        affectedTests: false,
        cache: false,
        affectedCoverage: "full",
      },
    };
    expect(withPushGateDefaults(config, root).pushGate).toEqual({
      cache: false,
      admission: true,
      affectedTests: false,
      affectedCoverage: "full",
    });
    expect(config.pushGate).toEqual({
      affectedTests: false,
      cache: false,
      affectedCoverage: "full",
    });
  });

  it.each([null, [], "yes", 1])(
    "leaves a malformed pushGate (%j) for the readers to refuse",
    pushGate => {
      const root = project({ "tsconfig.json": "{}" });
      expect(withPushGateDefaults({ pushGate }, root).pushGate).toBe(pushGate);
    }
  );

  it("adds nothing for a project that is not TypeScript", () => {
    const root = project({ "package.json": "{}" });
    expect(pushGateDefaultsFor(root)).toEqual({});
    expect(withPushGateDefaults({ gates: {} }, root)).toEqual({ gates: {} });
  });

  it("treats a missing config as empty", () => {
    const root = project({ "tsconfig.json": "{}" });
    expect(withPushGateDefaults(undefined, root).pushGate).toEqual(
      TYPESCRIPT_PUSH_GATE_DEFAULTS
    );
  });
});
