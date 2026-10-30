/** Isolated real-hook continuation fixture; never inherits vendor credentials. */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { env as processEnv } from "node:process";
import { readConfig } from "../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";
import { requirementsContext } from "../../plugins/src/base/skills/lisa-secrets-access/scripts/task-requirements.mjs";
import { boundedSpawnSync } from "./io-latency-budget.js";
import { installTaskTools } from "./task-readiness-tools.js";
import { driveTask } from "./task-readiness-continuation.js";

const BASE = path.resolve(__dirname, "../../plugins/src/base");
const CONFIG = ".lisa.config.json";
const CONTEXT = ".lisa/work-item-context.md";
/** Required executable and private fixture locations. */
interface FixtureEnvironment extends Record<string, string> {
  PATH: string;
  HOME: string;
  XDG_CONFIG_HOME: string;
  TMPDIR: string;
}
export const HEADER = "<!-- lisa-required-access:v1\n";
const REQUIRED_ACCESS = [
  {
    id: "task-api-read",
    kind: "capability",
    credential_names: ["GITGUARDIAN_API_KEY"],
    access_layer: "gitguardian",
    operation: "token-read",
    resource: "42",
  },
];

/** Resolve a reviewed executable name using only the inherited search path.
 * @param name - Fixed tool name.
 * @returns Absolute executable location, when installed.
 */
function locate(name: string): string | undefined {
  return (processEnv.PATH ?? "")
    .split(path.delimiter)
    .map(p => path.join(p, name))
    .find(existsSync);
}

/** Install real script closures and synthetic provider executables.
 * @param root - Owned fixture root.
 * @returns Installed locations.
 */
function install(root: string) {
  const plugin = path.join(root, "plugin");
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  const calls = path.join(root, "calls.jsonl");
  const dirs = [
    bin,
    home,
    path.join(root, ".git"),
    path.join(root, ".lisa"),
    path.join(plugin, "hooks"),
  ];
  dirs.forEach(dir => mkdirSync(dir, { recursive: true }));
  for (const skill of [
    "lisa-secrets-access",
    "lisa-notion-access",
    "lisa-github-read-issue",
    "lisa-setup-workstation",
    "lisa-setup-remote-env",
  ])
    cpSync(
      path.join(BASE, "skills", skill),
      path.join(plugin, "skills", skill),
      { recursive: true }
    );
  for (const name of [
    "secrets-preflight.sh",
    "task-readiness-guard.sh",
    "task-readiness-guard.mjs",
    "secrets-preflight.agy.sh",
  ])
    cpSync(path.join(BASE, "hooks", name), path.join(plugin, "hooks", name));
  writeFileSync(
    path.join(
      plugin,
      "skills/lisa-setup-remote-env/scripts/preflight-tools.mjs"
    ),
    ""
  );
  for (const name of ["bash", "cat", "dirname", "jq", "git"]) {
    const found = locate(name);
    if (found) symlinkSync(found, path.join(bin, name));
  }
  symlinkSync(process.execPath, path.join(bin, "node"));
  installTaskTools(bin, calls, process.execPath);
  if (
    boundedSpawnSync({
      label: "isolated task repository",
      command: path.join(bin, "git"),
      args: ["init", "-q"],
      cwd: root,
      env: {
        PATH: bin,
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, ".config"),
      },
    }).status !== 0
  )
    throw new Error("Cannot initialize the isolated task repository");
  writeFileSync(path.join(root, ".gitignore"), `${CONTEXT}\n`);
  return { root, plugin, bin, home, calls };
}

/** Create an isolated child environment for the installed fixture.
 * @param locations - Owned executable locations.
 * @param failing - Synthetic provider refusal switch.
 * @param overrides - Additional synthetic values.
 * @returns Complete environment without inherited vendor credentials.
 */
function fixtureEnvironment(
  locations: ReturnType<typeof install>,
  failing: boolean,
  overrides: Record<string, string>
): FixtureEnvironment {
  const { root, plugin, bin, home } = locations;
  return {
    PATH: bin,
    HOME: home,
    TMPDIR: root,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    CLAUDE_PLUGIN_ROOT: plugin,
    LISA_PROJECT_DIR: root,
    LISA_SECRETS_SURFACE: "local",
    FIXTURE_BOOTSTRAP: "synthetic-bootstrap",
    FIXTURE_PROVIDER_FAIL: failing ? "1" : "0",
    ...overrides,
  };
}

/** Construct full synthetic inputs for a real canonical hook invocation.
 * @param routing - Whether GitHub contributes a routing-floor requirement.
 * @param failing - Whether the synthetic provider refuses its read.
 * @param overrides - Synthetic environment additions, never workstation credentials.
 * @returns Isolated fixture and real continuation entry point.
 */
export function taskFixture(
  routing = true,
  failing = true,
  overrides: Record<string, string> = {}
) {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-task-readiness-"));
  const locations = install(root);
  const { plugin } = locations;
  const env = fixtureEnvironment(locations, failing, overrides);
  const config = {
    gitguardian: { workspaceId: 42 },
    ...(routing
      ? { tracker: "github", github: { org: "fixture", repo: "project" } }
      : {}),
    secrets: {
      provider: "bitwarden",
      namespace: "fixture",
      bootstrap: { sources: ["env"], key: "FIXTURE_BOOTSTRAP" },
    },
  };
  const body =
    "# Synthetic task\nFull original fixture body and comments remain unchanged.\n";
  /** Refresh fixture metadata after a controlled config/requirement change.
   * @param requiredAccess - Complete current requirements.
   * @param identity - Canonical tracker/ref pair for this fixture.
   * @returns Newly written header.
   */
  function refresh(
    requiredAccess: unknown[] = REQUIRED_ACCESS,
    identity = { ref: "fixture/project#1", tracker: "github" }
  ) {
    const cfg = readConfig(root, {
      LISA_SECRETS_SURFACE: env.LISA_SECRETS_SURFACE,
    });
    const context = requirementsContext(
      cfg,
      identity.ref,
      identity.tracker,
      requiredAccess,
      body
    );
    const manifest = JSON.parse(
      context.slice(HEADER.length, context.indexOf("\n-->\n"))
    );
    writeFileSync(path.join(root, CONTEXT), context);
    return manifest;
  }
  writeFileSync(path.join(root, CONFIG), JSON.stringify(config));
  return {
    root,
    env,
    plugin,
    manifest: refresh(),
    body,
    run: (event = "PreToolUse", tool = "Write") =>
      driveTask(root, plugin, env, event, tool),
    runPlugin: (selected: string) =>
      driveTask(root, selected, { ...env, CLAUDE_PLUGIN_ROOT: selected }),
    runFrom: (cwd: string) =>
      driveTask(
        root,
        plugin,
        { ...env, LISA_PROJECT_DIR: "" },
        "PreToolUse",
        "Write",
        cwd
      ),
    refresh,
  };
}
