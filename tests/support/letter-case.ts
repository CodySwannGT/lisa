/**
 * Asking the file system the suites build their repositories on whether it
 * tells letter cases apart.
 *
 * The default file systems of macOS and Windows do not: `Readme` and
 * `README` are one file there. A case about that only has something to run
 * on such a file system, so it asks here first and is skipped, saying why,
 * anywhere else.
 * @module tests/support/letter-case
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Tell whether a folder made in the machine's temporary folder finds a file
 * under another spelling of its name.
 * @returns Whether the file system there ignores letter case
 */
export function temporaryFoldersIgnoreLetterCase(): boolean {
  const folder = mkdtempSync(path.join(tmpdir(), "lisa-letter-case-"));
  try {
    writeFileSync(path.join(folder, "probe"), "");
    return existsSync(path.join(folder, "PROBE"));
  } finally {
    rmSync(folder, { force: true, recursive: true });
  }
}
