/**
 * A sanitized reading of a failed apt run (CodySwannGT/lisa#5204).
 *
 * The qualification keeps apt's output private and publishes only hashes, so
 * when the pinned install failed on a new runner image the artifact could not
 * say why. This reads two things back out, both public archive data and
 * nothing else: which kind of refusal apt gave, and the package names and
 * versions on apt's unmet-dependency lines. Every token is checked against the
 * Debian package-name and version grammar, so a line carrying anything else
 * (a mirror URL, a path, a credential) is dropped, never published.
 */

/** Debian package name, with an optional architecture qualifier. */
const NAME = /^[a-z0-9][a-z0-9+.-]{0,99}(?::[a-z0-9]{1,16})?$/u;
/** Debian version (epoch, upstream, revision). */
const VERSION = /^\d[A-Za-z0-9.+:~-]{0,127}$/u;
const RELATIONS = new Set([
  "Depends",
  "PreDepends",
  "Breaks",
  "Conflicts",
  "Recommends",
]);
const OPERATORS = new Set(["<<", "<=", "=", ">=", ">>", "<", ">"]);
const MAX_UNMET = 32;

/** apt's refusal messages, most specific first. */
const CLASSES = [
  [
    "held-broken-packages",
    /^E: Unable to correct problems, you have held broken packages\.$/mu,
  ],
  ["version-not-found", /^E: Version '[^']*' for '[^']*' was not found$/mu],
  ["package-not-found", /^E: Unable to locate package /mu],
  ["unmet-dependencies", /^E: Unmet dependencies\./mu],
  ["lock-held", /^E: Could not get lock /mu],
  ["fetch-failed", /^E: Failed to fetch /mu],
];

/**
 * The installed-candidate half of an unmet line: "but X is to be installed",
 * "but it is not going to be installed", "but it is not installable".
 * @param {string} rest Text after the relation target.
 * @returns {{candidate?: string, state: string}|null} The parsed outcome.
 */
function outcome(rest) {
  const installed = /^but (\S+) is (?:to be|installed)(?: installed)?$/u.exec(
    rest
  );
  if (installed)
    return VERSION.test(installed[1])
      ? { state: "other-version", candidate: installed[1] }
      : null;
  if (rest === "but it is not going to be installed")
    return { state: "not-going-to-be-installed" };
  if (rest === "but it is not installable") return { state: "not-installable" };
  if (rest === "") return { state: "unstated" };
  return null;
}

/**
 * One relation clause: "Depends: libfoo (>= 1.2) but 1.1 is to be installed".
 * @param {string} pkg Package the clause belongs to.
 * @param {string} clause Clause text without leading indentation.
 * @returns {object|null} The validated entry, or null when any token fails.
 */
function relation(pkg, clause) {
  const match =
    /^([A-Za-z]+): (\S+)(?: \((<<|<=|=|>=|>>|<|>) (\S+)\))?(?: (.*))?$/u.exec(
      clause
    );
  if (!match || !RELATIONS.has(match[1]) || !NAME.test(match[2])) return null;
  if (match[3] && (!OPERATORS.has(match[3]) || !VERSION.test(match[4])))
    return null;
  const result = outcome(match[5] ?? "");
  if (!result) return null;
  return {
    package: pkg,
    relation: match[1],
    target: match[2],
    ...(match[3] ? { constraint: `${match[3]} ${match[4]}` } : {}),
    ...result,
  };
}

/**
 * Classify a failed apt run and list its unmet dependencies.
 * @param {Buffer|string} stdout apt's standard output.
 * @param {Buffer|string} stderr apt's standard error.
 * @returns {{class: string, unmet: Array<object>, unmetTruncated: boolean}}
 *   The failure class and the validated unmet-dependency entries.
 */
export function aptDiagnosis(stdout, stderr) {
  const err = String(stderr ?? "");
  const found = CLASSES.find(([, pattern]) => pattern.test(err));
  const lines = String(stdout ?? "").split("\n");
  const start = lines.indexOf(
    "The following packages have unmet dependencies:"
  );
  // The list is the indented block right after apt's heading.
  const block = start < 0 ? [] : lines.slice(start + 1);
  const end = block.findIndex(line => !line.startsWith(" "));
  const listed = end < 0 ? block : block.slice(0, end);
  const entries = listed.reduce(
    (state, line) => {
      const head = /^ (\S+) : (.+)$/u.exec(line);
      if (head) {
        const pkg = NAME.test(head[1]) ? head[1] : null;
        const entry = pkg && relation(pkg, head[2]);
        return { pkg, found: entry ? [...state.found, entry] : state.found };
      }
      const tail = /^ {2,}(\S.*)$/u.exec(line);
      const entry = tail && state.pkg && relation(state.pkg, tail[1]);
      return entry ? { ...state, found: [...state.found, entry] } : state;
    },
    { pkg: null, found: [] }
  ).found;
  return {
    class: found ? found[0] : "other",
    unmet: entries.slice(0, MAX_UNMET),
    unmetTruncated: entries.length > MAX_UNMET,
  };
}
