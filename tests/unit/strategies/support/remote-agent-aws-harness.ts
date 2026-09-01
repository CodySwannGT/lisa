/**
 * Shared fixtures for exercising the vendor-neutral remote AWS bootstrap.
 *
 * Kept out of the test modules so the installer coverage and the bootstrap
 * script coverage can live in separate files without either one duplicating
 * the disposable-workstation setup.
 * @module tests/unit/strategies/support/remote-agent-aws-harness
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { installFakeAwsCli, type FakeAwsCli } from "./fake-aws-cli.js";
import { boundedSpawnSync } from "../../../helpers/io-latency-budget.js";

/** The canonical script; every plugin copy is generated from it. */
export const REMOTE_SETUP_SCRIPT_PATH =
  "plugins/src/base/scripts/remote-agent-aws-setup.sh";

const temporaryDirectories: string[] = [];

/**
 * Create and register a disposable project directory.
 * @returns Absolute path to the disposable directory
 */
export function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lisa-remote-aws-"));
  temporaryDirectories.push(directory);
  return directory;
}

/** Remove every directory handed out since the last call. */
export function removeTemporaryDirectories(): void {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
}

/**
 * The only environment the bootstrap script may see.
 *
 * Built by allowlist rather than by spreading `process.env`. The script refuses
 * when `AWS_ACCESS_KEY_ID` is set directly — correctly, so that role profiles
 * cannot be bypassed — so a machine holding real AWS credentials tripped the
 * script's own guard and turned a happy-path assertion red on a correct tree.
 *
 * Blanking that one variable would have fixed the symptom. Inheriting a
 * developer's or a container's live AWS identity into a subprocess is worth
 * avoiding on its own, so nothing is inherited that this script does not need.
 * @param overrides - Variables this particular case supplies
 * @returns A minimal, machine-independent environment
 */
export function scriptEnvironment(
  overrides: Readonly<Record<string, string>>
): Record<string, string> {
  // Nothing is inherited. Every caller supplies PATH explicitly, because the
  // stubbed AWS CLI has to be findable and a real one must not be.
  return { ...overrides };
}

/**
 * A bootstrap bundle whose stage names are deliberately generic.
 *
 * `dev` and `production` are exactly the names two unrelated organisations both
 * use, which is what made them collide in a shared `~/.aws/config`.
 * @param devAccount - Account owning the dev role
 * @param productionAccount - Account owning the production role
 * @returns The bundle, double-encoded the way the real emission is
 */
export function bundleFor(
  devAccount: string,
  productionAccount: string
): string {
  return JSON.stringify({
    accessKeyId: "AKIATEST",
    secretAccessKey: "test-secret",
    externalId: "external-id",
    roleName: "RemoteAgent",
    profiles: JSON.stringify({
      dev: {
        roleArn: `arn:aws:iam::${devAccount}:role/RemoteAgent`,
        region: "us-east-1",
      },
      production: {
        roleArn: `arn:aws:iam::${productionAccount}:role/RemoteAgent`,
        region: "us-west-2",
      },
    }),
  });
}

/** A disposable workstation: an empty home plus the fake AWS CLI. */
export interface Workstation {
  /** `HOME` for the script under test. */
  readonly home: string;
  /** The fake CLI installed for it. */
  readonly cli: FakeAwsCli;
}

/**
 * Build a disposable workstation.
 * @returns Its home directory and fake CLI
 */
export function workstation(): Workstation {
  const root = temporaryDirectory();
  const home = path.join(root, "home");
  mkdirSync(home, { recursive: true });
  return { home, cli: installFakeAwsCli(root) };
}

/**
 * Run the bootstrap script against one workstation.
 * @param options - The workstation, the extra environment, and the working dir
 * @param options.workstation - Home directory and fake CLI to run against
 * @param options.environment - Bundle and `LISA_AWS_*` variables for this case
 * @param options.cwd - Working directory; defaults to the repository root
 * @returns The completed process
 */
export function runBootstrap(options: {
  readonly workstation: Workstation;
  readonly environment: Readonly<Record<string, string>>;
  readonly cwd?: string;
}): ReturnType<typeof boundedSpawnSync> {
  const { home, cli } = options.workstation;
  return boundedSpawnSync({
    label: "remote-agent-aws-setup.sh",
    command: "bash",
    args: [path.resolve(REMOTE_SETUP_SCRIPT_PATH)],
    cwd: options.cwd ?? path.resolve("."),
    env: scriptEnvironment({
      HOME: home,
      PATH: `${cli.binaryDirectory}:${process.env.PATH ?? ""}`,
      FAKE_AWS_LOG: cli.logPath,
      ...options.environment,
    }),
  });
}
