/**
 * Regression tests for the two questions `bootstrap.key` used to conflate.
 *
 * "Where do we find the bootstrap?" must be configurable — one workstation
 * serves several tenants and each needs its own token under its own name.
 * "What does the provider CLI call it?" is fixed by the vendor: `bws` reads
 * `BWS_ACCESS_TOKEN` and nothing else.
 *
 * Answering both with one value worked only while every project used the
 * default name, where the two coincide. The first project to set
 * `bootstrap.key: "BWS_ACCESS_TOKEN_<tenant>"` handed the CLI a variable it had
 * never heard of, and every read and rotation failed with "Missing access
 * token".
 * @module tests/unit/secrets/bootstrap-key-naming
 */
import { afterEach, describe, expect, it } from "vitest";

import { providerEnv } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/providers.mjs";
import { renderWorkflow } from "../../../plugins/src/base/skills/lisa-setup-automations/scripts/generate-workflow.mjs";

/** A tenant-scoped bootstrap name, the case that exposed the bug. */
const SLUGGED = "BWS_ACCESS_TOKEN_tenant";

/** A distinctive value, so a test can tell a real resolution from an error. */
const TENANT_TOKEN = "tenant-token";

/** The only name the Bitwarden CLI reads. */
const CANONICAL = "BWS_ACCESS_TOKEN";

const cfgWith = (key: string): Record<string, unknown> => ({
  provider: "bitwarden",
  bootstrap: { sources: ["env"], key },
});

afterEach(() => {
  delete process.env[SLUGGED];
  delete process.env[CANONICAL];
});

describe("provider environment", () => {
  it("injects a slugged bootstrap under the CLI's canonical name", () => {
    // The bug: it injected under the slugged name, which bws never reads.
    process.env[SLUGGED] = TENANT_TOKEN;
    const env = providerEnv(cfgWith(SLUGGED));
    expect(env[CANONICAL]).toBe(TENANT_TOKEN);
  });

  it("still works when the configured name is already the canonical one", () => {
    process.env[CANONICAL] = "default-token";
    expect(providerEnv(cfgWith(CANONICAL))[CANONICAL]).toBe("default-token");
  });

  it("maps doppler to its own CLI variable, not Bitwarden's", () => {
    process.env.DOPPLER_SLUG = "doppler-token";
    const env = providerEnv({
      provider: "doppler",
      bootstrap: { sources: ["env"], key: "DOPPLER_SLUG" },
    });
    expect(env.DOPPLER_TOKEN).toBe("doppler-token");
    expect(env[CANONICAL]).toBeUndefined();
    delete process.env.DOPPLER_SLUG;
  });

  it("injects nothing for a provider that needs no bootstrap", () => {
    const env = providerEnv({
      provider: "env",
      bootstrap: { sources: [], key: null },
    });
    expect(env[CANONICAL]).toBeUndefined();
  });

  it("does not leak the tenant-scoped name into the child environment", () => {
    // Only the canonical name should be added. Passing both would let a
    // consumer bind to the wrong one and mask this class of bug again.
    process.env[SLUGGED] = TENANT_TOKEN;
    const before = { ...process.env };
    const env = providerEnv(cfgWith(SLUGGED));
    const added = Object.keys(env).filter(k => !(k in before));
    expect(added).toEqual([CANONICAL]);
  });
});

describe("generated workflow", () => {
  const loop = {
    schedule: "17 * * * *",
    executionEnv: "codex-cloud",
    repository: "org/repo",
    enabled: true,
  };

  it("templates a tenant-scoped bootstrap through every reference", () => {
    const yaml = renderWorkflow("intake", { ...loop, bootstrapKey: SLUGGED });
    expect(yaml).toContain(`${SLUGGED}: \${{ secrets.${SLUGGED} }}`);
    expect(yaml).toContain(`${SLUGGED} is not configured`);
    // The hardcoded default must not survive anywhere in the rendered file.
    expect(yaml).not.toContain(`secrets.${CANONICAL} }}`);
  });

  it("falls back to the canonical name when none is configured", () => {
    const yaml = renderWorkflow("intake", loop);
    expect(yaml).toContain(`${CANONICAL}: \${{ secrets.${CANONICAL} }}`);
  });

  it("asserts and exports the same name, so the resolver finds what CI set", () => {
    const yaml = renderWorkflow("intake", { ...loop, bootstrapKey: SLUGGED });
    expect(yaml).toContain(`test -n "\${${SLUGGED}}"`);
  });
});
