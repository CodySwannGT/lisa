// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * changed-paths — which paths a change touches, for the gate runner
 * (CodySwannGT/lisa#4988).
 *
 * A gate may declare `parts`: one command per folder. In a repository with
 * two parts, a change to one should not run the other's check. So the runner
 * asks this module what the change touches, and leaves out a part whose
 * folder holds none of those paths.
 *
 * ## The answer that is always safe is "not known"
 *
 * A part left out by mistake is a folder nothing checked, while the report
 * says nothing was wrong. A part run by mistake costs time. So every question
 * here has two answers only: a list of paths this module is sure of, or
 * `null` — "not known" — which makes the runner run every part. Anything in
 * between is answered `null`.
 *
 * ## What "the change" is
 *
 * - **At commit**: the staged paths, read from the index git itself names
 *   for this commit (`git commit -a` and `git commit <file>` each hand the
 *   hook an index of their own). A rename counts at both its old and its new
 *   path, and a deletion counts.
 * - **At push**: for every ref being pushed, what differs between the commit
 *   the remote holds and the commit being sent. Git writes both ends of every
 *   ref on the push hook's standard input, and nothing else knows them, so
 *   the caller hands that text over (`--push-refs`). Without it the change is
 *   not known.
 * - **At any other moment**: not known. Every part runs.
 *
 * ## When the answer is "not known"
 *
 * No git, no repository at this folder, git answering for some other
 * repository, a git that fails or is killed, nothing staged, no pushed refs,
 * a ref that is new on the remote, a commit this repository does not hold,
 * and a change to `.lisa.config.json` itself — the file that says what each
 * part runs.
 * @module scripts/lib/changed-paths
 */

import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { boundedSpawnSync } from "./bounded-spawn.mjs";

/**
 * What the runner knows about the change it was started for.
 * @typedef {object} Change
 * @property {string[]|null} paths Paths the change touches, written from the
 *   repository root with `/` between folders. `null` when they are not known,
 *   which runs every part.
 * @property {string|null} note One line telling the operator what was learned
 *   and what follows from it. `null` to say nothing.
 */

/**
 * One line of what git hands a push hook: one ref, and both of its ends.
 * @typedef {object} RefUpdate
 * @property {string} localRef The local ref, or `(delete)`.
 * @property {string} localOid The commit being sent; all zeros for a deletion.
 * @property {string} remoteRef The ref on the remote.
 * @property {string} remoteOid The commit the remote holds; all zeros when
 *   the ref is new there.
 */

/**
 * Asks git one question in the repository; `null` when it did not answer.
 * @typedef {(args: string[]) => (string|null)} AskGit
 */

/** The file that declares the gates, and so what every part runs. */
export const DECLARATION_FILE = ".lisa.config.json";

/** The `--push-refs` value that means "read my standard input". */
export const PUSH_REFS_STDIN = "-";

/**
 * The variable the shipped push hook names its copy of the pushed refs in.
 *
 * That hook has exported it since CodySwannGT/lisa#3874, for readers started
 * by the gate runner. It is read here when `--push-refs` is not given, so a
 * host on a stack template gets the same answer without a change to its hook.
 */
export const PUSH_REFS_ENV = "LISA_PUSHED_REFS_FILE";

/** The most refs of one push this module will compare one by one. */
export const PUSH_REF_LIMIT = 100;

/** The most output one git answer may hold, in bytes. */
const GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

/** One ref update, as git writes it: two refs and two full object names. */
const REF_UPDATE =
  /^(?<localRef>\S+) (?<localOid>[0-9a-f]{40}|[0-9a-f]{64}) (?<remoteRef>\S+) (?<remoteOid>[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** An object name of nothing but zeros: a ref that is not there. */
const NO_OBJECT = /^0+$/u;

/**
 * How git is asked for names only, so that a name is never misread.
 *
 * `-z` ends each name with a NUL and switches off the quoting git applies to
 * a name holding a space or a non-ASCII letter. `--no-renames` reports a
 * rename as the removal of one path and the arrival of another, so both
 * folders see it. `--ignore-submodules=none` reports a nested repository that
 * moved, whatever the project configured.
 */
const NAMES_ONLY = Object.freeze([
  "--name-only",
  "-z",
  "--no-renames",
  "--ignore-submodules=none",
  "--no-ext-diff",
]);

/** What follows a list of paths, once the runner may narrow by it. */
const NARROWED =
  "A part runs only when one of them is inside its folder; a part for the " +
  "whole repository always runs.";

/**
 * A path as `touchesFolder` compares it: without regard to letter case or to
 * how an accented letter is composed.
 *
 * A filesystem may treat `API` and `api`, or the two ways of writing `é`, as
 * one folder, and git and the declaration may each have recorded a different
 * one. Compared exactly, a change in that folder would look like a change
 * somewhere else and the part would be left out. Compared this way, the only
 * possible mistake is running a part that was not touched.
 *
 * That is the safe mistake only for "does this part run". `pathsOutside`
 * asks the opposite question and must not use this: see there.
 * @param {string} path A path or a folder.
 * @returns {string} The form to compare.
 */
function fold(path) {
  return path.normalize("NFC").toUpperCase().toLowerCase();
}

/**
 * Whether one path is a folder or lies inside it, as the two are written.
 *
 * Whole path segments are compared: `api` holds `api/main.py` and not
 * `api-v2/main.py`. Nothing is folded here; a caller that wants letter case
 * ignored folds both sides first.
 * @param {string} path A path.
 * @param {string} folder A folder.
 * @returns {boolean} True when the path is the folder or is inside it.
 */
function isInside(path, folder) {
  return path === folder || path.startsWith(`${folder}/`);
}

/**
 * Whether any changed path may have changed something in a folder, under any
 * of the folder's spellings.
 *
 * A path inside the folder counts, and so does the folder's own path, which
 * is what git reports when the folder itself is a link or a nested
 * repository.
 *
 * A path the folder lies BELOW counts as well. Git names a nested repository
 * (a submodule) and a link as one path each, and says nothing about what
 * moved underneath. A part for `vendor/engine/src` where `vendor/engine` is a
 * nested repository would otherwise be left out of every change to that
 * repository: the one path git reports is not inside the part's folder. A
 * part left out by mistake is a folder nothing checked, so the doubt runs
 * the part.
 * @param {readonly string[]} paths Changed paths, written from the root.
 * @param {readonly string[]} folders Every way the folder is written from the
 *   root: as declared, and as it resolves on disk.
 * @returns {boolean} True when the change touches the folder.
 */
export function touchesFolder(paths, folders) {
  const names = folders.map(fold);
  return paths.some(path => {
    const changed = fold(path);
    return names.some(
      name => isInside(changed, name) || isInside(name, changed)
    );
  });
}

/**
 * The changed paths that are inside none of the given folders.
 *
 * This is the question `touchesFolder` does not answer, asked in the other
 * direction and strictly. That one decides whether a part RUNS, where the
 * safe mistake is to run it. This one decides whether the parts that ran
 * looked at the WHOLE change, where the safe mistake is to say they did not:
 * a caller stands its own check down on the answer. So a path counts as
 * covered only when it is a folder or lies inside one. A nested repository
 * that moved is one path, and a folder inside it is only part of it.
 *
 * For the same reason the two are compared exactly as they are written.
 * Where a filesystem tells `API` from `api`, they are two folders, and a
 * change in `API` is in no part declared for `api`. Ignoring letter case, or
 * how an accented letter is composed, would call that change covered and
 * stand a secret scan or a lint down for a folder nothing looked at. Where
 * the filesystem does treat them as one folder and git recorded the other
 * spelling, the exact comparison only keeps a built-in check that could have
 * stood down.
 * @param {readonly string[]} paths Changed paths, written from the root.
 * @param {readonly string[]} folders Folders, written from the root, under
 *   every spelling each one has.
 * @returns {string[]} The paths no folder holds, in the order given.
 */
export function pathsOutside(paths, folders) {
  return paths.filter(path => !folders.some(name => isInside(path, name)));
}

/**
 * The answer that runs every part, with the reason an operator is given.
 * @param {string} moment The moment being run.
 * @param {string} why The reason, finishing "Every part runs at <moment>:".
 * @returns {Change} The change, not known.
 */
function everyPart(moment, why) {
  return { paths: null, note: `Every part runs at ${moment}: ${why}.` };
}

/**
 * A list of paths as the answer, unless the list itself says to run every
 * part.
 *
 * An empty list never narrows. Outside a real commit nothing is staged, and a
 * runner started by hand to check the repository must not report every folder
 * as untouched. A change to the declaration never narrows either: that file
 * says what each part runs, so a change to it may change every part.
 * @param {string} moment The moment being run.
 * @param {string[]} paths The paths the change touches.
 * @param {{empty: string, counted: (count: number) => string}} words How to
 *   say that the list is empty, and how to say how long it is.
 * @returns {Change} The change.
 */
function narrowedTo(moment, paths, words) {
  if (paths.length === 0) return everyPart(moment, words.empty);
  if (touchesFolder(paths, [DECLARATION_FILE])) {
    return everyPart(
      moment,
      `the change edits ${DECLARATION_FILE}, which says what each part runs`
    );
  }
  return { paths, note: `${words.counted(paths.length)} ${NARROWED}` };
}

/**
 * The names in one `-z` answer from git.
 * @param {string} listed What git printed.
 * @returns {string[]} The names, in git's order.
 */
function namesIn(listed) {
  return listed.split("\0").filter(name => name !== "");
}

/**
 * How git is asked a question in one repository.
 *
 * The environment is handed through as it is, on purpose: a commit hook is
 * told which index holds the commit being made through `GIT_INDEX_FILE`, and
 * a question asked without it would be answered about a different commit.
 * `GIT_NO_LAZY_FETCH` keeps a comparison from reaching the network in a
 * repository that fetches objects on demand; a commit that is not here is
 * then simply not known.
 * @param {string} root The repository root.
 * @param {Record<string, string|undefined>} env The environment git gets.
 * @returns {AskGit} The function that asks.
 */
function gitIn(root, env) {
  return args => {
    try {
      const child = boundedSpawnSync("git", args, {
        cwd: root,
        encoding: "utf8",
        env: { ...env, GIT_NO_LAZY_FETCH: "1" },
        maxBuffer: GIT_OUTPUT_BYTES,
        stdio: ["ignore", "pipe", "ignore"],
      });
      // probe-direction: fail-closed — a git that did not answer leaves the
      // change not known, and a change that is not known runs every part.
      if (child.error || child.status !== 0) return null;
      return String(child.stdout ?? "");
    } catch {
      // probe-direction: fail-closed — a git killed at its deadline is the
      // same: nothing is known, so no part is left out.
      return null;
    }
  };
}

/**
 * The folder holding this repository's own git data, as `.git` names it.
 *
 * `.git` is a folder in an ordinary checkout, and in a linked worktree a file
 * naming where the data lives.
 * @param {string} root The repository root.
 * @returns {string|null} The resolved folder, or null when `root` is not the
 *   top of a repository.
 */
function ownGitFolder(root) {
  const dotGit = join(root, ".git");
  try {
    if (statSync(dotGit).isDirectory()) return realpathSync(dotGit);
    const named = /^gitdir: (?<folder>.+)$/mu.exec(
      readFileSync(dotGit, "utf8")
    );
    const folder = named?.groups?.folder.trim();
    return folder ? realpathSync(resolve(root, folder)) : null;
  } catch {
    // probe-direction: fail-closed — a `.git` that cannot be read leaves the
    // change not known, and a change that is not known runs every part.
    return null;
  }
}

/**
 * Whether a path, once resolved, is one particular folder.
 * @param {string} path The path to resolve.
 * @param {string} folder A folder that is already resolved.
 * @returns {boolean} True when they are the same folder.
 */
function isFolder(path, folder) {
  try {
    return realpathSync(path) === folder;
  } catch {
    return false;
  }
}

/** Said when git would answer about some other repository than this folder's. */
const OTHER_REPOSITORY =
  "git is set up to answer for a different repository than the one in this folder";

/**
 * Why git's answers cannot be trusted to be about this folder, or null.
 *
 * Git reads which repository and which index to use from the environment as
 * well as from the folder it is started in. A runner that inherited another
 * repository's `GIT_DIR` or `GIT_INDEX_FILE` — from a hook of that repository,
 * or because it was started in a folder below the top — would be told about
 * the wrong change, and paths from the wrong change match no folder here.
 * That would leave every part out. So three things must hold before any list
 * is believed: this folder is the top of a repository, git names that same
 * repository, and the index git was handed lives inside it.
 * @param {string} root The repository root.
 * @param {AskGit} git How git is asked.
 * @param {Record<string, string|undefined>} env The environment git gets.
 * @returns {string|null} The reason, or null when git answers for this folder.
 */
function gitProblem(root, git, env) {
  const own = ownGitFolder(root);
  if (own === null) return "this folder is not the top of a git repository";
  const said = git([
    "rev-parse",
    "--is-inside-work-tree",
    "--show-prefix",
    "--absolute-git-dir",
  ]);
  if (said === null) return "git could not be asked about this repository";
  const [inside, prefix, gitFolder] = said.split("\n");
  if (inside !== "true" || prefix !== "" || !isFolder(gitFolder ?? "", own)) {
    return OTHER_REPOSITORY;
  }
  const index = env.GIT_INDEX_FILE;
  if (index && !isFolder(dirname(resolve(root, index)), own)) {
    return OTHER_REPOSITORY;
  }
  return null;
}

/**
 * What a commit changes: the staged paths.
 * @param {string} root The repository root.
 * @param {AskGit} git How git is asked.
 * @param {Record<string, string|undefined>} env The environment git gets.
 * @returns {Change} The change.
 */
function stagedChange(root, git, env) {
  const moment = "commit";
  const problem = gitProblem(root, git, env);
  if (problem !== null) return everyPart(moment, problem);
  const listed = git(["diff", "--cached", ...NAMES_ONLY, "--"]);
  if (listed === null) {
    return everyPart(moment, "git could not be asked what is staged");
  }
  return narrowedTo(moment, namesIn(listed), {
    empty: "nothing is staged, so there is no change to narrow the parts by",
    counted: count => `This commit changes ${count} path(s).`,
  });
}

/**
 * Read the lines git hands a push hook on standard input.
 *
 * Each line is `<local ref> <local object> <remote ref> <remote object>`,
 * with full object names. Anything else is refused whole rather than read in
 * part: these values are handed on to git, and a list read loosely would be a
 * list of something other than what is being pushed.
 * @param {string} text The text git wrote.
 * @returns {RefUpdate[]|null} One entry per line, or null when any line is
 *   not one git writes.
 */
export function parsePushRefs(text) {
  const lines = text.split("\n").filter(line => line !== "");
  const updates = lines.map(line => REF_UPDATE.exec(line)?.groups ?? null);
  if (updates.includes(null)) return null;
  return updates.map(update => ({
    localRef: update.localRef,
    localOid: update.localOid,
    remoteRef: update.remoteRef,
    remoteOid: update.remoteOid,
  }));
}

/**
 * Read the pushed refs from where the caller said they are.
 * @param {string} source A file, or `-` for this process's standard input.
 * @returns {string|null} The text, or null when it could not be read.
 */
export function readPushRefs(source) {
  try {
    return readFileSync(source === PUSH_REFS_STDIN ? 0 : source, "utf8");
  } catch {
    return null;
  }
}

/**
 * The paths one ref update changes, or why they are not known.
 *
 * The two commits are compared as they are, whichever is newer, so a push
 * that rewrites a branch is read the same way as one that adds to it: what
 * the remote holds now against what it will hold.
 * @param {RefUpdate} update One line of the pushed refs.
 * @param {AskGit} git How git is asked.
 * @returns {{paths: string[]}|{why: string}} The paths, or the reason.
 */
function refChange(update, git) {
  // A deletion sends no commit, so it changes no file.
  if (NO_OBJECT.test(update.localOid)) return { paths: [] };
  const ref = JSON.stringify(update.remoteRef);
  if (NO_OBJECT.test(update.remoteOid)) {
    return {
      why: `${ref} is new on the remote, so there is nothing to compare it with`,
    };
  }
  const listed = git([
    "diff",
    ...NAMES_ONLY,
    update.remoteOid,
    update.localOid,
    "--",
  ]);
  return listed === null
    ? { why: `git could not compare ${ref} with what the remote holds` }
    : { paths: namesIn(listed) };
}

/**
 * What a push changes: every path that differs on any ref being pushed.
 * @param {object} options Inputs.
 * @param {string} options.root The repository root.
 * @param {AskGit} options.git How git is asked.
 * @param {Record<string, string|undefined>} options.env The environment.
 * @param {string|null} options.source Where the pushed refs are, if anywhere.
 * @param {(source: string) => (string|null)} options.read Reads them.
 * @returns {Change} The change.
 */
function pushedChange({ root, git, env, source, read }) {
  const moment = "push";
  if (source === null) {
    return everyPart(
      moment,
      "the caller did not say what is being pushed (--push-refs)"
    );
  }
  const text = read(source);
  if (text === null) {
    return everyPart(moment, "the list of pushed refs could not be read");
  }
  const updates = parsePushRefs(text);
  if (updates === null) {
    return everyPart(
      moment,
      "the list of pushed refs is not written the way git writes it"
    );
  }
  if (updates.length === 0) {
    return everyPart(moment, "the list of pushed refs is empty");
  }
  if (updates.length > PUSH_REF_LIMIT) {
    return everyPart(
      moment,
      `${updates.length} refs are being pushed, which is more than are compared one by one`
    );
  }
  const problem = gitProblem(root, git, env);
  if (problem !== null) return everyPart(moment, problem);
  const changes = updates.map(update => refChange(update, git));
  const unknown = changes.find(change => "why" in change);
  if (unknown !== undefined) return everyPart(moment, unknown.why);
  const paths = [...new Set(changes.flatMap(change => change.paths))];
  return narrowedTo(moment, paths, {
    empty: "the push changes no path",
    counted: count => `This push changes ${count} path(s).`,
  });
}

/**
 * The remote default branch's common ancestor with a commit, for a first push
 * or a manual run with no push-hook input.
 * @param {string} head The commit being sent.
 * @param {AskGit} git How git is asked.
 * @returns {string|null|undefined} Comparison commit, no tracked baseline, or unknown ancestry.
 */
function defaultBranchBase(head, git) {
  const defaultRef =
    git(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"])?.trim() ||
    "refs/remotes/origin/main";
  if (git(["rev-parse", "--verify", defaultRef]) === null) return null;
  return git(["merge-base", defaultRef, head])?.trim() || undefined;
}

/**
 * Compare a standalone hook's change with its previous gate declaration.
 * @param {object} options Inputs.
 * @param {string} options.moment The moment being run.
 * @param {string} options.root The repository root.
 * @param {(text: string|null) => boolean} options.declares Checks for gate declarations.
 * @param {string|null} [options.pushRefs] The source of the actual pushed refs.
 * @param {Record<string, string|undefined>} [options.env] The environment.
 * @param {(source: string) => (string|null)} [options.read] Reads the refs.
 * @returns {string|null} Why the change must be blocked, or null.
 */
export function declarationProblemAt({
  moment,
  root,
  declares,
  pushRefs = null,
  env = process.env,
  read = readPushRefs,
}) {
  if (moment !== "commit" && moment !== "push") return null;
  const source = moment === "push" ? pushRefs || env[PUSH_REFS_ENV] : null;
  const unreadable = detail =>
    `Could not check whether this change removes the declared checks. ${detail}`;
  const comparisonFailed = label =>
    unreadable(
      `Git could not compare ${label}. Fetch the comparison commit or repair the local checkout, then try again.`
    );
  const git = gitIn(root, env);
  const problem = gitProblem(root, git, env);
  if (problem !== null) return source ? unreadable(problem) : null;

  /** @type {(args: string[], base: string, head: string, label: string) => string|null} */
  const compare = (args, base, head, label) => {
    const changed = git([
      "diff",
      ...args,
      ...NAMES_ONLY,
      "--",
      DECLARATION_FILE,
    ]);
    if (changed === null) return comparisonFailed(label);
    if (changed === "") return null;
    const previous = declarationAt(base, git);
    const current = declarationAt(head, git);
    if (previous === undefined || current === undefined)
      return comparisonFailed(label);
    return declares(previous) && !declares(current)
      ? "This change removes the declared checks, so they cannot check it. " +
          "Restore them and use the project's human approval process for changes to its quality gates."
      : null;
  };
  if (moment === "commit") {
    if (git(["rev-parse", "--verify", "HEAD"]) === null) return null;
    return compare(["--cached"], "HEAD", "", "the staged changes with HEAD");
  }
  if (!source) {
    const upstream = git(["rev-parse", "--verify", "@{upstream}"])?.trim();
    const base = upstream || defaultBranchBase("HEAD", git);
    const label = "HEAD with its baseline";
    if (base === undefined) return comparisonFailed(label);
    return base ? compare([base, "HEAD"], base, "HEAD", label) : null;
  }
  const text = read(source);
  if (text === null) {
    return unreadable(
      "The list of pushed refs could not be read. Retry the push with Git's ref list available."
    );
  }
  const updates = parsePushRefs(text);
  if (updates === null) {
    return unreadable(
      "The list of pushed refs is malformed. Retry the push with Git's original ref list."
    );
  }
  for (const { localOid, remoteOid, remoteRef } of updates) {
    if (!remoteRef.startsWith("refs/heads/") || NO_OBJECT.test(localOid))
      continue;
    const base = NO_OBJECT.test(remoteOid)
      ? defaultBranchBase(localOid, git)
      : remoteOid;
    const label = `${JSON.stringify(remoteRef)} with its baseline`;
    if (base === undefined) return comparisonFailed(label);
    if (!base) continue;
    const problem = compare([base, localOid], base, localOid, label);
    if (problem !== null) return problem;
  }
  return null;
}

/**
 * Read the declaration, distinguishing a missing path from an unreadable Git object.
 * @param {string} ref The commit, or an empty string for the index.
 * @param {AskGit} git How git is asked.
 * @returns {string|null|undefined} Contents, absent file, or unknown contents.
 */
function declarationAt(ref, git) {
  const listing = ref
    ? git(["ls-tree", ref, "--", DECLARATION_FILE])
    : git(["ls-files", "--stage", "--", DECLARATION_FILE]);
  if (listing === null) return undefined;
  const entry = listing
    .trimEnd()
    .split("\n")
    .find(
      line =>
        line.endsWith(`\t${DECLARATION_FILE}`) && !line.startsWith("040000 ")
    );
  if (!entry) return null;
  if (!/^100(?:644|755) /u.test(entry)) return undefined;
  return git(["show", `${ref}:${DECLARATION_FILE}`]) ?? undefined;
}

/**
 * What the change at one moment touches.
 * @param {object} options Inputs.
 * @param {string} options.moment The moment being run.
 * @param {string} options.root The repository root, which is where the
 *   runner is started.
 * @param {string|null} [options.pushRefs] The `--push-refs` value: a file
 *   holding what git handed the push hook, or `-` for standard input. Read
 *   only at push.
 * @param {Record<string, string|undefined>} [options.env] The environment,
 *   handed to git unchanged.
 * @param {AskGit} [options.git] How git is asked. Injectable so a test can
 *   state that git did not answer.
 * @param {(source: string) => (string|null)} [options.read] Reads the pushed
 *   refs. Injectable so a test can stand in for standard input.
 * @returns {Change} The paths, or `paths: null` when they are not known.
 */
export function changeAt({
  moment,
  root,
  pushRefs = null,
  env = process.env,
  git = gitIn(root, env),
  read = readPushRefs,
}) {
  if (moment === "commit") return stagedChange(root, git, env);
  if (moment === "push") {
    const source = pushRefs || env[PUSH_REFS_ENV] || null;
    return pushedChange({ root, git, env, source, read });
  }
  // Every other moment runs every part, and has nothing to explain: at a
  // pull request, a deploy or a scheduled run the runner does not narrow.
  return { paths: null, note: null };
}
