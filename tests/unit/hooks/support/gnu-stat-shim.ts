/**
 * A `stat` that answers the way GNU coreutils does, for cases that must run
 * the Linux arm of a two-spelling probe from a macOS developer box.
 *
 * Calibrated against the real thing on a Debian image rather than invented.
 * GNU reads `-f` as `--file-system`, so a BSD format string becomes a FILE
 * operand that does not exist: the command exits NON-ZERO and still prints a
 * filesystem status block for the operand that does exist. The free counts in
 * that block move whenever anything touches the disk, which on a CI runner is
 * constantly — so a caller that appends the output of a FAILING `stat` to a
 * digest is hashing the state of the machine rather than the file it named
 * (CodySwannGT/lisa#3814).
 * @module tests/unit/hooks/support/gnu-stat-shim
 */
import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Install a GNU-spelling `stat` that a test can put in front of `PATH`.
 *
 * The counter file stands in for the moving free-space figure: it makes the
 * drift between two consecutive calls certain rather than probable, so a case
 * built on it cannot pass by coincidence on a quiet box.
 * @param binDir - Directory to install into; put it first on the guard's PATH
 * @param counterFile - Where the shim records how many times `-f` was called
 */
export function installGnuStatShim(binDir: string, counterFile: string): void {
  const shim = path.join(binDir, "stat");

  writeFileSync(
    shim,
    `#!/usr/bin/env bash
set -u
counter=${JSON.stringify(counterFile)}
if [ "\${1:-}" = "-f" ]; then
  seen="$(cat "$counter" 2>/dev/null || printf '0')"
  seen=$((seen + 1))
  printf '%s\\n' "$seen" >"$counter" 2>/dev/null || true
  printf '  File: "%s"\\n' "\${3:-}"
  printf 'Blocks: Total: 479173502  Free: %s  Available: %s\\n' "$seen" "$seen"
  exit 1
fi
if [ "\${1:-}" = "-c" ] && [ "\${2:-}" = "%s" ]; then
  size="$(wc -c <"\${3:-}")"
  printf '%s\\n' "\${size//[[:space:]]/}"
  exit 0
fi
exit 1
`
  );
  chmodSync(shim, 0o755);
}

/**
 * Install a `stat` that refuses every spelling, as a container carrying none.
 * @param binDir - Directory to install into; put it first on the guard's PATH
 */
export function installAbsentStatShim(binDir: string): void {
  const shim = path.join(binDir, "stat");

  writeFileSync(shim, "#!/usr/bin/env bash\nexit 1\n");
  chmodSync(shim, 0o755);
}
