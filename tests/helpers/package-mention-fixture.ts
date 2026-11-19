/**
 * Host fixtures for the dependency-reclaim mention guard: a git repository with
 * `node_modules`, installed manifests and host files (CodySwannGT/lisa#4932).
 * @module tests/helpers/package-mention-fixture
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { resolveGit } from "../support/git-executable.js";
import { boundedExecFileSync } from "./io-latency-budget.js";

const MANIFEST = "package.json";

/**
 * Make a directory an installed git repository: the mention check searches it
 * with git and reads peers from its `node_modules`.
 * @param dir - Host directory
 */
export function gitInit(dir: string): void {
  boundedExecFileSync({
    label: "git init host fixture",
    command: resolveGit(),
    args: ["init", "-q"],
    cwd: dir,
  });
  fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
}

/**
 * Install a package's manifest into the host's `node_modules`.
 * @param dir - Host directory
 * @param name - Package name
 * @param peerDependencies - Peers the installed package declares
 */
export function installPackage(
  dir: string,
  name: string,
  peerDependencies: Readonly<Record<string, string>> = {}
): void {
  writeHostFile(
    dir,
    path.join("node_modules", name, MANIFEST),
    JSON.stringify({ name, version: "1.0.0", peerDependencies })
  );
}

/**
 * Write a host file, creating its directory.
 * @param dir - Host directory
 * @param relative - Path inside the host
 * @param contents - File contents
 */
export function writeHostFile(
  dir: string,
  relative: string,
  contents: string
): void {
  fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
  fs.writeFileSync(path.join(dir, relative), contents);
}
