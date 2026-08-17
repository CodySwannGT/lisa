/**
 * `environment <surface> --tenant=<name>`: one verb, one axis.
 *
 * The tenant guard is the one that matters. Every namespace is a directory
 * under `$XDG_CONFIG_HOME`, so resolving the wrong one writes one tenant's
 * credentials where another tenant's sessions read — and on a machine serving
 * several, the two would share a store. An early version fell back to the
 * default namespace and materialized 49 secrets of the wrong tenant before
 * anyone noticed.
 * @module tests/unit/secrets/environment-command
 */

import { describe, expect, it } from "vitest";

import {
  TARGETS,
  assertTarget,
  configureLocal,
} from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/environment.mjs";

/**
 * Seams standing in for the prompt, the store and the materializer.
 * @param over Overrides for a specific case.
 * @returns Dependencies plus the log they fill.
 */
function deps(over: Record<string, unknown> = {}): {
  d: Record<string, unknown>;
  stored: { key: string; value: string }[];
  materializedFor: unknown[];
} {
  const stored: { key: string; value: string }[] = [];
  const materializedFor: unknown[] = [];
  return {
    stored,
    materializedFor,
    d: {
      prompt: {
        canPrompt: () => true,
        promptSecret: () => "typed-value",
        ...((over.prompt as object) ?? {}),
      },
      store: {
        hasBootstrap: () => false,
        storeBootstrap: (key: string, value: string) => {
          stored.push({ key, value });
          return { kind: "keychain", where: "keychain" };
        },
        ...((over.store as object) ?? {}),
      },
      materialize: () => {
        materializedFor.push(true);
        return ["Materialized 3 secret(s)."];
      },
    },
  };
}

/** A resolved identity, as the resolver returns it. */
const IDENTITY = {
  tenant: "acmeorgd",
  provider: "bitwarden",
  bootstrapKey: "BWS_ACCESS_TOKEN_acmeorgd",
};

describe("assertTarget", () => {
  it("names every surface it can configure", () => {
    expect(Object.keys(TARGETS)).toEqual([
      "local",
      "container",
      "claude-web",
      "codex-cloud",
    ]);
  });

  it("runs local and emits the rest", () => {
    // The only difference between surfaces is whether Lisa can execute there.
    expect(TARGETS.local.mode).toBe("run");
    for (const name of ["container", "claude-web", "codex-cloud"]) {
      expect(TARGETS[name as keyof typeof TARGETS].mode).toBe("emit");
    }
  });

  it("refuses an unknown surface rather than defaulting", () => {
    // Defaulting would configure something other than what was typed, and on
    // this command the difference is where a credential ends up.
    expect(() => assertTarget("claude-cloud")).toThrow(/unknown environment/);
    expect(() => assertTarget(undefined)).toThrow(/unknown environment/);
  });
});

describe("configureLocal", () => {
  it("REFUSES without a tenant, because it writes", () => {
    // The bug that shipped in an early draft: no tenant meant the default
    // namespace, so it materialized the wrong tenant into the wrong directory.
    const { d } = deps();

    return expect(
      configureLocal({ ...IDENTITY, tenant: null }, d)
    ).rejects.toThrow(/needs --tenant/);
  });

  it("stores what was typed, then materializes", async () => {
    const { d, stored, materializedFor } = deps();

    await configureLocal(IDENTITY, d);

    expect(stored).toEqual([
      { key: "BWS_ACCESS_TOKEN_acmeorgd", value: "typed-value" },
    ]);
    expect(materializedFor).toHaveLength(1);
  });

  it("does not re-prompt when a bootstrap is already stored", async () => {
    // This command is also how an operator re-materializes after rotating a
    // secret in the vault. Demanding the token every time would make the common
    // case the tedious one.
    const { d, stored, materializedFor } = deps({
      store: { hasBootstrap: () => true },
    });

    const lines = await configureLocal(IDENTITY, d);

    expect(stored).toEqual([]);
    expect(lines.join("\n")).toMatch(/already stored; pass --rotate/);
    expect(materializedFor).toHaveLength(1);
  });

  it("re-prompts when --rotate says so", async () => {
    const { d, stored } = deps({ store: { hasBootstrap: () => true } });

    await configureLocal({ ...IDENTITY, rotate: true }, d);

    expect(stored).toHaveLength(1);
  });

  it("SKIPS the prompt without a terminal, and still materializes", async () => {
    // Hanging on a read nobody will answer looks like a slow install. And a
    // non-interactive caller can legitimately supply the bootstrap through the
    // environment, so this is not fatal.
    const { d, stored, materializedFor } = deps({
      prompt: { canPrompt: () => false },
    });

    const lines = await configureLocal(IDENTITY, d);

    expect(stored).toEqual([]);
    expect(lines.join("\n")).toMatch(/No terminal to prompt on/);
    expect(materializedFor).toHaveLength(1);
  });

  it("says so and stores nothing when the operator enters nothing", async () => {
    const { d, stored } = deps({ prompt: { promptSecret: () => "" } });

    const lines = await configureLocal(IDENTITY, d);

    expect(stored).toEqual([]);
    expect(lines.join("\n")).toMatch(/Nothing entered/);
  });

  it("explains a provider that has no such variable, and still materializes", async () => {
    // 1Password, Vault and AWS authenticate by other means; there is nothing to
    // store, which is different from having failed to store it.
    const { d, stored, materializedFor } = deps();

    const lines = await configureLocal(
      { tenant: "acme", provider: "1password", bootstrapKey: null },
      d
    );

    expect(stored).toEqual([]);
    expect(lines.join("\n")).toMatch(/1password has no environment-variable/);
    expect(materializedFor).toHaveLength(1);
  });
});
