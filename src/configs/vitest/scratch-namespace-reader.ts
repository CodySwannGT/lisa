/** Bounded no-follow reads of the direct Lisa scratch namespace. */
import * as fs from "node:fs";

/** Absolute cap shared by startup inspection and destructive sweeps. */
export const MAX_SCRATCH_NAMESPACE_SCAN_ENTRIES = 120_000;

/** Maximum UTF-8 bytes accepted in one direct namespace basename. */
export const MAX_SCRATCH_NAMESPACE_NAME_BYTES = 1_024;

/**
 * Stable code-point ordering independent of host locale.
 * @param left - Left basename
 * @param right - Right basename
 * @returns Comparison result
 */
const codePointCompare = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

/**
 * Consume injected direct basenames under the shared hard bounds.
 * @param names - Direct namespace basenames
 * @returns Deterministically sorted names
 */
export function collectBoundedScratchNamespaceNames(
  names: Iterable<string>
): readonly string[] {
  const collected: string[] = [];
  for (const name of names) {
    if (
      name === "" ||
      name === "." ||
      name === ".." ||
      name.includes("/") ||
      name.includes("\\")
    ) {
      throw new Error(`Scratch namespace scan refused non-basename: ${name}`);
    }
    if (Buffer.byteLength(name, "utf8") > MAX_SCRATCH_NAMESPACE_NAME_BYTES) {
      throw new Error(
        `Scratch namespace name exceeds ${String(MAX_SCRATCH_NAMESPACE_NAME_BYTES)} bytes`
      );
    }
    if (collected.length >= MAX_SCRATCH_NAMESPACE_SCAN_ENTRIES) {
      throw new Error(
        `Scratch namespace scan exceeds ${String(MAX_SCRATCH_NAMESPACE_SCAN_ENTRIES)} entries`
      );
    }
    // eslint-disable-next-line functional/immutable-data -- bounded streaming avoids materializing an attacker-sized iterator
    collected.push(name);
  }
  // eslint-disable-next-line functional/immutable-data -- sort mutates only this private bounded copy
  return [...collected].sort(codePointCompare);
}

/**
 * Open one real namespace directory, preserving absence as an empty result.
 * @param dir - Exact namespace directory
 * @returns Open directory handle, or undefined when absent
 */
function openScratchNamespace(dir: string): fs.Dir | undefined {
  try {
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Scratch namespace is not a real directory: ${dir}`);
    }
    return fs.opendirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Stream one real directory without following any direct child.
 * @param dir - Exact namespace directory
 * @returns Bounded direct basenames, or empty when absent
 */
export function readBoundedScratchNamespace(dir: string): readonly string[] {
  const directory = openScratchNamespace(dir);
  if (directory === undefined) return [];
  try {
    return collectBoundedScratchNamespaceNames(
      (function* entries(): Generator<string> {
        while (true) {
          const entry = directory.readSync();
          if (entry === null) return;
          yield entry.name;
        }
      })()
    );
  } finally {
    directory.closeSync();
  }
}
