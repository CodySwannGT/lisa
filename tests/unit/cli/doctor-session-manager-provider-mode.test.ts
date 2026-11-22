/**
 * Doctor and the session-manager CLI must agree on whether the Telegram bot
 * token lives in a secrets provider (CodySwannGT/lisa#4555, part 2).
 *
 * The CLI decides through `lisa-secrets-access`'s `readConfig` (only the
 * committed `.lisa.config.json`, never the local override; with no config
 * file at all, the `LISA_TENANT` / `LISA_PROVIDER` environment fallback).
 * Doctor used to read the merged committed + local view, so a provider
 * declared only in `.lisa.config.local.json` made doctor demand a vault copy
 * the CLI would never read, and the reverse. This pins the two together on
 * the same fixtures. Only config files are read: the CLI side loads the
 * adapter but makes no provider call, and every env is injected.
 * @module tests/unit/cli/doctor-session-manager-provider-mode
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadTokenSecrets } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/token-store.mjs";
import { secretsProviderAt } from "../../../src/cli/doctor-session-manager-token.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

const BLOCK = { name: "p-manager", notify: { provider: "telegram" } };

/** One fixture: committed and local config bodies (undefined: no file). */
interface Case {
  readonly committed?: Record<string, unknown>;
  readonly local?: Record<string, unknown>;
  readonly env?: NodeJS.ProcessEnv;
  readonly expected: string | undefined;
}

const CASES: ReadonlyArray<readonly [string, Case]> = [
  [
    "a committed bitwarden provider",
    {
      committed: { secrets: { provider: "bitwarden" }, sessionManager: BLOCK },
      expected: "bitwarden",
    },
  ],
  [
    "a committed env provider",
    {
      committed: { secrets: { provider: "env" }, sessionManager: BLOCK },
      expected: undefined,
    },
  ],
  [
    "no secrets block",
    { committed: { sessionManager: BLOCK }, expected: undefined },
  ],
  [
    "a provider declared only in the local override",
    {
      committed: { sessionManager: BLOCK },
      local: { secrets: { provider: "bitwarden" } },
      expected: undefined,
    },
  ],
  [
    "a local override that tries to switch the provider off",
    {
      committed: { secrets: { provider: "doppler" }, sessionManager: BLOCK },
      local: { secrets: { provider: "env" } },
      expected: "doppler",
    },
  ],
  [
    "no committed config, with a tenant in the environment",
    {
      local: { sessionManager: BLOCK },
      env: { LISA_TENANT: "demo" },
      expected: "bitwarden",
    },
  ],
  [
    "no committed config, with the env provider named in the environment",
    {
      local: { sessionManager: BLOCK },
      env: { LISA_TENANT: "demo", LISA_PROVIDER: "env" },
      expected: undefined,
    },
  ],
  ["no config and no environment", { local: {}, expected: undefined }],
];

/**
 * A project dir (with a `.git` boundary so the CLI's upward walk stops).
 * @param fx - Config bodies
 * @returns Project root
 */
async function project(fx: Case): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lisa-doctor-smpm-"));
  roots.push(root);
  await mkdir(path.join(root, ".git"));
  if (fx.committed) {
    await writeFile(
      path.join(root, ".lisa.config.json"),
      JSON.stringify(fx.committed)
    );
  }
  if (fx.local) {
    await writeFile(
      path.join(root, ".lisa.config.local.json"),
      JSON.stringify(fx.local)
    );
  }
  return root;
}

describe("doctor and the CLI decide provider mode the same way", () => {
  it.each(CASES)("%s", async (_label, fx) => {
    const root = await project(fx);
    const env = fx.env ?? {};
    const cli = await loadTokenSecrets(root, env);
    const doctor = await secretsProviderAt(
      root,
      file => readFile(file, "utf8"),
      env
    );
    const cfg = cli?.cfg as { readonly provider?: string } | undefined;
    expect(cfg?.provider).toBe(fx.expected);
    expect(doctor).toBe(fx.expected);
  });
});
