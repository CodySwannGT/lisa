/**
 * Per-suite backstop that makes a leaked fixture fail the suite that leaked it.
 *
 * The worker-wide run root is still removed wholesale on exit and reclaimed by
 * a successor after SIGKILL. This hook is the attribution layer: it snapshots
 * the run-root children before collection, runs last after every user
 * `afterAll`, removes anything added by the suite, and fails on additions whose
 * prefix was not registered before collection.
 * @module configs/vitest/scratch-leak-setup
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterAll } from "vitest";

import {
  readBoundedScratchNames,
  removeAuthorizedScratchChildren,
} from "./scratch-authority.js";
import { SCRATCH_OWNER_FILE, readScratchOwnerRecord } from "./scratch-owner.js";

/** Run root whose children this suite owns. */
const runRoot = tmpdir();

/** Fail immediately if the setup order did not install scratch first. */
if (!path.basename(runRoot).startsWith("worker-")) {
  throw new Error(
    `Scratch leak guard started before scratch redirection: ${runRoot}`
  );
}

/** Owner record binds the prefix registry and path identity to this root. */
const owner = readScratchOwnerRecord(runRoot);

/** Direct children present before this suite imports any test module. */
const baseline = new Set([
  ...readBoundedScratchNames(runRoot),
  SCRATCH_OWNER_FILE,
]);

/**
 * Render the prefix a mkdtemp-shaped basename came from.
 * @param name - Direct scratch child basename
 * @returns Display prefix
 */
function displayedPrefix(name: string): string {
  return /^[\s\S]*[A-Za-z0-9]{6}$/u.test(name) ? `${name.slice(0, -6)}*` : name;
}

/**
 * Remove every classified addition through one inode-bound cleanup process.
 * @param names - Direct scratch child basenames
 */
function removeInternalChildren(names: readonly string[]): void {
  for (const name of names) {
    if (path.basename(name) !== name || name === "." || name === "..") {
      throw new Error(`Scratch leak guard refused non-basename child: ${name}`);
    }
  }
  const before = fs.lstatSync(runRoot);
  if (
    before.dev !== owner.root.dev ||
    before.ino !== owner.root.ino ||
    fs.realpathSync(runRoot) !== owner.root.canonicalPath
  ) {
    throw new Error("Scratch run-root identity changed before leak cleanup");
  }
  const marker = readScratchOwnerRecord(runRoot);
  if (marker.token !== owner.token) {
    throw new Error("Scratch owner marker changed before leak cleanup");
  }
  removeAuthorizedScratchChildren({
    parent: owner.root,
    basenames: names,
  });
  if (readScratchOwnerRecord(runRoot).token !== owner.token) {
    throw new Error("Scratch owner marker changed during leak cleanup");
  }
}

/**
 * Read the run root or throw a suite-attributed diagnostic.
 * @returns Current direct-child basenames
 */
function readRunRootNames(): readonly string[] {
  try {
    return readBoundedScratchNames(runRoot);
  } catch (error) {
    throw new Error(
      `Scratch leak guard could not read suite root ${runRoot}: ${String(error)}`
    );
  }
}

/**
 * Whether one addition belongs to a prefix registered before collection.
 * @param name - Added direct-child basename
 * @returns Whether the stack registered ownership
 */
function isRegisteredAddition(name: string): boolean {
  return owner.registeredPrefixes.some(prefix => name.startsWith(prefix));
}

/**
 * Audit direct additions after user hooks, clean every one, and fail on any
 * prefix the stack did not register before collection.
 */
afterAll(() => {
  const names = readRunRootNames();
  const additions = names.filter(name => !baseline.has(name));
  const unregistered = additions.filter(name => !isRegisteredAddition(name));
  try {
    removeInternalChildren(additions);
  } catch (error) {
    throw new Error(
      `Scratch leak guard could not clean ${additions.join(", ")} for suite ${owner.suiteLabel}: ${String(error)}`
    );
  }
  if (unregistered.length > 0) {
    const details = [...unregistered]
      .sort((left, right) => left.localeCompare(right))
      .map(name => `${name} (${displayedPrefix(name)})`)
      .join(", ");
    throw new Error(
      `Suite ${owner.suiteLabel} leaked ${String(unregistered.length)} unregistered scratch fixture(s): ${details}`
    );
  }
});
