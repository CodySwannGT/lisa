/**
 * The `projects/` directory name Claude Code files a session's transcript
 * under, re-implemented here as an independent test oracle (lisa#4821).
 *
 * Rule read from the Claude Code 2.1.319 binary and confirmed with a real
 * `claude -p` run in a 240-character cwd: every non-alphanumeric character
 * becomes `-`; a result longer than 200 characters keeps its first 200 and
 * gains `-<base-36 of |h|>`, where `h` is the 32-bit Java string hash of the
 * raw cwd. Kept separate from `first-prompt.mjs` on purpose, so a test that
 * plants a transcript with it proves the detector finds the directory Claude
 * Code really writes, not the one the detector itself computes.
 * @module tests/unit/session-manager/support/claude-project-dir
 */

/** Longest dash-encoded name Claude Code keeps untruncated. */
export const PROJECT_DIR_LIMIT = 200;

/**
 * The 32-bit Java string hash: `h = 31 * h + charCode`, wrapping to a signed
 * 32-bit integer each step (`Math.imul(x, 1)` is ToInt32).
 * @param text - Input
 * @returns Signed 32-bit hash
 */
function javaStringHash(text: string): number {
  return text
    .split("")
    .reduce(
      (hash, char) => Math.imul(Math.imul(31, hash) + char.charCodeAt(0), 1),
      0
    );
}

/**
 * The directory name Claude Code 2.1.319 uses for a cwd.
 * @param cwd - Session cwd
 * @returns Directory name under `<config dir>/projects/`
 */
export function claudeProjectDirName(cwd: string): string {
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  if (encoded.length <= PROJECT_DIR_LIMIT) return encoded;
  const suffix = Math.abs(javaStringHash(cwd)).toString(36);
  return `${encoded.slice(0, PROJECT_DIR_LIMIT)}-${suffix}`;
}
