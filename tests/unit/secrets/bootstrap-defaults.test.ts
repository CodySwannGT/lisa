/**
 * A bootstrap stored on the machine has to be one a project will actually read.
 *
 * Two defaults were missing, and together they made machine setup look like it
 * worked while every project failed. `bootstrap.sources` defaulted to `["env"]`,
 * so a token in the OS keychain was never consulted; and `bootstrap.key`
 * defaulted to `null`, so each project had to restate a name that is derivable
 * from its own namespace.
 *
 * Live projects hid it by setting both by hand. A fresh one would not have.
 * @module tests/unit/secrets/bootstrap-defaults
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SURFACES,
  readConfig,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";

let project: string;

/**
 * Write a `.lisa.config.json` carrying the given secrets block.
 * @param secrets The block to write.
 */
function config(secrets: unknown): void {
  writeFileSync(
    path.join(project, ".lisa.config.json"),
    JSON.stringify({ secrets })
  );
}

beforeEach(() => {
  project = mkdtempSync(path.join(tmpdir(), "lisa-bootstrap-"));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe("bootstrap defaults", () => {
  it('consults the keychain, which `["env"]` alone never did', () => {
    config({ provider: "bitwarden", namespace: "tunnl" });

    expect(readConfig(project, {}).bootstrap.sources).toEqual([
      "env",
      "keychain",
    ]);
  });

  it("keeps env FIRST, so CI never reaches for a local store", () => {
    // A runner injects the bootstrap into the environment. Consulting a
    // developer's keychain ahead of that would bind a job to whoever's machine
    // happened to have one.
    config({ provider: "bitwarden", namespace: "tunnl" });

    expect(readConfig(project, {}).bootstrap.sources[0]).toBe("env");
  });

  it("derives the key from the provider and namespace", () => {
    config({ provider: "bitwarden", namespace: "tunnl" });

    expect(readConfig(project, {}).bootstrap.key).toBe(
      "BWS_ACCESS_TOKEN_tunnl"
    );
  });

  it("derives it from the CHOSEN provider, not Bitwarden's name", () => {
    config({ provider: "doppler", namespace: "acme" });

    expect(readConfig(project, {}).bootstrap.key).toBe("DOPPLER_TOKEN_acme");
  });

  it("leaves the key null for a provider with no such variable", () => {
    // Inventing one produces a variable nothing reads. `providerEnv` already
    // treats an unmapped provider as "inject nothing".
    config({ provider: "1password", namespace: "acme" });

    expect(readConfig(project, {}).bootstrap.key).toBeNull();
  });

  it("never overrides what a project spelled out", () => {
    // A non-derivable name is a legitimate choice, and overriding it would
    // point sessions at a variable nobody set.
    config({
      provider: "bitwarden",
      namespace: "tunnl",
      bootstrap: { sources: ["env"], key: "CUSTOM_NAME" },
    });

    expect(readConfig(project, {}).bootstrap).toEqual({
      sources: ["env"],
      key: "CUSTOM_NAME",
    });
  });

  it("fills only the half a project left out", () => {
    config({
      provider: "bitwarden",
      namespace: "tunnl",
      bootstrap: { key: "CUSTOM_NAME" },
    });

    expect(readConfig(project, {}).bootstrap).toEqual({
      sources: ["env", "keychain"],
      key: "CUSTOM_NAME",
    });
  });
});

describe("the container surface", () => {
  it("materializes, which `local` standing in for it did not", () => {
    // A container has no keychain and dies with its filesystem, so secrets have
    // to reach disk. `local` is materialized:false — right for a human at a
    // keyboard, wrong for a container, and the reason `claude-web` was being
    // claimed by containers that were not one.
    expect(SURFACES.container).toEqual({
      materialized: true,
      mayWriteValues: true,
      materializeAt: "setup",
    });
  });

  it("does not disturb what `local` means", () => {
    expect(SURFACES.local.materialized).toBe(false);
  });
});
