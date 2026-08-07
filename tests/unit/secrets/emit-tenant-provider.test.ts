/**
 * Emitting a repo-less environment must not require a repository.
 *
 * The command that configures a surface defined by having no checkout used to
 * read the bootstrap key out of `.lisa.config.json` in the working directory.
 * So it was run from a checkout that happened to be nearby, or it printed a
 * placeholder the operator substituted by hand — in a settings box with no
 * review, which is the failure this whole area exists to prevent.
 *
 * The provider is part of the answer, not a detail: `bws` reads
 * `BWS_ACCESS_TOKEN` and `doppler` reads `DOPPLER_TOKEN`, so a tenant told to
 * export the other one's name gets "Missing access token" from a CLI it
 * configured correctly.
 * @module tests/unit/secrets/emit-tenant-provider
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  emitClaudeWeb,
  resolveEmitTarget,
} from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

/** A directory with no Lisa config, standing in for "anywhere". */
let nowhere: string;

beforeEach(() => {
  nowhere = mkdtempSync(path.join(tmpdir(), "lisa-emit-"));
});

afterEach(() => {
  rmSync(nowhere, { recursive: true, force: true });
});

describe("resolveEmitTarget", () => {
  it("derives the key from the tenant, with no repository anywhere", async () => {
    // `await` is load-bearing: an unawaited `.resolves` is a floating promise
    // and the assertion cannot fail the test.
    await expect(
      resolveEmitTarget(["--emit=claude-web", "--tenant=tunnl"], {}, nowhere)
    ).resolves.toMatchObject({
      tenant: "tunnl",
      provider: "bitwarden",
      bootstrapKey: "BWS_ACCESS_TOKEN_tunnl",
    });
  });

  it("names the variable the CHOSEN provider's CLI reads", async () => {
    // Not `BWS_ACCESS_TOKEN_acme`. That was the bug: the provider was resolved
    // and then ignored when composing the name.
    await expect(
      resolveEmitTarget(["--tenant=acme", "--provider=doppler"], {}, nowhere)
    ).resolves.toMatchObject({ bootstrapKey: "DOPPLER_TOKEN_acme" });
  });

  it("returns no key for a provider with no environment bootstrap", async () => {
    // 1Password, Vault and AWS authenticate by other means. Inventing a name
    // for them produces a variable nothing reads.
    await expect(
      resolveEmitTarget(["--tenant=acme", "--provider=1password"], {}, nowhere)
    ).resolves.toMatchObject({ bootstrapKey: null });
  });

  it("honours LISA_TENANT and LISA_PROVIDER", async () => {
    // The same variables the repo-less runtime path already reads. Emit
    // ignoring them was the specific inconsistency.
    await expect(
      resolveEmitTarget(
        [],
        { LISA_TENANT: "acme", LISA_PROVIDER: "doppler" },
        nowhere
      )
    ).resolves.toMatchObject({
      tenant: "acme",
      bootstrapKey: "DOPPLER_TOKEN_acme",
    });
  });

  it("lets a flag beat the environment", async () => {
    await expect(
      resolveEmitTarget(
        ["--tenant=flagged"],
        { LISA_TENANT: "envvar" },
        nowhere
      )
    ).resolves.toMatchObject({ tenant: "flagged" });
  });

  it("lets a CONFIGURED key beat the convention", async () => {
    // A project may use a name that is not derivable. Telling its operator to
    // set a different one from the one their sessions read would be worse than
    // the placeholder this replaced.
    writeFileSync(
      path.join(nowhere, ".lisa.config.json"),
      JSON.stringify({ secrets: { bootstrap: { key: "CUSTOM_NAME" } } })
    );

    await expect(
      resolveEmitTarget(["--tenant=tunnl"], {}, nowhere)
    ).resolves.toMatchObject({ bootstrapKey: "CUSTOM_NAME" });
  });
});

describe("the emitted guidance", () => {
  /**
   * Emit for a tenant and provider.
   * @param tenant Tenant name.
   * @param provider Provider name.
   * @returns The emitted text.
   */
  async function emit(
    tenant: string | null,
    provider: string
  ): Promise<string> {
    const argv = [
      ...(tenant ? [`--tenant=${tenant}`] : []),
      `--provider=${provider}`,
    ];
    return emitClaudeWeb(await resolveEmitTarget(argv, {}, nowhere));
  }

  it("fills both placeholders in when the tenant is known", async () => {
    const out = await emit("tunnl", "bitwarden");

    expect(out).toContain("export LISA_TENANT=tunnl");
    expect(out).toContain("export BWS_ACCESS_TOKEN_tunnl=");
    expect(out).not.toContain("<your namespace>");
  });

  it("exports LISA_PROVIDER, because the field defaults it to bitwarden", async () => {
    // Without it a Doppler tenant gets `bws` installed and its own CLI absent,
    // having configured everything else correctly.
    expect(await emit("acme", "doppler")).toContain(
      "export LISA_PROVIDER=doppler"
    );
  });

  it("emits a COMMENT, not an export, when there is no such variable", async () => {
    // `export <1password has no ...>=` is a syntax error where it is pasted.
    const out = await emit("acme", "1password");

    expect(out).toContain("# 1password has no environment-variable bootstrap");
    expect(out).not.toMatch(/export <[^>]*1password/);
  });

  it("distinguishes 'nothing was named' from 'no such variable exists'", async () => {
    // One is fixed by re-running; the other cannot be fixed at all, and must
    // not read as an omission.
    const out = await emit(null, "bitwarden");

    expect(out).toContain("Re-run with --tenant=");
    expect(out).not.toContain("has no environment-variable bootstrap");
  });
});
