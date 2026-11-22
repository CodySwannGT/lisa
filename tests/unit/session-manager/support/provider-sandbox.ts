/**
 * A session-manager sandbox whose project resolves the Telegram bot token
 * from a secrets provider (CodySwannGT/lisa#4555): Bitwarden, served by the
 * stub `bws` over a fake vault file, with the bootstrap read from a fake
 * environment variable only (`secrets.bootstrap.sources: ["env"]`), so the
 * stub `security` must never run.
 *
 * The fake vault lives OUTSIDE the sandbox tree on purpose: it is the one
 * file allowed to hold the sentinel token, so a test can then scan every
 * file in the sandbox and prove the token was written nowhere else.
 * @module tests/unit/session-manager/support/provider-sandbox
 */
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  makeSandbox,
  runCli,
  STUB_BIN,
  type RunOptions,
  type RunResult,
  type Sandbox,
} from "./cli-harness.js";

/** A well-formed but fake bot token, assembled so it is not a literal. */
export const SENTINEL = [
  "555000111",
  "SENTINEL-fake-token-abcdefghijklmnopqrstuvwxyz",
].join(":");

/** The secret name for the harness's `demo-manager`. */
export const SECRET = "TELEGRAM_BOT_TOKEN_DEMO_MANAGER";

/** The vault project the test config narrows to. */
export const VAULT_PROJECT = "proj-demo";

/** One fake vault row. */
export interface VaultRow {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly note?: string;
  readonly projectId: string;
}

/** A provider-mode sandbox and its fake vault file. */
export interface ProviderSandbox extends Sandbox {
  readonly vault: string;
  readonly base: string;
}

const vaultDirs: string[] = [];

/** Remove every fake vault dir; register with `afterEach`. */
export function removeVaults(): void {
  for (const dir of vaultDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A sandbox configured for the bitwarden provider, with a fake vault.
 * @param rows - Initial vault rows
 * @param secrets - Overrides merged into the `secrets` block
 * @returns The sandbox and its vault file
 */
export function providerSandbox(
  rows: readonly VaultRow[] = [],
  secrets: Record<string, unknown> = {}
): ProviderSandbox {
  const sandbox = makeSandbox({
    extraConfig: {
      secrets: {
        provider: "bitwarden",
        namespace: "demo",
        bootstrap: { sources: ["env"], key: "BWS_ACCESS_TOKEN_DEMO" },
        narrow: { projectIds: [VAULT_PROJECT] },
        ...secrets,
      },
    },
  });
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "sm-vault-")));
  const vault = path.join(dir, "vault.json");
  vaultDirs.push(dir);
  writeFileSync(vault, JSON.stringify(rows));
  return { ...sandbox, vault, base: path.dirname(sandbox.log) };
}

/**
 * A PATH holding only the stubs, node, and the system dirs, so a real `bws`
 * installed anywhere else (e.g. `~/.local/bin`) can never be reached even if
 * a stub stops being executable. `/usr/bin/security` is shadowed by the stub.
 * @param prefix - Extra dirs to put first (e.g. stub clipboard tools)
 * @returns The PATH value
 */
export function stubOnlyPath(...prefix: string[]): string {
  for (const stub of ["bws", "security", "tmux"]) {
    if ((statSync(path.join(STUB_BIN, stub)).mode & 0o111) === 0) {
      throw new Error(`stub ${stub} is not executable; refusing to run`);
    }
  }
  return [
    ...prefix,
    STUB_BIN,
    path.dirname(process.execPath),
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(path.delimiter);
}

/**
 * Run the CLI with the fake provider's environment and a stub-only PATH.
 * @param sandbox - Provider sandbox
 * @param args - CLI arguments
 * @param options - Extra run options; `env` is merged over the provider env
 * @returns The run result
 */
export function runWithProvider(
  sandbox: ProviderSandbox,
  args: readonly string[],
  options: RunOptions = {}
): RunResult {
  return runCli(sandbox, args, {
    ...options,
    env: {
      PATH: stubOnlyPath(),
      BWS_ACCESS_TOKEN_DEMO: "fake-bootstrap-for-tests",
      STUB_BWS_VAULT: sandbox.vault,
      XDG_CONFIG_HOME: path.join(sandbox.home, ".config"),
      ...options.env,
    },
  });
}

/**
 * The fake vault's rows.
 * @param sandbox - Provider sandbox
 * @returns Rows
 */
export function readVault(sandbox: ProviderSandbox): VaultRow[] {
  return JSON.parse(readFileSync(sandbox.vault, "utf8")) as VaultRow[];
}

/**
 * Every file under the sandbox whose contents include `needle`.
 * @param dir - Directory to walk
 * @param needle - Text to look for
 * @returns Matching file paths
 */
export function filesContaining(dir: string, needle: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesContaining(full, needle);
    if (!entry.isFile()) return [];
    return readFileSync(full, "utf8").includes(needle) ? [full] : [];
  });
}
