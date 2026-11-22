/**
 * An entry's path as the start-of-run sweep reports it (CodySwannGT/lisa#5095).
 *
 * The sweep resolves its root before it reads it, so on macOS's default
 * `TMPDIR` (`/var/folders/...`, a symlink to `/private/var/folders/...`) it
 * names entries under the real path. Sweep tests build their roots in the real
 * temp directory, so run outside `lisa-test-run` — which moves `TMPDIR` to
 * `/private/tmp` — they exercise exactly that symlinked root, the one hosts
 * sweep.
 * @module tests/helpers/canonical-entry
 */
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * The same entry under its root's canonical path. Works after the entry is
 * gone, because only its parent is resolved.
 * @param entry - The entry's path as the test created it
 * @returns The path the sweep reports for it
 */
export function canonicalEntry(entry: string): string {
  return path.join(fs.realpathSync(path.dirname(entry)), path.basename(entry));
}
