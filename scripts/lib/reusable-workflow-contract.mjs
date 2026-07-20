/** Pure reusable-workflow caller/contract comparison shared by health and CLI. */

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
    const usesMatch = /^(\s*)uses:\s*(\S+)\s*$/.exec(lines[index]);
    if (!usesMatch) continue;
    const reference = parseReusableReference(usesMatch[2]);
    if (!reference) continue;
    const indentation = usesMatch[1].length;
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
