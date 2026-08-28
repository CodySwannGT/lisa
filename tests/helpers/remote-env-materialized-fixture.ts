/**
 * Real-shell fixture for the remote SessionStart materialized-env boundary.
 *
 * The fixture replaces only setup.sh. The entrypoint under test is the shipped
 * canonical session-start.sh, so GREEN must cross the real cached-session shell
 * boundary. No provider or network process runs.
 * @module tests/helpers/remote-env-materialized-fixture
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { boundedSpawnSync } from "./io-latency-budget.js";
import {
  HOSTILE_VALUE,
  type MaterializedArtifactKind,
  shellQuote,
  writeMaterializedArtifact,
} from "./remote-env-materialized-artifact.js";

export { HOSTILE_VALUE } from "./remote-env-materialized-artifact.js";
export type { MaterializedArtifactKind } from "./remote-env-materialized-artifact.js";
/** Parameters for one isolated remote-session fixture. */
export interface MaterializedFixtureOptions {
  /** Shape of the materialized values artifact. */
  readonly artifact?: MaterializedArtifactKind;
  /** Test-owned exact validator process refusal. */
  readonly authorityRefusal?: "foreign-owner";
  /** Namespace written into the project configuration. */
  readonly namespace?: string;
  /** Secret value materialized into the fixture artifact. */
  readonly value?: string;
}
/** Paths and fixed values owned by one fixture. */
export interface MaterializedFixture {
  readonly root: string;
  readonly home: string;
  readonly project: string;
  readonly configRoot: string;
  readonly namespace: string;
  readonly sessionStart: string;
  readonly valuesFile: string;
  readonly hookLog: string;
  readonly profileLog: string;
  readonly hostileEffect: string;
  readonly profileBefore: string;
  readonly value: string;
}

/** Result from the real SessionStart shell. */
export interface MaterializedSessionResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Safe namespace used by the project and materializer sides. */
export const MATERIALIZED_NAMESPACE = "lisa-remote-session-fixture";

const SOURCE = path.resolve(
  "plugins/src/base/skills/lisa-setup-remote-env/assets/session-start.sh"
);
const AUTHORITY_SOURCE = path.resolve(
  "plugins/src/base/skills/lisa-setup-remote-env/assets/" +
    "materialized-env-authority.mjs"
);

/**
 * Fake phase runner materializing locally and recording project-hook input.
 * @returns Shell source for the test-owned phase runner.
 */
function setupScript(): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'case "$' + '{1:-}" in',
    "  --phase=toolchain)",
    '    mkdir -p "$HOME/.local/bin"',
    "    ;;",
    "  --phase=secrets)",
    '    test -f "$LISA_FIXTURE_VALUES_FILE" || true',
    "    ;;",
    "  --phase=hook)",
    `    printf '%s\\n' "$` +
      '{LISA_FRESH_SECRET:-<missing>}" >> "$LISA_FIXTURE_HOOK_LOG"',
    '    test "$' + '{LISA_FRESH_SECRET:-}" = "$LISA_FIXTURE_EXPECTED"',
    "    ;;",
    "  *) exit 64 ;;",
    "esac",
    "",
  ].join("\n");
}

/**
 * Profile proving Lisa neither executes nor trusts unrelated startup code.
 * @param fixture - Isolated fixture whose profile paths must remain unused.
 * @returns Hostile profile source used to prove startup-file independence.
 */
function hostileProfile(fixture: MaterializedFixture): string {
  return [
    `printf profile-ran > ${shellQuote(fixture.profileLog)}`,
    "HOME=/ambient/poison-home",
    "PATH=/ambient/poison-path",
    "cd /",
    "return 0",
    "# >>> lisa secrets (managed v2) >>>",
    `if [ -f ${shellQuote(fixture.valuesFile)} ]; then`,
    "  set -a",
    `  . ${shellQuote(fixture.valuesFile)}`,
    "  set +a",
    "fi",
    "# <<< lisa secrets (managed v2) <<<",
    "",
  ].join("\n");
}

/**
 * Install the production authority CLI or one exact test-owned refusal.
 * @param scripts - Fixture directory containing the SessionStart assets.
 * @param refusal - Optional exact ownership-refusal replacement.
 */
function writeAuthorityValidator(
  scripts: string,
  refusal?: "foreign-owner"
): void {
  const target = path.join(scripts, "materialized-env-authority.mjs");
  if (refusal === "foreign-owner") {
    writeFileSync(
      target,
      "#!/usr/bin/env node\n" +
        "process.stderr.write(" +
        '"Lisa materialized environment file ownership mismatch\\n");\n' +
        "process.exitCode = 77;\n",
      { mode: 0o700 }
    );
  } else if (existsSync(AUTHORITY_SOURCE)) {
    writeFileSync(target, readFileSync(AUTHORITY_SOURCE), { mode: 0o700 });
  }
}

/**
 * Create one isolated fixture without starting any process.
 * @param options - Artifact and authority variants for the current test arm.
 * @returns Paths and values wholly owned by the new fixture.
 */
export function createMaterializedFixture(
  options: MaterializedFixtureOptions = {}
): MaterializedFixture {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-direct-env-"));
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  const scripts = path.join(project, "scripts", "lisa-remote-env");
  const configRoot = path.join(root, "xdg-config");
  const namespace = options.namespace ?? MATERIALIZED_NAMESPACE;
  const fixture: MaterializedFixture = {
    root,
    home,
    project,
    configRoot,
    namespace,
    sessionStart: path.join(scripts, "session-start.sh"),
    valuesFile: path.resolve(configRoot, namespace, "secrets.env"),
    hookLog: path.join(root, "hook.log"),
    profileLog: path.join(root, "profile.log"),
    hostileEffect: path.join(root, "hostile-effect"),
    profileBefore: "",
    value: options.value ?? HOSTILE_VALUE,
  };
  const profile = hostileProfile(fixture);
  mkdirSync(scripts, { recursive: true });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(fixture.sessionStart, readFileSync(SOURCE, "utf8"), {
    mode: 0o700,
  });
  writeAuthorityValidator(scripts, options.authorityRefusal);
  writeFileSync(path.join(scripts, "setup.sh"), setupScript(), { mode: 0o700 });
  writeFileSync(
    path.join(project, ".lisa.config.json"),
    `${JSON.stringify({ secrets: { namespace } })}\n`
  );
  writeMaterializedArtifact(fixture, options.artifact ?? "valid");
  writeFileSync(path.join(home, ".profile"), profile, { mode: 0o600 });
  return { ...fixture, profileBefore: profile };
}

/**
 * Run the shipped entrypoint in the fixture's closed environment.
 * @param fixture - Isolated fixture whose real SessionStart asset is executed.
 * @returns Captured status and streams from the bounded shell process.
 */
export function runMaterializedSession(
  fixture: MaterializedFixture
): MaterializedSessionResult {
  const run = boundedSpawnSync({
    label: "remote SessionStart direct materialized environment fixture",
    command: "/bin/bash",
    args: [fixture.sessionStart],
    cwd: fixture.root,
    env: {
      CLAUDE_CODE_REMOTE: "true",
      CLAUDE_PROJECT_DIR: fixture.project,
      HOME: fixture.home,
      LISA_FIXTURE_EXPECTED: fixture.value,
      LISA_FIXTURE_HOOK_LOG: fixture.hookLog,
      LISA_FIXTURE_VALUES_FILE: fixture.valuesFile,
      LISA_FRESH_SECRET: "ambient-must-lose",
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
      XDG_CONFIG_HOME: fixture.configRoot,
    },
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/**
 * Read a fixture file when present, otherwise return an empty string.
 * @param file - Test-owned file path whose content may not exist.
 * @returns UTF-8 content, or an empty string when the file is absent.
 */
export function readFixtureFile(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

/**
 * Stable identity facts for a valid materialized artifact.
 * @param fixture - Fixture containing the directory and values artifact.
 * @returns Permission and owner facts for both authority objects.
 */
export function artifactIdentity(fixture: MaterializedFixture): {
  readonly fileMode: number;
  readonly directoryMode: number;
  readonly fileUid: number;
  readonly directoryUid: number;
} {
  const file = lstatSync(fixture.valuesFile);
  const directory = lstatSync(path.dirname(fixture.valuesFile));
  return {
    fileMode: file.mode & 0o777,
    directoryMode: directory.mode & 0o777,
    fileUid: file.uid,
    directoryUid: directory.uid,
  };
}
