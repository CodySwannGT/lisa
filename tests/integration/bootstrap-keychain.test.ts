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

import { afterEach, describe, expect, it } from "vitest";

import {
  storeBootstrap,
  clearBootstrap,
} from "../../plugins/src/base/skills/lisa-secrets-access/scripts/bootstrap-store.mjs";
import { boundedExecFileSync } from "../helpers/io-latency-budget.js";

/**
 * Namespaced so it cannot collide with anything an operator relies on, and
 * carrying the pid so it cannot collide with a second copy of THIS FILE.
 *
 * The prefix alone was the original namespacing, and it protects the wrong
 * boundary. The login keychain is machine-global — the one shared resource the
 * scratch-namespace redirection does not cover, because that relocates
 * `os.tmpdir()` and nothing else — so two runs of this suite on one box write,
 * read and clear the SAME item.
 *
 * Measured on this box (CodySwannGT/lisa#3032): one full-suite run alone
 * reports 923 files passed; two started together report 922 passed and 1 failed
 * each, and the failing file differs between them. This file was one of the
 * two, failing `clears` because the sibling run had re-stored the value between
 * this run's clear and its read-back:
 *
 * ```
 * AssertionError: expected 'spaces and "quotes" and \backslash' to be null
 * ```
 *
 * Both files pass on their own. That is "repeated runs disagree" arriving
 * through a resource nobody had looked at, and the pid makes it impossible by
 * construction rather than unlikely by timing.
 */
const SERVICE = `lisa-test-bootstrap-probe-${String(process.pid)}`;

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
    return boundedExecFileSync({
      label: "security find-generic-password",
      command: "/usr/bin/security",
      args: [
        "find-generic-password",
        "-s",
        SERVICE,
        "-a",
        process.env.USER ?? "",
        "-w",
      ],
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
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

  it("uses a service name no concurrent copy of this file can share", () => {
    // The bite: on the pre-fix constant this fails, because the name is a bare
    // literal every run on the box resolves to the same keychain item. It is
    // asserted on the NAME rather than on a staged race, because a race that
    // reproduces on demand is a race that was never the problem.
    expect(SERVICE).toContain(String(process.pid));
    expect(SERVICE).not.toBe("lisa-test-bootstrap-probe");
  });

  it("refuses a value carrying a newline rather than truncating it", () => {
    // A newline terminates the command line `security -i` is reading, and no
    // quoting survives it — so half the credential would be stored silently.
    expect(() =>
      storeBootstrap(SERVICE, "before\nafter", { kind: "keychain" })
    ).toThrow(/newline/);
  });
});
