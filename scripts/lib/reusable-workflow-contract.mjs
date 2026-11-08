/** Pure reusable-workflow caller/contract comparison shared by health and CLI. */

/**
 * A job-level `uses:` line, in every shape Lisa itself writes.
 *
 * `src/core/reusable-workflow-pin.ts` rewrites each caller to
 * `uses: <owner>/<repo>/.github/workflows/<file>@<sha> # v<version>`, keeping
 * any surrounding quotes. This pattern accepts that shape: an optional matching
 * `"` or `'` around the reference and an optional trailing YAML comment. It
 * used to be end-anchored right after the reference, so the pin comment made
 * every pinned caller invisible and both stale-input checks passed having
 * compared nothing (CodySwannGT/lisa#4641). A round-trip test keeps the
 * pinner's output and this reader in agreement.
 *
 * A `#` starts a YAML comment only after whitespace: `@main#note` is the ref
 * `main#note` to GitHub, so that shape is rejected here (and then reported as
 * unparsed) rather than read as ref `main`.
 *
 * Split in two so each pattern stays readable: `USES_LINE` finds the key and
 * its indentation, `USES_VALUE` reads what follows it.
 * `USES_VALUE` groups: 1 = double-quoted, 2 = single-quoted, 3 = bare value.
 */
const USES_LINE = /^(\s*)uses:[ \t]*(.*)$/;
const USES_VALUE =
  /^(?:"([^"\s]+)"|'([^'\s]+)'|([^\s"'#]+))(?:[ \t]+#.*)?[ \t]*$/;

/**
 * Any mention of a Lisa reusable workflow path. Owner and repository match
 * case-insensitively, as GitHub resolves them.
 */
const LISA_WORKFLOW_PATH = /codyswanngt\/lisa\/\.github\/workflows\//i;

/** A line that is entirely a YAML comment. */
const COMMENT_LINE = /^\s*#/;

/**
 * Parse one line as a reusable-workflow `uses:` reference.
 *
 * @param {string} line
 * @returns {{ indentation: number, reference: { file: string, ref: string, owner: string | null, repo: string | null } } | null}
 */
function parseUsesLine(line) {
  const match = USES_LINE.exec(line);
  const value = match ? USES_VALUE.exec(match[2]) : null;
  if (!match || !value) return null;
  const reference = parseReusableReference(value[1] ?? value[2] ?? value[3]);
  return reference ? { indentation: match[1].length, reference } : null;
}

/** @param {string} line @returns {number} */
function indentOf(line) {
  return line.length - line.trimStart().length;
}

/**
 * @param {readonly string[]} lines
 * @param {number} openerIndex
 * @param {number} parentIndent
 * @returns {string[]}
 */
function collectImmediateChildKeys(lines, openerIndex, parentIndent) {
  const keys = [];
  for (let index = openerIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === "") continue;
    const indentation = indentOf(line);
    if (indentation <= parentIndent) break;
    const match = /^\s*([A-Za-z0-9_-]+):/.exec(line);
    if (match && indentation === parentIndent + 2) keys.push(match[1]);
  }
  return keys;
}

/**
 * @param {string} usesValue
 * @returns {{ file: string, ref: string, owner: string | null, repo: string | null } | null}
 */
export function parseReusableReference(usesValue) {
  const value = usesValue.trim();
  const local = /^\.\/\.github\/workflows\/([\w.-]+\.ya?ml)$/.exec(value);
  if (local) {
    return { file: local[1], ref: "local", owner: null, repo: null };
  }
  const remote =
    /^([^/\s]+)\/([^/\s]+)\/\.github\/workflows\/([\w.-]+\.ya?ml)@(\S+)$/.exec(
      value
    );
  return remote
    ? {
        file: remote[3],
        ref: remote[4],
        owner: remote[1],
        repo: remote[2],
      }
    : null;
}

/**
 * @param {string} content
 * @returns {{ reusableFile: string, ref: string, owner: string | null, repo: string | null, withKeys: string[] }[]}
 */
export function extractCallerJobs(content) {
  const lines = content.split(/\r?\n/);
  const jobs = [];
  for (let index = 0; index < lines.length; index++) {
    const parsed = parseUsesLine(lines[index]);
    if (!parsed) continue;
    const { indentation, reference } = parsed;
    let withKeys = [];
    for (let child = index + 1; child < lines.length; child++) {
      const line = lines[child];
      if (line.trim() === "") continue;
      const childIndentation = indentOf(line);
      if (childIndentation < indentation) break;
      if (childIndentation === indentation && /^\s*with:\s*$/.test(line)) {
        withKeys = collectImmediateChildKeys(lines, child, indentation).sort(
          (left, right) => left.localeCompare(right)
        );
        break;
      }
    }
    jobs.push({
      reusableFile: reference.file,
      ref: reference.ref,
      owner: reference.owner,
      repo: reference.repo,
      withKeys,
    });
  }
  return jobs;
}

/**
 * Every `uses:` line naming a Lisa reusable workflow that `extractCallerJobs`
 * cannot read.
 *
 * Both stale-input checks treat "no callers parsed" as "nothing stale". A Lisa
 * caller the parser skips is therefore a check that passes having inspected
 * nothing — the failure CodySwannGT/lisa#4641 found on every pinned host. This
 * lets each check fail closed: report the line instead of dropping it.
 *
 * Any non-comment line mentioning a Lisa reusable workflow path counts, not
 * only `uses:` lines: a `uses:` value split onto the next line, or a flow
 * mapping such as `job: { uses: … }`, is still a call the parser cannot check.
 * Commented-out lines are documentation, not calls, and are never reported.
 *
 * @param {string} content
 * @returns {{ line: number, text: string }[]} 1-based line number and the
 *   trimmed line text, in file order.
 */
export function findUnparsedLisaCallerLines(content) {
  return content
    .split(/\r?\n/)
    .flatMap((line, index) =>
      !COMMENT_LINE.test(line) &&
      LISA_WORKFLOW_PATH.test(line) &&
      parseUsesLine(line) === null
        ? [{ line: index + 1, text: line.trim() }]
        : []
    );
}

/** @param {string} content @returns {string[] | null} */
export function extractDeclaredInputs(content) {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    if (!/^\s*workflow_call:\s*$/.test(lines[index])) continue;
    const indentation = indentOf(lines[index]);
    for (let child = index + 1; child < lines.length; child++) {
      const line = lines[child];
      if (line.trim() === "") continue;
      const childIndentation = indentOf(line);
      if (childIndentation <= indentation) break;
      if (
        childIndentation === indentation + 2 &&
        /^\s*inputs:\s*$/.test(line)
      ) {
        return collectImmediateChildKeys(lines, child, childIndentation).sort(
          (left, right) => left.localeCompare(right)
        );
      }
    }
    return [];
  }
  return null;
}

/**
 * @param {readonly string[]} used
 * @param {readonly string[]} declared
 * @returns {string[]}
 */
export function diffStaleKeys(used, declared) {
  const declaredSet = new Set(declared);
  return used
    .filter(key => !declaredSet.has(key))
    .sort((left, right) => left.localeCompare(right));
}
