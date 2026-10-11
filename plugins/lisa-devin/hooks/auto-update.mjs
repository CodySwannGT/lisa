/**
 * SessionStart: keep the project on the latest Lisa, locally (CodySwannGT/lisa#4337).
 *
 * When a session starts in a project whose installed `@codyswann/lisa` is
 * older than npm latest, this bumps it and runs the full explicit apply in the
 * session's own worktree, then commits the result as ONE separate commit. It
 * replaces a scheduled CI workflow that opened pull requests as a bot — which
 * needed a personal access token in every repository, because a pull request
 * opened with the built-in `GITHUB_TOKEN` never starts its own checks. Nothing
 * here needs a token: npm is public, and the bump, the apply and the commit
 * are local. The update then reaches the shared repository through the
 * session's own pull request.
 *
 * ## On by default
 *
 * `autoUpdate` in `.lisa.config.json` (local file over shared) defaults to on;
 * `false` opts out. `LISA_AUTO_UPDATE=0` opts one process out, and CI never
 * updates — a build must test what was committed.
 *
 * ## It never mixes into feature work
 *
 * - It only runs on a CLEAN working tree. An agent mid-task is never touched.
 * - The update is always its own commit. It is committed immediately when the
 *   branch is a feature branch and the commit can carry what the project's
 *   commit gates require (a bound work item, or no traceability configured).
 *   Otherwise — on a deploy branch, or before any work item is bound — the
 *   files stay uncommitted and a pending marker records them; binding a work
 *   item (`lisa-work-item.mjs link` / `attach-branch`) commits them first, with
 *   that item's trailer, before any feature commit exists.
 * - A worktree whose `node_modules` is a symlink into another checkout is
 *   skipped: bumping through the link would change the other checkout's install.
 *
 * In Lisa's own repository it moves the self-dependency (no template apply,
 * caret floor) and applies the #4331 loop guard so a self-bump never chases the
 * release its own merge cut.
 *
 * FAIL SOFT, ALWAYS. Any failure is reported in the context and the session
 * starts; a half-finished update is reported, never hidden.
 * @module plugins/src/base/hooks/auto-update
 */
import { execFile } from "child_process";
import {
  existsSync,
  lstatSync,
  readlinkSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  cachedNpmLatest,
  npmLatestCachePath,
  precedes,
  refreshNpmLatest,
} from "./enforcement-vintage-npm.mjs";

/** Marker the context block is wrapped in. */
const BLOCK_TAG = "lisa-auto-update";

/** The package kept current. */
export const LISA_PACKAGE = "@codyswann/lisa";

/**
 * `autoUpdate` when `.lisa.config.json` does not set it. Deliberately NOT in
 * inject-resolved-config's BUILT_IN_DEFAULTS: that block is paid for in every
 * session's context, and this hook's own block already says what it did.
 */
export const AUTO_UPDATE_DEFAULT = true;

/** The project manifest. */
const MANIFEST = "package.json";

/**
 * A lock with no readable owner older than this is reaped. Locks that name a
 * live owner are never reaped by age (see {@link lockIsAbandoned}).
 */
const STALE_LOCK_MS = 2 * 60 * 60 * 1000;

/** Lockfiles in tie-break order, with the manager that writes each. */
const LOCKFILES = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/** Subject of a release-bot commit, in either form the release workflow emits. */
const RELEASE_SUBJECT = /^chore\(release\): \S+ \[skip ci\](?: \[skip-cd\])?$/u;

/** Subject of a Lisa update commit; the self-mode loop guard keys on it. */
const UPDATE_SUBJECT = /^chore\(deps\): update Lisa to \S+$/u;

/**
 * `git status` in its machine form: NUL-delimited, unquoted paths, one record
 * per untracked FILE rather than per directory.
 */
const STATUS_Z = [
  "git",
  "status",
  "--porcelain=v1",
  "-z",
  "--untracked-files=all",
];

/**
 * Paths a NUL-delimited `git status --porcelain=v1 -z` reports. A rename or
 * copy record (flagged in either status column) is followed by an extra record
 * holding its SOURCE path; both are returned, because a path-limited commit
 * must carry the source's removal as well as the destination.
 * @param {string} output Raw command output.
 * @returns {string[]} Changed paths.
 */
export function parsePorcelainZ(output) {
  const records = output.split("\0").filter(Boolean);
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    paths.push(record.slice(3));
    // A rename or copy can be flagged in EITHER status column, and its source
    // record follows. Both paths belong to the change: staging only the
    // destination would leave the source's deletion behind.
    if (/[RC]/u.test(record.slice(0, 2)) && records[index + 1] !== undefined) {
      paths.push(records[index + 1]);
      index += 1;
    }
  }
  return paths;
}

/**
 * Subject of the commit an update makes.
 * @param {string} version Target version.
 * @returns {string} Conventional commit subject.
 */
export function updateSubject(version) {
  return `chore(deps): update Lisa to ${version}`;
}

/**
 * Parse a JSON file, or null.
 * @param {string} file Absolute path.
 * @returns {any} Parsed value, or null.
 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The project's merged Lisa config: the local file's keys over the shared one.
 * @param {string} projectDir Project root.
 * @returns {Record<string, any>} Merged config (empty when neither exists).
 */
export function readLisaConfig(projectDir) {
  return {
    ...readJson(path.join(projectDir, ".lisa.config.json")),
    ...readJson(path.join(projectDir, ".lisa.config.local.json")),
  };
}

/**
 * Whether auto-update is on: the config's `autoUpdate`, defaulting to on.
 * @param {Record<string, any>} config Merged Lisa config.
 * @param {NodeJS.ProcessEnv} env Environment.
 * @returns {{on: boolean, reason: string}} Decision and why.
 */
export function autoUpdateSetting(config, env) {
  if (env.CI) return { on: false, reason: "CI never updates Lisa" };
  if (env.LISA_AUTO_UPDATE === "0") {
    return { on: false, reason: "LISA_AUTO_UPDATE=0 is set" };
  }
  const on =
    typeof config.autoUpdate === "boolean"
      ? config.autoUpdate
      : AUTO_UPDATE_DEFAULT;
  return on
    ? { on: true, reason: "" }
    : { on: false, reason: "autoUpdate is false in .lisa.config.json" };
}

/**
 * Choose the package manager: `packageManager` first, then an `engines`
 * `please-use-<pm>` sentinel, then lockfiles minus any manager `engines`
 * forbids — the same precedence as the install-pkgs hook.
 * @param {Record<string, any>} manifest Parsed package.json.
 * @param {readonly string[]} lockfiles Lockfile names present.
 * @returns {"bun" | "npm" | "pnpm" | "yarn"} The manager.
 */
export function choosePackageManager(manifest, lockfiles) {
  const declared = /^(bun|npm|pnpm|yarn)@/u.exec(
    String(manifest?.packageManager ?? "")
  );
  if (declared) return /** @type {any} */ (declared[1]);
  const entries = Object.entries(manifest?.engines ?? {});
  const named = entries
    .map(([, value]) => /^please-use-(bun|npm|pnpm|yarn)$/u.exec(String(value)))
    .find(Boolean);
  if (named) return /** @type {any} */ (named[1]);
  const forbidden = new Set(
    entries
      .filter(([, value]) => String(value).startsWith("please-use-"))
      .map(([key]) => key)
  );
  const fromLock = LOCKFILES.find(
    ([file, manager]) => lockfiles.includes(file) && !forbidden.has(manager)
  );
  return /** @type {any} */ (fromLock ? fromLock[1] : "npm");
}

/**
 * The command that bumps Lisa.
 * @param {"bun" | "npm" | "pnpm" | "yarn"} manager Package manager.
 * @param {string} spec Version spec, e.g. `4.68.0` or `^4.68.0`.
 * @returns {string[]} argv.
 */
export function bumpCommand(manager, spec) {
  const target = `${LISA_PACKAGE}@${spec}`;
  return {
    bun: ["bun", "add", "-D", target],
    npm: ["npm", "install", "-D", target],
    pnpm: ["pnpm", "add", "-D", target],
    yarn: ["yarn", "add", "-D", target],
  }[manager];
}

/**
 * Whether the newer release differs from the pinned one only by update and
 * release commits — the self-mode loop guard (CodySwannGT/lisa#4331). Every
 * merge to Lisa's main cuts a release, so a self-bump publishes a newer version
 * than it pinned; chasing it would bump forever.
 * @param {readonly string[]} subjects Non-merge subjects between the tags.
 * @returns {boolean} True when nothing else changed.
 */
export function onlyUpdateCommits(subjects) {
  return subjects.every(
    subject => RELEASE_SUBJECT.test(subject) || UPDATE_SUBJECT.test(subject)
  );
}

/**
 * Whether the project enforces a work-item trailer on commits: it configures a
 * tracker or work-item verification. Such a commit must carry a bound item.
 * @param {Record<string, any>} config Merged Lisa config.
 * @returns {boolean} True when a commit needs a `Work-Item:` trailer.
 */
export function requiresWorkItem(config) {
  return Boolean(config.tracker || config.workItem);
}

/**
 * Branches that deploy: `deploy.branches` values, else the usual defaults.
 * @param {Record<string, any>} config Merged Lisa config.
 * @returns {Set<string>} Branch names never committed to directly.
 */
export function deployBranches(config) {
  const declared = Object.values(config.deploy?.branches ?? {}).filter(
    value => typeof value === "string" && value.trim() !== ""
  );
  return new Set(declared.length > 0 ? declared : ["main", "master"]);
}

/**
 * Decide whether the update can be committed now, and with which trailer.
 * @param {{branch: string, config: Record<string, any>, boundRef: string | null}} input Facts.
 * @returns {{commitNow: boolean, workItem: string | null, reason: string}} Decision.
 */
export function commitDecision(input) {
  if (!input.branch) {
    return { commitNow: false, workItem: null, reason: "HEAD is detached" };
  }
  if (deployBranches(input.config).has(input.branch)) {
    return {
      commitNow: false,
      workItem: null,
      reason: `${input.branch} is a deploy branch`,
    };
  }
  if (input.boundRef) {
    return { commitNow: true, workItem: input.boundRef, reason: "" };
  }
  if (requiresWorkItem(input.config)) {
    return {
      commitNow: false,
      workItem: null,
      reason:
        "no work item is bound yet and this project requires one on every commit",
    };
  }
  return { commitNow: true, workItem: null, reason: "" };
}

/**
 * The commit message for an update.
 * @param {string} from Previous version.
 * @param {string} to New version.
 * @param {string | null} workItem Trailer, if any.
 * @returns {string} Full message.
 */
export function updateMessage(from, to, workItem) {
  const trailer = workItem ? `\n\nWork-Item: ${workItem}` : "";
  return `${updateSubject(to)}\n\nApplied automatically at session start: Lisa ${from} to ${to}, including the template changes \`lisa apply\` makes for it.${trailer}\n`;
}

/**
 * Run a command and resolve with trimmed stdout; reject with its stderr.
 * @param {string[]} argv Command and arguments.
 * @param {{cwd: string, env?: NodeJS.ProcessEnv}} options Options.
 * @returns {Promise<string>} Trimmed stdout.
 */
export function runCommand(argv, options) {
  return new Promise((resolve, reject) => {
    execFile(
      argv[0],
      argv.slice(1),
      {
        cwd: options.cwd,
        env: options.env ?? process.env,
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `\`${argv.join(" ")}\` failed: ${String(stderr || error.message)
                .trim()
                .slice(-2000)}`
            )
          );
          return;
        }
        // trimEnd, never trim: `git status --porcelain` starts a record with a
        // significant space (" M path"), and trimming it corrupts the path.
        resolve(String(stdout).trimEnd());
      }
    );
  });
}

/**
 * Whether a process is alive. EPERM means it exists but is not ours to signal.
 * @param {number} pid Process id.
 * @returns {boolean} True when the process exists.
 */
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === "EPERM";
  }
}

/**
 * Whether an existing lock may be reaped: only when its owner is provably
 * gone. An update has no deadline, so age alone never proves a holder dead;
 * a lock whose owner cannot be read is protected until it is far older than
 * any update could run.
 * @param {string} lockFile Absolute lock path.
 * @param {number} nowMs Current time.
 * @returns {boolean} True when the holder is gone.
 */
export function lockIsAbandoned(lockFile, nowMs) {
  let text;
  try {
    text = readFileSync(lockFile, "utf8");
  } catch (error) {
    // Only a lock that is GONE is free. A permission or I/O error says nothing
    // about whether its owner is running, so the lock stays protected.
    return /** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT";
  }
  try {
    const owner = JSON.parse(text);
    if (Number.isInteger(owner?.pid)) return !processAlive(owner.pid);
  } catch {
    // empty or partly written: fall through to the grace period
  }
  try {
    return nowMs - statSync(lockFile).mtimeMs > STALE_LOCK_MS;
  } catch {
    return false;
  }
}

/**
 * Take the per-worktree update lock, recording this process as its owner and
 * reaping a lock only when its owner is gone.
 * @param {string} lockFile Absolute lock path.
 * @param {number} nowMs Current time.
 * @returns {boolean} Whether the lock was taken.
 */
export function takeLock(lockFile, nowMs) {
  mkdirSync(path.dirname(lockFile), { recursive: true });
  if (existsSync(lockFile) && lockIsAbandoned(lockFile, nowMs)) {
    rmSync(lockFile, { force: true });
  }
  try {
    const fd = openSync(lockFile, "wx");
    writeFileSync(fd, JSON.stringify({ pid: process.pid, at: nowMs }));
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Release the lock only if this process still owns it, so a session never
 * deletes a lock another session legitimately holds.
 * @param {string} lockFile Absolute lock path.
 */
export function releaseLock(lockFile) {
  try {
    if (JSON.parse(readFileSync(lockFile, "utf8"))?.pid === process.pid) {
      rmSync(lockFile, { force: true });
    }
  } catch {
    // already gone, or not ours to judge
  }
}

/**
 * The installed Lisa version, or null.
 * @param {string} projectDir Project root.
 * @returns {string | null} Version.
 */
function installedVersion(projectDir) {
  return (
    readJson(
      path.join(projectDir, "node_modules", "@codyswann", "lisa", MANIFEST)
    )?.version ?? null
  );
}

/**
 * npm latest from the shared cache, refreshing it first when stale or absent.
 * @param {string} projectDir Project root.
 * @param {{nowMs: number, refresh?: typeof refreshNpmLatest}} deps Clock and refresher.
 * @returns {Promise<string | null>} Latest version, or null when npm is unreachable.
 */
async function npmLatest(projectDir, deps) {
  const cachePath = npmLatestCachePath(projectDir);
  const cached = cachedNpmLatest(cachePath, deps.nowMs);
  if (cached?.fresh) return cached.version;
  // probe-direction: neutral — an unreachable registry yields no target and the
  // update is skipped and reported; nothing is gated on the value.
  const fetched = await (deps.refresh ?? refreshNpmLatest)(cachePath);
  return fetched ?? cached?.version ?? null;
}

/**
 * Everything decided before anything is changed.
 * @param {object} ctx Context.
 * @returns {Promise<{skip: string} | {from: string, to: string, selfMode: boolean, manager: string}>} Plan.
 */
async function plan(ctx) {
  const { projectDir, run } = ctx;
  const manifest = readJson(path.join(projectDir, MANIFEST));
  const selfMode = manifest?.name === LISA_PACKAGE;
  const declares =
    selfMode ||
    Boolean(
      manifest?.devDependencies?.[LISA_PACKAGE] ??
      manifest?.dependencies?.[LISA_PACKAGE]
    );
  if (!declares) return { skip: "" };
  const modules = path.join(projectDir, "node_modules");
  if (!existsSync(modules)) return { skip: "" };
  if (lstatSync(modules).isSymbolicLink()) {
    return {
      skip: "node_modules is a link to another checkout's install, so updating here would change that checkout too. Update Lisa from that checkout instead.",
    };
  }
  const from = installedVersion(projectDir);
  const to = await npmLatest(projectDir, ctx);
  if (!from) return { skip: "" };
  if (!to)
    return {
      skip: "npm could not be reached to check for a newer Lisa; nothing was changed.",
    };
  if (!precedes(from, to)) return { skip: "" };
  const dirty = await run(["git", "status", "--porcelain"], {
    cwd: projectDir,
  });
  if (dirty) {
    return {
      skip: `Lisa ${to} is available (this project has ${from}), but the working tree has uncommitted changes, so nothing was changed. It updates at the start of a session that begins on a clean tree.`,
    };
  }
  if (selfMode) {
    // probe-direction: fail-closed — an unreadable release range updates
    // nothing; it is reported, never read as "current" or as "behind".
    const current = await selfPinIsCurrent(ctx, from, to).catch(() => null);
    if (current === null) {
      return {
        skip: `Lisa ${to} is available, but the release tags needed to check it could not be read (offline?), so nothing was changed.`,
      };
    }
    if (current) return { skip: "" };
  }
  const lockfiles = LOCKFILES.map(([file]) => file).filter(file =>
    existsSync(path.join(projectDir, file))
  );
  return {
    from,
    to,
    selfMode,
    manager: choosePackageManager(manifest, lockfiles),
  };
}

/**
 * The self-mode loop guard, reading release tags (fetched if missing).
 * @param {object} ctx Context.
 * @param {string} from Pinned version.
 * @param {string} to Latest version.
 * @returns {Promise<boolean>} True when the pin is effectively current.
 */
async function selfPinIsCurrent(ctx, from, to) {
  const range = [
    "git",
    "log",
    "--no-merges",
    "--format=%s",
    `v${from}..v${to}`,
  ];
  const log = await ctx.run(range, { cwd: ctx.projectDir }).catch(async () => {
    await ctx.run(["git", "fetch", "--tags", "--quiet", "origin"], {
      cwd: ctx.projectDir,
    });
    return ctx.run(range, { cwd: ctx.projectDir });
  });
  return onlyUpdateCommits(log.split("\n").filter(Boolean));
}

/**
 * Bump, apply (hosts only), and prove the result.
 * @param {object} ctx Context.
 * @param {{from: string, to: string, selfMode: boolean, manager: string}} update The plan.
 * @returns {Promise<void>} Resolves when the update is on disk and proven.
 */
async function applyUpdate(ctx, update) {
  const { projectDir, run, env } = ctx;
  const spec = update.selfMode ? `^${update.to}` : update.to;
  await run(bumpCommand(/** @type {any} */ (update.manager), spec), {
    cwd: projectDir,
  });
  if (installedVersion(projectDir) !== update.to) {
    throw new Error(
      `the bump installed ${installedVersion(projectDir) ?? "nothing"}, not ${update.to}`
    );
  }
  if (update.selfMode) return;
  await run(
    [
      "node",
      "node_modules/@codyswann/lisa/dist/index.js",
      "--yes",
      "--skip-git-check",
      ".",
    ],
    { cwd: projectDir, env: { ...env, LISA_BOOTSTRAP: "1" } }
  );
  const receipt = readJson(
    path.join(projectDir, ".lisa", "apply-receipt.json")
  );
  if (receipt?.lisa_version !== update.to || receipt?.apply_mode !== "full") {
    throw new Error(
      `the apply did not record a full apply of ${update.to} in .lisa/apply-receipt.json`
    );
  }
}

/**
 * What each pending file holds right now, so the later commit can prove it is
 * still committing the update's bytes and not an edit made since
 * (CodySwannGT/lisa#4393).
 *
 * A path maps to `"<git mode> <identity>"`, or to null when it is absent (the
 * update deleted it). A regular file is `100644`/`100755` plus its
 * `git hash-object` blob id, so an executable-bit change alone is caught. A
 * symlink is `120000 link:<target>`: hash-object follows a link and hashes what
 * it reaches, so a link retargeted at identical bytes would otherwise read as
 * unchanged. Anything else (a directory, a submodule) is left OUT: it cannot be
 * proved, and the reader treats a missing entry as "differs", so it never
 * auto-commits on it. `lisa-work-item.mjs` recomputes these the same way.
 * @param {(argv: string[], options: object) => Promise<string>} run Runner.
 * @param {string} cwd Project directory.
 * @param {readonly string[]} files Pending paths.
 * @returns {Promise<Record<string, string | null> | null>} Digests, or null when they could not be read.
 */
export async function workingTreeDigests(run, cwd, files) {
  const digests = {};
  const present = [];
  for (const file of files) {
    let stat;
    try {
      stat = lstatSync(path.join(cwd, file));
    } catch {
      digests[file] = null;
      continue;
    }
    if (stat.isSymbolicLink()) {
      // A link that vanishes before it can be read is left out, which the
      // reader treats as "differs".
      try {
        digests[file] = `120000 link:${readlinkSync(path.join(cwd, file))}`;
      } catch {
        continue;
      }
    } else if (stat.isFile())
      present.push([file, stat.mode & 0o111 ? "100755" : "100644"]);
  }
  if (present.length > 0) {
    const ids = (
      await run(
        ["git", "hash-object", "--", ...present.map(([file]) => file)],
        {
          cwd,
        }
      )
    )
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);
    if (
      ids.length !== present.length ||
      !ids.every(id => /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(id))
    )
      return null;
    present.forEach(([file, mode], index) => {
      digests[file] = `${mode} ${ids[index]}`;
    });
  }
  return digests;
}

/**
 * Commit the update now, or leave it pending for the first work-item binding.
 * @param {object} ctx Context.
 * @param {{from: string, to: string}} update The update.
 * @returns {Promise<string>} One sentence describing where the update is.
 */
async function settle(ctx, update) {
  const { projectDir, run } = ctx;
  const changed = parsePorcelainZ(await run(STATUS_Z, { cwd: projectDir }));
  const branch = await run(["git", "branch", "--show-current"], {
    cwd: projectDir,
  });
  const gitPath = rel =>
    run(["git", "rev-parse", "--git-path", rel], { cwd: projectDir });
  const binding = readJson(
    path.resolve(projectDir, await gitPath("lisa/work-item.json"))
  );
  const decision = commitDecision({
    branch,
    config: ctx.config,
    boundRef:
      binding && (!binding.branch || binding.branch === branch)
        ? binding.ref
        : null,
  });
  if (decision.commitNow) {
    try {
      await run(["git", "add", "--", ...changed], { cwd: projectDir });
      await run(
        [
          "git",
          "commit",
          "--only",
          "-m",
          updateMessage(update.from, update.to, decision.workItem),
          "--",
          ...changed,
        ],
        { cwd: projectDir }
      );
      const sha = await run(["git", "rev-parse", "--short", "HEAD"], {
        cwd: projectDir,
      });
      return `It is committed on ${branch} as its own commit ${sha}, so it ships with this branch's pull request.`;
    } catch (error) {
      await run(["git", "reset", "--quiet"], { cwd: projectDir }).catch(
        () => ""
      );
      decision.reason = `committing it failed (${String(error.message).split("\n")[0]})`;
    }
  }
  const marker = path.resolve(
    projectDir,
    await gitPath("lisa/pending-update.json")
  );
  const digests = await workingTreeDigests(run, projectDir, changed).catch(
    () => null
  );
  mkdirSync(path.dirname(marker), { recursive: true });
  writeFileSync(
    marker,
    `${JSON.stringify({ from: update.from, to: update.to, files: changed, ...(digests ? { digests } : {}) }, null, 2)}\n`
  );
  return `It is NOT committed yet (${decision.reason}). The ${changed.length} changed file(s) are left in the working tree and recorded as a pending update; binding a work item on a feature branch (\`lisa-work-item.mjs link\` / \`attach-branch\`, which /lisa:track runs) commits them first, as their own commit. Do not fold these files into a feature commit.`;
}

/**
 * Remind about a pending update, or clear a marker whose files were committed.
 * @param {object} ctx Context.
 * @returns {Promise<string | null>} A reminder, or null when nothing is pending.
 */
async function pendingReminder(ctx) {
  const markerPath = path.resolve(
    ctx.projectDir,
    await ctx.run(
      ["git", "rev-parse", "--git-path", "lisa/pending-update.json"],
      { cwd: ctx.projectDir }
    )
  );
  const marker = readJson(markerPath);
  if (!marker) return null;
  const dirty = await ctx.run(["git", "status", "--porcelain"], {
    cwd: ctx.projectDir,
  });
  if (!dirty) {
    rmSync(markerPath, { force: true });
    return null;
  }
  return `A Lisa update to ${marker.to} was applied in an earlier session and is still uncommitted (${(marker.files ?? []).length} file(s)). Binding a work item on a feature branch commits it first, as its own commit. Do not fold these files into a feature commit.`;
}

/**
 * Run the whole session-start update.
 * @param {{projectDir: string, env?: NodeJS.ProcessEnv, nowMs?: number, run?: typeof runCommand, refresh?: typeof refreshNpmLatest}} input Inputs.
 * @returns {Promise<string>} The context sentence(s), or "" when there is nothing to say.
 */
export async function autoUpdate(input) {
  const ctx = {
    env: process.env,
    nowMs: Date.now(),
    run: runCommand,
    ...input,
  };
  ctx.config = readLisaConfig(ctx.projectDir);
  const setting = autoUpdateSetting(ctx.config, ctx.env);
  if (!setting.on) return "";
  const pending = await pendingReminder(ctx);
  if (pending) return pending;
  const update = await plan(ctx);
  if ("skip" in update) return update.skip;
  const lock = path.resolve(
    ctx.projectDir,
    await ctx.run(["git", "rev-parse", "--git-path", "lisa/auto-update.lock"], {
      cwd: ctx.projectDir,
    })
  );
  if (!takeLock(lock, ctx.nowMs)) {
    return `Lisa ${update.to} is available; another session is updating this worktree right now.`;
  }
  try {
    await applyUpdate(ctx, update);
    const where = await settle(ctx, update);
    const what = update.selfMode
      ? `Updated Lisa's own self-dependency from ${update.from} to ${update.to}.`
      : `Updated Lisa from ${update.from} to ${update.to}, including the template changes \`lisa apply\` makes for it.`;
    return `${what} ${where} Guard and skill behaviour you observe in THIS session is still the plugin copy it started with.`;
  } catch (error) {
    return `Lisa ${update.to} is available but the automatic update failed: ${String(error.message).split("\n")[0]}. The working tree may hold a partial update; review it with \`git status\` before other work, or set "autoUpdate": false to stop these attempts.`;
  } finally {
    releaseLock(lock);
  }
}

/**
 * Wrap the context in the hook envelope.
 * @param {string} text Context sentence(s).
 * @param {string} event Hook event name.
 * @returns {string} JSON envelope, or "" when there is nothing to say.
 */
export function envelope(text, event) {
  if (!text) return "";
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: `<${BLOCK_TAG}>\n${text}\n</${BLOCK_TAG}>`,
    },
  });
}

/**
 * Whether this module is the process entry point (realpaths both sides; see
 * enforcement-vintage.mjs for why).
 * @param {string} moduleUrl This module's URL.
 * @param {string | undefined} [argv1] Entry path.
 * @returns {boolean} True when run directly.
 */
function invokedDirectly(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedDirectly(import.meta.url)) {
  const index = process.argv.indexOf("--project-dir");
  const projectDir = index >= 0 ? process.argv[index + 1] : process.cwd();
  autoUpdate({ projectDir })
    .then(text => {
      const out = envelope(text, "SessionStart");
      if (out) process.stdout.write(`${out}\n`);
    })
    .catch(() => {
      // Fail soft: a session must always start.
    });
}
