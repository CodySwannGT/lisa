/**
 * An in-memory secrets adapter for the token-store unit tests (#4555).
 *
 * It stands in for `lisa-secrets-access`'s provider surface: a vault of rows,
 * a call log that records operations and secret NAMES only, and switches that
 * make a call fail the way a real provider does (rate-limited, unreachable,
 * no create support), so the store and resolve flows can be proved without
 * any real vault, CLI or network.
 * @module tests/unit/session-manager/support/fake-secrets
 */

/** One vault row, as the adapter's `list` returns it. */
export interface FakeRow {
  readonly key: string;
  readonly id: string;
  readonly value: string;
  readonly projectId: string | null;
  readonly note?: string;
}

/** Ways a fake call can fail. */
export type FakeFailure =
  | "rate-limit"
  | "unavailable"
  | "timeout"
  | "no-create"
  | "setup";

/** Options for {@link fakeSecrets}. */
export interface FakeOptions {
  readonly rows?: readonly FakeRow[];
  readonly provider?: string;
  readonly require?: readonly string[] | null;
  readonly projectIds?: readonly string[];
  /** Fail every `list` call this way. */
  readonly listFails?: FakeFailure;
  /** Fail `create` this way. */
  readonly createFails?: FakeFailure;
  /** Fail `preflight` with a setup problem. */
  readonly preflightFails?: boolean;
  /** Make the read-back after a write return this value instead. */
  readonly readBackValue?: string;
}

/**
 * An Error shaped like the one the real provider path throws for `kind`.
 * @param kind - Failure kind
 * @returns The error
 */
function failure(kind: FakeFailure): Error {
  if (kind === "rate-limit") {
    return Object.assign(new Error("Command failed: bws secret list"), {
      stderr: "Error: [429 Too Many Requests]",
    });
  }
  if (kind === "timeout") {
    return Object.assign(new Error("spawnSync bws ETIMEDOUT"), {
      code: "ETIMEDOUT",
    });
  }
  if (kind === "no-create") {
    return new Error('provider "doppler" has no create implemented.');
  }
  if (kind === "setup") {
    return Object.assign(
      new Error("BWS_ACCESS_TOKEN_DEMO not found in: env."),
      {
        kind: "setup",
      }
    );
  }
  return Object.assign(new Error("Command failed: bws secret list"), {
    stderr: "Error: error sending request",
  });
}

/**
 * Build a fake adapter and the config it reads.
 * @param options - Vault contents and failure switches
 * @returns The adapter, its config, the live vault and the call log
 */
export function fakeSecrets(options: FakeOptions = {}) {
  const vault: FakeRow[] = [...(options.rows ?? [])];
  const calls: string[] = [];
  const wrote = () => calls.some(call => /^(create|replace) /.test(call));
  const cfg = {
    provider: options.provider ?? "bitwarden",
    require: options.require ?? null,
    narrow: { projectIds: [...(options.projectIds ?? [])], excludeKeys: [] },
  };
  const adapter = {
    readConfig: () => cfg,
    preflight: () => {
      calls.push("preflight");
      if (options.preflightFails) throw failure("setup");
    },
    list: () => {
      calls.push("list");
      if (options.listFails) throw failure(options.listFails);
      if (wrote() && options.readBackValue !== undefined) {
        return vault.map(row => ({ ...row, value: options.readBackValue }));
      }
      return vault.map(row => ({ ...row }));
    },
    create: (
      _cfg: unknown,
      input: { name: string; value: string; projectId: string; note: string }
    ) => {
      calls.push(`create ${input.name} in ${input.projectId}`);
      if (options.createFails) throw failure(options.createFails);
      vault.push({
        key: input.name,
        id: `id-${vault.length + 1}`,
        value: input.value,
        projectId: input.projectId,
        note: input.note,
      });
    },
    replace: (_cfg: unknown, input: { id: string; value: string }) => {
      calls.push(`replace ${input.id}`);
      const at = vault.findIndex(row => row.id === input.id);
      const row = vault[at];
      if (row !== undefined) vault[at] = { ...row, value: input.value };
    },
  };
  return { adapter, cfg, vault, calls };
}
