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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { providerEnv } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/providers.mjs";
import { renderWorkflow } from "../../../plugins/src/base/skills/lisa-setup-automations/scripts/generate-workflow.mjs";

/** A tenant-scoped bootstrap name, the case that exposed the bug. */
const SLUGGED = "BWS_ACCESS_TOKEN_tenant";

/** A distinctive value, so a test can tell a real resolution from an error. */
const TENANT_TOKEN = "tenant-token";

/** Value used where the configured name is already the canonical one. */
const DEFAULT_TOKEN = "default-token";

/** The only name the Bitwarden CLI reads. */
const CANONICAL = "BWS_ACCESS_TOKEN";

const cfgWith = (key: string): Record<string, unknown> => ({
  provider: "bitwarden",
  bootstrap: { sources: ["env"], key },
});

/**
 * Variables these tests set, snapshotted so the suite restores whatever the
 * runner had. Deleting unconditionally would destroy a legitimately-set
 * BWS_ACCESS_TOKEN in CI and leak that damage into later tests.
 */
const MANAGED = [SLUGGED, CANONICAL, "DOPPLER_SLUG"] as const;
let original: Record<string, string | undefined> = {};

beforeEach(() => {
  original = Object.fromEntries(MANAGED.map(k => [k, process.env[k]]));
  for (const key of MANAGED) delete process.env[key];
});

afterEach(() => {
  for (const key of MANAGED) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("provider environment", () => {
  it("injects a slugged bootstrap under the CLI's canonical name", () => {
    // The bug: it injected under the slugged name, which bws never reads.
    process.env[SLUGGED] = TENANT_TOKEN;
    const env = providerEnv(cfgWith(SLUGGED));
    expect(env[CANONICAL]).toBe(TENANT_TOKEN);
  });

  it("still works when the configured name is already the canonical one", () => {
    process.env[CANONICAL] = DEFAULT_TOKEN;
    expect(providerEnv(cfgWith(CANONICAL))[CANONICAL]).toBe(DEFAULT_TOKEN);
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
    // The child must hold exactly one bootstrap variable. Two would let a tool
    // probing for a similarly-named credential bind to the wrong tenant on a
    // workstation serving several — the bug this whole change exists to fix,
    // reintroduced one layer down.
    process.env[SLUGGED] = TENANT_TOKEN;
    const before = { ...process.env };
    const env = providerEnv(cfgWith(SLUGGED));

    expect(env[CANONICAL]).toBe(TENANT_TOKEN);
    expect(env[SLUGGED]).toBeUndefined();
    expect(Object.keys(env).filter(k => !(k in before))).toEqual([CANONICAL]);
  });

  it("keeps the canonical name when it is also the configured one", () => {
    // The removal must not delete the very variable it just set.
    process.env[CANONICAL] = DEFAULT_TOKEN;
    expect(providerEnv(cfgWith(CANONICAL))[CANONICAL]).toBe(DEFAULT_TOKEN);
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
    // Counting matters. The workflow exports the bootstrap in four steps —
    // assert, setup, dispatch, rotation-persist — and a mutant that leaves the
    // canonical name in any ONE of them would pass a mere `toContain`, then
    // fail at 3am on the step nobody checked.
    const yaml = renderWorkflow("intake", { ...loop, bootstrapKey: SLUGGED });
    const mapping = `${SLUGGED}: \${{ secrets.${SLUGGED} }}`;
    const occurrences = yaml.split(mapping).length - 1;

    expect(occurrences).toBe(4);
    expect(yaml).toContain(`${SLUGGED} is not configured`);
    expect(yaml).toContain(`test -n "\${${SLUGGED}}"`);
    // The default must not survive anywhere, in any form.
    expect(yaml).not.toContain(`secrets.${CANONICAL} }}`);
    expect(yaml).not.toContain(`${CANONICAL}:`);
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
