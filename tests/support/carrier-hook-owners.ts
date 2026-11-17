/**
 * A repository that already has a commit hook of its own, for the suites
 * that prove `lisa controls install-carriers` keeps it running
 * (CodySwannGT/lisa#4989).
 *
 * The existing hook is the same in every case: it records that it ran in a
 * file outside the repository, and it fails while a second file exists. What
 * differs is who owns it, and so where it is written.
 * @module tests/support/carrier-hook-owners
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import {
  type CarrierRepository,
  carrierRepository,
  operatorEnv,
  operatorGit,
} from "./carrier-install.js";
import { NODE } from "./no-manifest-run.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Husky, as this repository has it installed. */
const HUSKY_BIN = path.resolve(HERE, "../../node_modules/husky/lib/bin.js");

/** The stand-in for a hook manager's own git hook. */
const MANAGER_STAND_IN = path.resolve(
  HERE,
  "../integration/support/hook-manager-stand-in.mjs"
);

/** F-none with a check declared, and an existing hook to keep. */
export interface OwnedRepository extends CarrierRepository {
  /** The file the existing hook appends a line to each time it runs. */
  readonly hostRan: string;
  /** While this file exists, the existing hook fails. */
  readonly failFlag: string;
  /** What the existing hook does, as one shell command. */
  readonly hostCommand: string;
}

/**
 * Build F-none with a declared check and somewhere for an existing hook to
 * record that it ran.
 * @returns The repository
 */
export function ownedRepository(): OwnedRepository {
  const built = carrierRepository();
  const outside = mkdtempSync(path.join(tmpdir(), "lisa-carrier-host-"));
  const hostRan = path.join(outside, "host-ran.txt");
  const failFlag = path.join(outside, "fail");
  return {
    ...built,
    failFlag,
    hostCommand: `echo ran >> ${hostRan} && test ! -f ${failFlag}`,
    hostRan,
    repository: {
      ...built.repository,
      cleanup: () => {
        built.repository.cleanup();
        rmSync(outside, { force: true, recursive: true });
      },
    },
  };
}

/**
 * Make the existing hook fail from now on.
 * @param owned - The repository
 */
export function failHostHook(owned: OwnedRepository): void {
  writeFileSync(owned.failFlag, "");
}

/**
 * Write a file git can start.
 * @param file - The file
 * @param content - What it holds
 */
export function writeExecutable(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  chmodSync(file, 0o755);
}

/**
 * The existing hook as a shell script.
 * @param owned - The repository
 * @param preamble - Lines between the first line and what the hook does
 * @returns The script
 */
export function hostHookScript(
  owned: OwnedRepository,
  preamble: readonly string[] = []
): string {
  return ["#!/bin/sh", ...preamble, owned.hostCommand, ""].join("\n");
}

/**
 * Where git keeps its own hooks for a repository.
 * @param root - The repository
 * @returns The folder
 */
export function gitHooksFolder(root: string): string {
  return path.resolve(
    root,
    operatorGit(root, ["rev-parse", "--git-path", "hooks"]).stdout.trim()
  );
}

/**
 * Switch Husky on in a repository, with Husky's own installer.
 * @param root - The repository
 */
export function installHusky(root: string): void {
  if (!existsSync(HUSKY_BIN)) throw new Error(`Husky is not at ${HUSKY_BIN}`);
  const installed = boundedSpawnSync({
    args: [HUSKY_BIN, "install"],
    command: NODE,
    cwd: root,
    env: operatorEnv(),
    label: "husky install in a carrier fixture",
  });
  if (installed.status !== 0) {
    throw new Error(`${installed.stdout}${installed.stderr}`);
  }
}

/**
 * Install the stand-in for a hook manager's own git hooks.
 * @param root - The repository
 * @param manager - Which manager the hooks stand in for
 */
export function installManagerStandIn(
  root: string,
  manager: "lefthook" | "pre-commit"
): void {
  for (const hook of ["pre-commit", "pre-push"]) {
    writeExecutable(
      path.join(gitHooksFolder(root), hook),
      [
        "#!/bin/sh",
        `# Stands in for the ${hook} hook that ${manager} installs.`,
        `exec "${NODE}" "${MANAGER_STAND_IN}" ${manager} ${hook} "$@"`,
        "",
      ].join("\n")
    );
  }
}
