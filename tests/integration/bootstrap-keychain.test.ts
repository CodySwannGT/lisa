/**
 * The keychain write, executed against the real binary.
 *
 * The unit tests inject the runner and assert the shape of the call, which is
 * how the first version shipped broken: `security add-generic-password -w` with
 * no argument does NOT read the password from stdin. It opens an interactive
 * prompt, and with stdin piped it stores an EMPTY value and exits 0 — so the
 * command reported success and the machine had no credential.
 *
 * A shape assertion cannot catch that. Only running it can.
 * @module tests/integration/bootstrap-keychain
 */

import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  storeBootstrap,
  clearBootstrap,
} from "../../plugins/src/base/skills/lisa-secrets-access/scripts/bootstrap-store.mjs";

/** Namespaced so it cannot collide with anything an operator relies on. */
const SERVICE = "lisa-test-bootstrap-probe";

/** Not a credential, and shaped to exercise the quoting. */
const VALUE = 'spaces and "quotes" and \\backslash';

const darwin = process.platform === "darwin";

/**
 * Read the value back through the same path the resolver uses.
 * @returns What the keychain holds, or null when absent.
 */
function readBack(): string | null {
  try {
    // Absolute: a PATH-resolved `security` in a test that reads a credential
    // back is both a weaker check and a lint failure.
    return execFileSync(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-s",
        SERVICE,
        "-a",
        process.env.USER ?? "",
        "-w",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
  } catch {
    return null;
  }
}

afterEach(() => {
  if (darwin) clearBootstrap(SERVICE, { kind: "keychain" });
});

describe.runIf(darwin)("the keychain write, for real", () => {
  it("stores a value that reads back EQUAL", () => {
    // The regression that matters: the broken version also "succeeded" here,
    // and read back "".
    storeBootstrap(SERVICE, VALUE, { kind: "keychain" });

    expect(readBack()).toBe(VALUE);
  });

  it("updates in place, so rotation works", () => {
    storeBootstrap(SERVICE, "first", { kind: "keychain" });
    storeBootstrap(SERVICE, VALUE, { kind: "keychain" });

    expect(readBack()).toBe(VALUE);
  });

  it("clears", () => {
    storeBootstrap(SERVICE, VALUE, { kind: "keychain" });
    clearBootstrap(SERVICE, { kind: "keychain" });

    expect(readBack()).toBeNull();
  });

  it("refuses a value carrying a newline rather than truncating it", () => {
    // A newline terminates the command line `security -i` is reading, and no
    // quoting survives it — so half the credential would be stored silently.
    expect(() =>
      storeBootstrap(SERVICE, "before\nafter", { kind: "keychain" })
    ).toThrow(/newline/);
  });
});
