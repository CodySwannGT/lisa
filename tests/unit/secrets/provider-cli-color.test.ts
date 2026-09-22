/**
 * @file provider-cli-color.test.ts
 * @description Pins that every Bitwarden CLI call is spawned with colour off.
 *
 * Measured 2026-09-22 on a workstation with bws 2.1.0: `bws secret list
 * --output json` written to a pipe began with `\x1b[38;2;248;248;242m`, and
 * `NO_COLOR=1`, `TERM=dumb`, `CLICOLOR=0` and `CLICOLOR_FORCE=0` changed
 * nothing. The resolver then failed to parse for every secret, a known-good
 * control included, which read as "the vault is empty". Only `--color no`
 * suppressed it, and only when placed before the subcommand.
 */
import { describe, expect, it } from "vitest";

import { providerArgs } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/providers.mjs";

describe("providerArgs", () => {
  it("puts --color no ahead of every bws subcommand", () => {
    expect(providerArgs("bws", ["secret", "list", "--output", "json"])).toEqual(
      ["--color", "no", "secret", "list", "--output", "json"]
    );
  });

  it("switches colour off for writes and deletes too, not just reads", () => {
    for (const args of [
      ["secret", "edit", "id", "--value", "v"],
      ["secret", "create", "KEY", "v", "project"],
      ["secret", "delete", "id", "--output", "none"],
    ]) {
      expect(providerArgs("bws", args).slice(0, 2)).toEqual(["--color", "no"]);
      expect(providerArgs("bws", args).slice(2)).toEqual(args);
    }
  });

  it("leaves other provider CLIs exactly as composed", () => {
    const args = ["secrets", "download", "--no-file", "--format", "json"];
    expect(providerArgs("doppler", args)).toEqual(args);
    expect(providerArgs("op", ["item", "list"])).toEqual(["item", "list"]);
  });

  it("never mutates the caller's array", () => {
    const args = ["secret", "list"];
    providerArgs("bws", args);
    expect(args).toEqual(["secret", "list"]);
  });

  it("would fail JSON.parse without the switch, which is the whole point", () => {
    // The first bytes bws 2.1.0 emits to a pipe when colour is on.
    const coloured = "\u001b[38;2;248;248;242m[\u001b[0m\n";
    expect(() => JSON.parse(coloured)).toThrow();
  });
});
