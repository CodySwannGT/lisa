/**
 * SessionStart / SubagentStart: tell the agent WHICH COPY of Lisa is executing
 * in this session, and whether a newer one is sitting on the same disk.
 *
 * The defect this closes (CodySwannGT/lisa#3714). A session resolves its Lisa
 * copy ONCE, at session start, and executes that copy for its whole life. On
 * Claude that is `~/.claude/plugins/cache/lisa/lisa/<version>/`; in the Lisa
 * monorepo the repository hook dispatcher additionally resolves guards out of
 * the CHECKOUT. Neither is refreshed by anything that happens afterwards:
 * merging to `main`, publishing to npm, updating the marketplace, or running
 * `lisa apply` all leave a running session on the copy it started with.
 *
 * So `origin/main` contains a fix is a fact about the repository, and never a
 * fact about this session. Measured on this fleet: a lane eleven hours old was
 * executing 4.32.2 while `main` and the marketplace clone were at 4.35.1, with
 * 4.35.1 already sitting in the cache beside 310 other versions. It is not a
 * distribution failure — the newer copy had arrived and could not be reached.
 *
 * The consequence was measured twice, in OPPOSITE directions, by careful agents
 * holding real measurements:
 *
 *   - A lane read an already-fixed defect out of its stale copy, believed it
 *     live, and filed a ticket for it.
 *   - Another lane nearly shipped against a superseded contract, because the
 *     contract it read was the stale copy's.
 *
 * One cause, two opposite errors, and NEITHER was visible from inside the
 * session. That invisibility is the whole defect: the version was knowable at
 * every moment and nothing ever said it.
 *
 * Why this is context and not a refusal. The obvious remedy — refuse, or
 * restart the fleet — is not free here: sessions hold uncommitted sole-copy
 * work, so a forced restart can cost more than the staleness it cures. A
 * session that can SEE it is stale can say so, discount its own evidence, and
 * verify against `origin/main` before reporting — and that costs nothing. The
 * enforcement fallback already computes a version comparison and prints it to
 * stderr; on the exit-0 path Claude Code shows a hook's stderr to the user in
 * transcript mode only and NEVER to the agent, so the agent — the party that
 * acts on it — was the one party never told. Injected context is the channel
 * that reaches it.
 *
 * Why it always speaks, including when current. Silence would be ambiguous
 * between "this copy is current" and "the hook did not run", and an ambiguous
 * signal is the failure mode this file exists to remove. A current session gets
 * one short line; a stale one gets the delta and what to do about it.
 *
 * FAIL SOFT, ALWAYS. Every exit is 0. A session that cannot date itself must
 * still start.
 * @module plugins/src/base/hooks/enforcement-vintage
 */
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { realpathSync } from "fs";

/** Marker the block is wrapped in, so an agent can cite it by name. */
const BLOCK_TAG = "lisa-enforcement-vintage";

/**
 * The version a JSON manifest states at its TOP LEVEL.
 *
 * Parsed rather than pattern-matched, which is the one place this renderer
 * should not copy the Bash dispatcher beside it. That dispatcher runs on every
 * tool call under bash 3.2 with no JSON parser available, so it approximates
 * "top-level" by anchoring a line-oriented regex to at most three leading
 * spaces — an approximation that fails outright on a minified manifest, where
 * every key is on one line. Node has a real parser and this runs once per
 * session, so it reads the key it means: `node_modules/@codyswann/lisa/package.json`
 * carries nested `"version"` keys inside its dependency block, and only a parse
 * distinguishes those from Lisa's own in every formatting.
 *
 * The anchored regex is kept as a FALLBACK, for the one input a parse cannot
 * serve: a manifest that is malformed. A file that is broken but pretty-printed
 * still dates its copy, and a copy that cannot be dated is reported as unknown
 * rather than assumed current.
 * @param {string} file Absolute path to a JSON file.
 * @param {string} key Top-level key holding the version.
 * @returns {string} The version, or "" when the file or key is absent.
 */
export function readJsonVersion(file, key) {
  let raw = "";
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return "";
  }
  try {
    const parsed = JSON.parse(raw);
    const value = parsed?.[key];
    if (typeof value === "string" && value) return value;
    return "";
  } catch {
    const pattern = new RegExp(`^ {0,3}"${key}"\\s*:\\s*"([^"]+)"`, "m");
    const match = pattern.exec(raw);
    return match ? match[1] : "";
  }
}

/**
 * Numeric release fields of a version string, ignoring prerelease and build
 * suffixes.
 *
 * A field that is not a plain number becomes 0 rather than throwing, so a
 * version string this does not understand can never be reported as NEWER than
 * one it does. That direction is deliberate: the failure mode is silence, not
 * a fleet-wide false staleness alarm.
 * @param {string} version A dotted version string.
 * @returns {readonly number[]} Three release fields.
 */
export function releaseFields(version) {
  const core = String(version).split("-")[0].split("+")[0];
  const parts = core.split(".").slice(0, 3);
  return [0, 1, 2].map(index => {
    const field = parts[index];
    return /^\d+$/u.test(field ?? "") ? Number(field) : 0;
  });
}

/**
 * Whether the first version names an older Lisa than the second.
 * @param {string} a Candidate older version.
 * @param {string} b Candidate newer version.
 * @returns {boolean} True when `a` precedes `b`.
 */
export function isOlder(a, b) {
  const left = releaseFields(a);
  const right = releaseFields(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return false;
}

/**
 * The newest of a set of dated copies.
 *
 * A maximum over local evidence, never one nominated reference — the same
 * choice the Bash dispatcher makes, and load-bearing in both directions. In the
 * Lisa monorepo `node_modules/@codyswann/lisa` is a fixture pinned majors
 * behind the repository, so treating it as "the installed release" would report
 * every current checkout as ahead and never report a stale one. In a host
 * project it is the most meaningful reference available. A maximum needs no
 * ranking between them and cannot invent staleness: a copy is behind only when
 * something demonstrably newer sits on the same disk.
 * @param {readonly {version: string, source: string}[]} copies Dated copies.
 * @returns {{version: string, source: string} | null} The newest, or null.
 */
export function newestOf(copies) {
  return copies
    .filter(copy => copy.version)
    .reduce(
      (best, copy) =>
        best === null || isOlder(best.version, copy.version) ? copy : best,
      /** @type {{version: string, source: string} | null} */ (null)
    );
}

/**
 * Date the copy this hook is itself executing from.
 *
 * Located from the script's OWN path rather than from an environment variable,
 * and that is the point. `CLAUDE_PLUGIN_ROOT` is a claim the harness makes;
 * the directory the file was loaded out of is not a claim at all. A copy that
 * dates itself cannot be misattributed by a variable that is unset, stale, or
 * pointing somewhere else.
 * @param {string} hooksDir Directory holding this script.
 * @returns {{version: string, source: string, root: string}} The running copy.
 */
export function runningCopy(hooksDir) {
  const root = path.dirname(hooksDir);
  const manifest = path.join(root, ".claude-plugin", "plugin.json");
  return {
    version: readJsonVersion(manifest, "version"),
    source: manifest,
    root,
  };
}

/**
 * The guard tree the repository hook dispatcher would resolve, and its vintage.
 *
 * Resolution is first-wins: `scripts/lisa-hooks/` shadows `plugins/lisa/hooks/`
 * outright and the shadowed copy never runs. So the tree reported here is
 * whichever is FIRST, never whichever is newest — the distinction the whole
 * ticket turns on. The host tree is dated by the apply receipt, because the
 * same `lisa apply` run produced both and they cannot disagree; the monorepo's
 * own tree is dated by the plugin manifest beside it.
 * @param {string} projectDir Repository root.
 * @returns {{tree: string, version: string, repair: string} | null} The tree.
 */
export function repositoryTree(projectDir) {
  const hostTree = path.join(projectDir, "scripts", "lisa-hooks");
  const pluginTree = path.join(projectDir, "plugins", "lisa", "hooks");
  if (existsSync(path.join(hostTree, "block-no-verify.sh"))) {
    return {
      tree: hostTree,
      version: readJsonVersion(
        path.join(projectDir, ".lisa", "apply-receipt.json"),
        "lisa_version"
      ),
      repair: "`npx @codyswann/lisa apply` rewrites this tree",
    };
  }
  if (existsSync(path.join(pluginTree, "block-no-verify.sh"))) {
    return {
      tree: pluginTree,
      version: readJsonVersion(
        path.join(
          projectDir,
          "plugins",
          "lisa",
          ".claude-plugin",
          "plugin.json"
        ),
        "version"
      ),
      repair:
        "this tree IS the checkout's own source, so only moving the branch refreshes it",
    };
  }
  return null;
}

/**
 * Every dated Lisa this machine can be SHOWN to hold.
 * @param {string} projectDir Repository root.
 * @param {string} configDir Harness config directory.
 * @returns {readonly {version: string, source: string}[]} Dated copies.
 */
export function localCopies(projectDir, configDir) {
  const marketplace = path.join(
    configDir,
    "plugins",
    "marketplaces",
    "lisa",
    "plugins",
    "lisa",
    ".claude-plugin",
    "plugin.json"
  );
  const installed = path.join(
    projectDir,
    "node_modules",
    "@codyswann",
    "lisa",
    "package.json"
  );
  const checkout = path.join(
    projectDir,
    "plugins",
    "lisa",
    ".claude-plugin",
    "plugin.json"
  );
  return [
    { version: readJsonVersion(marketplace, "version"), source: marketplace },
    { version: readJsonVersion(installed, "version"), source: installed },
    { version: readJsonVersion(checkout, "version"), source: checkout },
  ];
}

/**
 * Everything the block needs, resolved from disk.
 * @param {{hooksDir: string, projectDir: string, configDir: string}} where Paths.
 * @returns {object} Resolved vintage state.
 */
export function resolveState(where) {
  const running = runningCopy(where.hooksDir);
  const tree = repositoryTree(where.projectDir);
  const newest = newestOf([
    ...localCopies(where.projectDir, where.configDir),
    { version: running.version, source: running.source },
    ...(tree ? [{ version: tree.version, source: tree.tree }] : []),
  ]);
  const behind = Boolean(
    newest && running.version && isOlder(running.version, newest.version)
  );
  const treeBehind = Boolean(
    tree && newest && tree.version && isOlder(tree.version, newest.version)
  );
  return { running, tree, newest, behind, treeBehind };
}

/** What a stale session must do differently, stated as actions. */
const CONSEQUENCES = [
  "A guard refusal or contract you read HERE may already be fixed or superseded on `origin/main`. Filing it as live is the error this measured twice tonight, in both directions.",
  "Verify any claim about this repository's source with `git show origin/main:<path>` — never from a working tree — and say which vintage you read when you report it. A REFUTATION needs that provenance more than a claim does: a stale `grep` returns a clean, specific, checkable-looking negative.",
  "Merge ancestry proves a fix EXISTS. It never proves the exposure is closed for a session already running. Report those two facts separately.",
  "Only starting a new session re-resolves the copy. Publishing, `lisa apply`, and updating the marketplace do not reach this one.",
];

/**
 * Render the injected block.
 * @param {object} state Resolved vintage state.
 * @returns {string} Block text.
 */
export function renderBlock(state) {
  const lines = [`<${BLOCK_TAG}>`];
  lines.push(
    "The Lisa copy executing in this session was resolved when the session started " +
      "and never changes afterwards. What `origin/main` contains is not what runs here."
  );
  lines.push("");
  lines.push(
    `session copy: ${state.running.version ? `lisa ${state.running.version}` : "vintage unknown (no manifest beside it, so it cannot be shown current)"} at ${state.running.root}`
  );
  if (state.tree) {
    lines.push(
      `repository guards: ${state.tree.version ? `lisa ${state.tree.version}` : "vintage unknown"} at ${state.tree.tree}${state.treeBehind ? ` — BEHIND; ${state.tree.repair}` : ""}`
    );
  }
  if (state.newest) {
    lines.push(
      `newest on this disk: lisa ${state.newest.version} at ${state.newest.source}`
    );
  }
  lines.push("");
  if (state.behind || !state.running.version || state.treeBehind) {
    lines.push(
      state.behind
        ? `STALE — this session executes lisa ${state.running.version} while lisa ${state.newest.version} is already on this machine. Act on that:`
        : "UNPROVEN — this session cannot be shown to be current. Treat it as stale:"
    );
    CONSEQUENCES.forEach(line => lines.push(`- ${line}`));
  } else {
    lines.push(
      "CURRENT — no newer Lisa is on this disk, so guard behaviour and skill contracts " +
        "observed here match the newest copy this machine holds. State the version anyway " +
        "when you report on guard or contract behaviour; it is only current until the next release."
    );
  }
  lines.push(`</${BLOCK_TAG}>`);
  return lines.join("\n");
}

/**
 * Read the hook event name from the harness's stdin payload.
 * @param {string} raw Raw stdin.
 * @returns {string} The event name, defaulting to `SessionStart`.
 */
export function eventName(raw) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.hook_event_name === "string"
      ? parsed.hook_event_name
      : "SessionStart";
  } catch {
    return "SessionStart";
  }
}

/**
 * Emit the hook envelope. Always exits 0 — see the module comment.
 * @param {string[]} argv Process arguments.
 * @param {string} stdin Raw stdin.
 * @param {NodeJS.ProcessEnv} [env] Environment.
 * @returns {string} The JSON envelope.
 */
export function run(argv, stdin, env = process.env) {
  const flagValue = name => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : "";
  };
  const hooksDir =
    flagValue("--hooks-dir") || path.dirname(fileURLToPath(import.meta.url));
  const projectDir = flagValue("--project-dir") || process.cwd();
  const configDir =
    flagValue("--config-dir") ||
    env.CLAUDE_CONFIG_DIR ||
    path.join(env.HOME || "", ".claude");
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName(stdin),
      additionalContext: renderBlock(
        resolveState({ hooksDir, projectDir, configDir })
      ),
    },
  });
}

/**
 * Whether this module is the process entry point.
 *
 * Both sides are realpath'd: comparing `fileURLToPath(import.meta.url)` against
 * `path.resolve(process.argv[1])` disagrees whenever the checkout is reached
 * through a symlink — a git worktree, or any `/tmp` path on macOS, `/tmp` being
 * a symlink to `/private/tmp` — because `import.meta.url` is the REAL path
 * while `argv[1]` is whatever the caller typed.
 *
 * The one implementation lives at `scripts/lib/invoked-as-script.mjs`. This
 * file cannot import it: it is materialized into every plugin payload, where
 * there is no `./lib/` to import from — the same accommodation
 * `inject-resolved-config.mjs` makes.
 * @param {string} moduleUrl The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
export function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  let stdin = "";
  try {
    stdin = readFileSync(0, "utf8");
  } catch {
    stdin = "";
  }
  try {
    process.stdout.write(`${run(process.argv.slice(2), stdin)}\n`);
  } catch {
    // Fail soft: a hook that cannot render must never wedge session start.
  }
}
