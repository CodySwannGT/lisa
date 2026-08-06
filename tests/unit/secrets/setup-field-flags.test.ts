/**
 * The setup field must invoke the bootstrap with flags it actually parses.
 *
 * Shipped wrong once, and the failure was quiet: the field passed
 * `--provider "bitwarden"` space-separated and omitted `--install`. The
 * bootstrap reads value flags only as `--name=value` and provisions only with
 * `--install`, so it selected no credential manager, installed nothing, and
 * exited 0 — under `|| true`, indistinguishable from success. A live Claude Tag
 * channel came up with both environment variables set and none of the eight
 * tools present.
 *
 * These assert the field against the bootstrap's real parsing rules rather than
 * against a copy of the intended string, so a change to either side has to
 * agree with the other.
 * @module tests/unit/secrets/setup-field-flags
 */

import { describe, expect, it } from "vitest";

import { SETUP_FIELD } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

/** The bootstrap invocation inside the field. */
const invocation =
  /npx -y @codyswann\/lisa@latest workstation[^;|]*/.exec(SETUP_FIELD)?.[0] ??
  "";

describe("the workstation invocation in the setup field", () => {
  it("is present at all", () => {
    expect(invocation).not.toBe("");
  });

  it("passes --install, without which it only reports an inventory", () => {
    // The exact miss that shipped: a run that inspects and provisions nothing,
    // then exits 0.
    expect(invocation).toContain("--install");
  });

  it("passes the provider as --provider=value, the only form parsed", () => {
    // `flag(name)` matches `--name` and value flags match `--name=`; a
    // space-separated value is silently ignored and no provider is selected.
    expect(invocation).toMatch(/--provider=/);
    expect(invocation).not.toMatch(/--provider\s+["'$]/);
  });

  it("passes no flag the bootstrap does not define", () => {
    // `--yes` was carried for a while and does nothing; a flag that is ignored
    // reads as an intent that is being honoured.
    const flags = invocation.match(/--[a-z-]+/g) ?? [];
    expect(flags.sort()).toEqual(["--install", "--provider"]);
  });
});

describe("failures in the preparation phases", () => {
  it("captures each phase's status rather than discarding it", () => {
    // A bare `|| true` let a container come up with a bootstrap token and
    // nothing able to use it, looking identical to success.
    expect(SETUP_FIELD).toMatch(/workstation[^;]*\|\| tw=\$\?/);
    expect(SETUP_FIELD).toMatch(/remote-env --phase=secrets \|\| ts=\$\?/);
  });

  it("names each failure on stderr", () => {
    expect(SETUP_FIELD).toContain("SETUP INCOMPLETE: tool install failed");
    expect(SETUP_FIELD).toContain(
      "SETUP INCOMPLETE: secrets did not materialize"
    );
  });

  it("still exits 0, because propagating would stop the session starting", () => {
    // Propagating turns "no credentials this session" into "no session" — the
    // regression that killed every repo-less channel session once already.
    expect(SETUP_FIELD.trimEnd().endsWith("exit 0")).toBe(true);
  });
});

describe("the runner invocation in the setup field", () => {
  it("calls a registered CLI command", () => {
    // `remote-env` was called before it existed as a command; guarded by
    // `|| true`, the failure was silent and the session came up with a
    // bootstrap token and nothing able to use it.
    expect(SETUP_FIELD).toContain(
      "npx -y @codyswann/lisa@latest remote-env --phase=secrets"
    );
  });
});
