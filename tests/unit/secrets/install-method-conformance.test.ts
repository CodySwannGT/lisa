/**
 * Conformance between the two install-method lists.
 *
 * `assertPinned` (lisa-setup-remote-env) decides what the runner installs.
 * `validateRemoteEnv` (lisa-secrets-access) decides what config is accepted.
 * They are separate skills, distributed as self-contained directories, so the
 * second keeps a copy of the first's list rather than importing across a skill
 * boundary.
 *
 * That copy has drifted twice, and both times a comment was the only safeguard:
 *
 * 1. `release-tar` was absent from the validator while the runner had supported
 *    it for as long as gh had been pinned.
 * 2. `release-tree` and `release-binary` were both absent, so a valid `jq` pin
 *    was rejected by config validation while installing perfectly.
 *
 * Nothing had ever run the two against each other. This does. A kind added on
 * one side fails here until the other side learns it, which is the difference
 * between a convention and a mechanism.
 * @module tests/unit/secrets/install-method-conformance
 */

import { describe, expect, it } from "vitest";

import { validateRemoteEnv } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs";
import {
  assertPinned,
  INSTALL_METHODS,
} from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/toolchain.mjs";

/** A well-formed digest, so only the method itself is under test. */
const SHA = "a".repeat(64);

/** The kind whose obligations differ from every other download kind. */
const TREE = "release-tree";

/** A plausible-but-unsupported kind — jq also ships a .deb, so this is the
 * shape of a real mistake rather than a nonsense string. */
const UNKNOWN_METHOD = "release-deb";

/** A URL that is never fetched — validation must not need the network. */
const URL = "https://example.invalid/a";

/**
 * A minimal entry that satisfies every obligation of the given method, so the
 * only thing a rejection can be about is whether the method is recognised.
 * @param {string} method The install method to build an entry for.
 * @returns A complete manifest entry.
 */
function validEntryFor(method: string): Record<string, unknown> {
  const base = { name: "probe", version: "1.0.0", install: method };

  if (method === "npm-global") return { ...base, package: "probe-cli" };
  if (method === TREE) {
    return { ...base, url: URL, sha256: SHA, binary: "p/bin/p" };
  }
  return { ...base, url: URL, sha256: SHA };
}

/**
 * Ask the validator about one entry.
 * @param entry The manifest entry to validate.
 * @returns Every problem reported.
 */
function validate(entry: Record<string, unknown>): string[] {
  return validateRemoteEnv({ tools: { install: [entry] } });
}

describe("install-method conformance between runner and validator", () => {
  it.each([...INSTALL_METHODS])(
    "the validator accepts %s, which the runner can install",
    method => {
      const entry = validEntryFor(method);

      // Both sides must agree this is installable. The runner is the authority;
      // a validator that rejects it blocks a config the runner would honour.
      expect(() => assertPinned(entry)).not.toThrow();
      expect(validate(entry)).toEqual([]);
    }
  );

  it("the validator rejects a method the runner cannot install", () => {
    // The converse direction: a validator broader than the runner would pass
    // config through to fail at provisioning instead of in review.
    const unknown = { name: "probe", install: UNKNOWN_METHOD };

    expect(() => assertPinned(unknown)).toThrow(/unknown install method/);
    expect(validate(unknown)).not.toEqual([]);
  });

  it("names every supported kind when refusing an unknown one", () => {
    // The error message is where an operator learns which kinds exist, so it is
    // generated from the list rather than typed out beside it.
    const unknown = { name: "probe", install: UNKNOWN_METHOD };

    for (const method of INSTALL_METHODS) {
      expect(() => assertPinned(unknown)).toThrow(new RegExp(method));
    }
  });
});

describe("obligations the validator must not be weaker about", () => {
  // Derived, not listed: a new download kind inherits the checksum obligation
  // here automatically. A hand-written list is what let release-tree and
  // release-binary go unchecked in the first place.
  it.each([...INSTALL_METHODS].filter(m => m !== "npm-global"))(
    "requires a checksum for %s",
    method => {
      const unpinned = { ...validEntryFor(method), sha256: undefined };

      expect(() => assertPinned(unpinned)).toThrow(/sha256/);
      expect(validate(unpinned).join(" ")).toMatch(/needs both url and sha256/);
    }
  );

  it("requires an entry point for release-tree", () => {
    // The archive root is a directory; without this the install places one as
    // if it were a command.
    const noBinary = { ...validEntryFor("release-tree"), binary: undefined };

    expect(() => assertPinned(noBinary)).toThrow(/needs "binary"/);
    expect(validate(noBinary).join(" ")).toMatch(/needs "binary"/);
  });
});
