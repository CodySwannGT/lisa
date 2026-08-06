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

/** Every bootstrap invocation inside the field. */
const invocations =
  SETUP_FIELD.match(/npx -y @codyswann\/lisa@[\d.]+ workstation[^;|]*/g) ?? [];

describe("the workstation invocations in the setup field", () => {
  it("are present at all", () => {
    // Two: one for the provider CLI, one for the tools its secrets imply.
    expect(invocations.length).toBe(2);
  });

  it("pass --install, without which they only report an inventory", () => {
    // The exact miss that shipped: a run that inspects and provisions nothing,
    // then exits 0.
    for (const invocation of invocations) {
      expect(invocation).toContain("--install");
    }
  });

  it("pass the provider as --provider=value, the only form parsed", () => {
    // `flag(name)` matches `--name` and value flags match `--name=`; a
    // space-separated value is silently ignored and no provider is selected.
    for (const invocation of invocations) {
      expect(invocation).toMatch(/--provider=/);
      expect(invocation).not.toMatch(/--provider\s+["'$]/);
    }
  });

  it("pass no flag the bootstrap does not define", () => {
    // `--yes` was carried for a while and does nothing; a flag that is ignored
    // reads as an intent that is being honoured.
    for (const invocation of invocations) {
      const flags = invocation.match(/--[a-z-]+/g) ?? [];
      expect(flags.sort()).toEqual([
        "--agents",
        "--install",
        "--provider",
        "--tools",
      ]);
    }
  });
});

describe("failures in the preparation phases", () => {
  it("captures each phase's status rather than discarding it", () => {
    // A bare `|| true` let a container come up with a bootstrap token and
    // nothing able to use it, looking identical to success.
    expect(SETUP_FIELD).toMatch(/workstation[^;]*\|\| tw=\$\?/);
    expect(SETUP_FIELD).toMatch(/workstation[^;]*\|\| tt=\$\?/);
    expect(SETUP_FIELD).toMatch(/remote-env --phase=secrets \|\| ts=\$\?/);
  });

  it("names each failure ON STDERR, which is what the vendor surfaces", () => {
    // Asserting only the text leaves the test green if `>&2` is removed, and a
    // diagnostic on stdout is one the operator never sees.
    expect(SETUP_FIELD).toMatch(
      /echo "SETUP INCOMPLETE: tool install failed [^"]*" >&2/
    );
    expect(SETUP_FIELD).toMatch(
      /echo "SETUP INCOMPLETE: secrets did not materialize [^"]*" >&2/
    );
  });

  it("exports PATH BEFORE the secrets phase, not after", () => {
    // Ordering is the whole fix: materialization spawns the provider CLI by
    // name, and the toolchain installs it into ~/.local/bin. Reversed, it gets
    // ENOENT on a binary that is sitting right there. Asserting both strings
    // exist would pass with them in either order.
    const path = SETUP_FIELD.indexOf('export PATH="$HOME/.local/bin:$PATH"');
    const secrets = SETUP_FIELD.indexOf("remote-env --phase=secrets");

    expect(path).toBeGreaterThan(-1);
    expect(secrets).toBeGreaterThan(path);
  });

  it("still exits 0, because propagating would stop the session starting", () => {
    // Propagating turns "no credentials this session" into "no session" — the
    // regression that killed every repo-less channel session once already.
    expect(SETUP_FIELD.trimEnd().endsWith("exit 0")).toBe(true);
  });
});

describe("the Lisa the field executes", () => {
  it("is pinned, not @latest", () => {
    // `npx -y` runs whatever the spec resolves to, as root, before Claude
    // launches. `@latest` makes that a moving target — and this project refuses
    // to install a third-party tool without a pinned version and checksum, so
    // exempting itself would be a standard it does not hold itself to.
    expect(SETUP_FIELD).not.toContain("@codyswann/lisa@latest");
    expect(SETUP_FIELD).toMatch(/@codyswann\/lisa@\d+\.\d+\.\d+/);
  });

  it("uses the same pin for every invocation", () => {
    // Two different Lisas preparing one session is a difference nobody would
    // think to look for — and the field now runs four of them.
    const specs = SETUP_FIELD.match(/@codyswann\/lisa@[\d.]+/g) ?? [];
    expect(specs.length).toBe(4);
    expect(new Set(specs).size).toBe(1);
  });
});

describe("the runner invocation in the setup field", () => {
  it("calls a registered CLI command", () => {
    // `remote-env` was called before it existed as a command; guarded by
    // `|| true`, the failure was silent and the session came up with a
    // bootstrap token and nothing able to use it.
    expect(SETUP_FIELD).toMatch(
      /npx -y @codyswann\/lisa@[\d.]+ remote-env --phase=secrets/
    );
  });
});
