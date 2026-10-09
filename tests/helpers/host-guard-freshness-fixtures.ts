/**
 * Install-only upgrade fixtures for the actual fallback CLI. Receipt history
 * and installed template bytes are independent inputs, as they are in a host.
 * @module tests/helpers/host-guard-freshness-fixtures
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  PLUGIN_HOOKS,
  REPO_ROOT,
  dateHostTree,
  scratchRoot,
} from "./enforcement-fallback-fixtures.js";
import { boundedSpawnSync } from "./io-latency-budget.js";

export const SELECTED_GUARDS = [
  "block-no-verify",
  "parity-safety-net",
  "block-shell-json-parsing",
  "block-instruction-file-edits",
  "block-direct-issue-create",
  "block-managed-file-edits",
  "block-blind-automerge",
  "worktree-binding-guard",
] as const;

export const INSTALLED_VERSION = "4.72.7";
export const HISTORICAL_VERSION = "4.33.1";

/**
 * A host with current real guards/templates and an independently old receipt.
 * @returns Owned temporary project root.
 */
export function currentHost(): string {
  const root = scratchRoot();
  const host = path.join(root, "scripts/lisa-hooks");
  const installed = path.join(root, "node_modules/@codyswann/lisa");
  const templates = path.join(
    installed,
    "all/copy-overwrite/scripts/lisa-hooks"
  );
  mkdirSync(host, { recursive: true });
  mkdirSync(templates, { recursive: true });
  for (const name of readdirSync(PLUGIN_HOOKS).filter(file =>
    /\.(?:sh|bash|mjs|py)$/u.test(file)
  )) {
    copyFileSync(path.join(PLUGIN_HOOKS, name), path.join(host, name));
    copyFileSync(path.join(PLUGIN_HOOKS, name), path.join(templates, name));
  }
  writeFileSync(
    path.join(installed, "package.json"),
    `${JSON.stringify({ name: "@codyswann/lisa", version: INSTALLED_VERSION }, null, 2)}\n`
  );
  dateHostTree(root, HISTORICAL_VERSION);
  return root;
}

/**
 * Hash the receipt and every selected guard without reading external state.
 * @param root Owned fixture root.
 * @returns Ordered receipt and selected guard digests.
 */
export function hostState(root: string): readonly string[] {
  return [
    ".lisa/apply-receipt.json",
    ...SELECTED_GUARDS.map(name => `scripts/lisa-hooks/${name}.sh`),
  ].map(file =>
    createHash("sha256")
      .update(readFileSync(path.join(root, file)))
      .digest("hex")
  );
}

/**
 * Assertable authoritative template path for one fixed-roster guard.
 * @param root Owned fixture root.
 * @param guard Fixed-roster guard name.
 * @returns Installed authoritative template path.
 */
export function template(root: string, guard = "block-no-verify"): string {
  return path.join(
    root,
    "node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-hooks",
    `${guard}.sh`
  );
}

export const SOURCE_FALLBACK = path.join(
  REPO_ROOT,
  "scripts/lisa-enforcement-fallback.sh"
);

/**
 * File-backed hook input with an owned driver, including isolated subjects.
 * @param root Owned fixture root.
 * @param command Command supplied as hook input data only.
 * @param options Isolated process inputs.
 * @param options.subject Actual dispatcher path.
 * @param options.session Hook session identifier.
 * @param options.tmp Private notice-state directory.
 * @param options.env Specific subprocess overrides.
 * @returns Actual process status and full combined output.
 */
export function driveFreshness(
  root: string,
  command = "git commit --no-verify -m x",
  options: {
    readonly subject?: string;
    readonly session?: string;
    readonly tmp?: string;
    readonly env?: Readonly<Record<string, string>>;
  } = {}
): { readonly status: number | null; readonly output: string } {
  const driverRoot = scratchRoot();
  const payload = path.join(driverRoot, "payload.json");
  const driver = path.join(driverRoot, "driver.sh");
  /**
   * Execute only after the file-backed inputs exist.
   * @returns Captured hook process result.
   */
  const execute = (): {
    readonly status: number | null;
    readonly output: string;
  } => {
    const result = boundedSpawnSync({
      label: "file-backed real host freshness CLI",
      command: "/bin/bash",
      args: [driver],
      cwd: root,
      env: {
        // eslint-disable-next-line no-restricted-syntax -- a real subprocess fixture inherits the installed toolchain
        ...process.env,
        CLAUDE_PROJECT_DIR: root,
        CLAUDE_CONFIG_DIR: path.join(driverRoot, "empty-config"),
        TMPDIR: options.tmp ?? driverRoot,
        LISA_FRESHNESS_SUBJECT: options.subject ?? SOURCE_FALLBACK,
        LISA_FRESHNESS_PAYLOAD: payload,
        ...options.env,
      },
    });
    return {
      status: result.status,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  };
  writeFileSync(
    payload,
    JSON.stringify({
      ...(options.session ? { session_id: options.session } : {}),
      tool_name: "Bash",
      tool_input: { command },
    })
  );
  writeFileSync(
    driver,
    'exec /bin/bash "$LISA_FRESHNESS_SUBJECT" < "$LISA_FRESHNESS_PAYLOAD"\n'
  );
  return execute();
}

/**
 * Real runtime registry for exactly this project, without implying liveness.
 * @param root Owned project root.
 * @param version Independently recorded installed plugin version.
 * @returns Owned config directory.
 */
export function installedChannel(root: string, version: string): string {
  const config = scratchRoot();
  mkdirSync(path.join(config, "plugins"));
  writeFileSync(
    path.join(config, "plugins/installed_plugins.json"),
    JSON.stringify({
      plugins: {
        "lisa@lisa": [
          {
            projectPath: root,
            installPath: `${config}/plugins/cache/lisa/lisa/${version}`,
            version,
          },
        ],
      },
    })
  );
  return config;
}
