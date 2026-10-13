/**
 * Setup subcommands of the session-manager CLI: init-config, store-token,
 * trust-status and coexistence. Each one answers a question
 * `lisa-setup-session-manager` would otherwise put to the operator, so setup
 * asks only what a script cannot find out.
 * @module session-manager/cli-setup
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  CliError,
  EXIT,
  GLOBAL_CONFIG_FILE,
  asSetupError,
  asSetupErrorAsync,
  loadProject,
  requireConfig,
} from "./cli-runtime.mjs";
import {
  buildDefaultBlock,
  detectRepos,
  draftHints,
  resolveRepoDir,
} from "./config.mjs";
import { defaultProjectSlug } from "./isolation.mjs";
import {
  storeToken as storeTokenFile,
  storeTokenFromClipboard,
} from "./launch.mjs";
import {
  coexistence as readCoexistence,
  trustStatus as readTrust,
} from "./setup-checks.mjs";

/**
 * `init-config [--slug <slug>] [--write]`: the default block for this
 * project, written to `.lisa.config.json` only with `--write` and only when
 * no block exists. Non-secret fields only; the token never goes here. Repos
 * are the routable children `detectRepos` finds (linked worktrees and second
 * clones of one remote left out), each with drafted hints.
 * @param {object} ctx - CLI context
 * @returns {{ json: object }} `{written,block,...}`
 */
export function initConfig(ctx) {
  const { global } = loadProject(ctx.root);
  if (global?.sessionManager) {
    return {
      json: { written: false, reason: "exists", block: global.sessionManager },
    };
  }
  const slug =
    ctx.values.slug ?? defaultProjectSlug(ctx.root, global?.github?.repo);
  const detectedRepos = detectRepos(ctx.root);
  const hints = Object.fromEntries(
    detectedRepos.map(name => [
      name,
      draftHints(path.join(ctx.root, "projects", name), name),
    ])
  );
  const block = asSetupError(() =>
    buildDefaultBlock({ projectSlug: slug, detectedRepos, hints })
  );
  if (!ctx.values.write) return { json: { written: false, block } };

  const file = path.join(ctx.root, GLOBAL_CONFIG_FILE);
  if (!existsSync(file)) {
    throw new CliError(
      `${file} does not exist; set up Lisa in this project first.`,
      EXIT.SETUP
    );
  }
  const current = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(
    file,
    `${JSON.stringify({ ...current, sessionManager: block }, null, 2)}\n`
  );
  return { json: { written: true, path: file, block } };
}

/**
 * `store-token [--replace] [--from-clipboard]`: store the bot token in the
 * project's state dir. By default it prompts on the operator's terminal (echo
 * off); with no TTY it prints the two commands that work instead and exits 0
 * with `stored:false`. `--from-clipboard` reads the system clipboard and needs
 * no TTY. An existing token is kept (exit 2) unless `--replace` is given.
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object, exitCode: number }>} Outcome
 */
export async function storeToken(ctx) {
  const config = requireConfig(ctx);
  const input = {
    stateDir: config.notify?.stateDir,
    scriptsDir: ctx.scriptsDir,
    projectRoot: ctx.root,
    replace: ctx.values.replace === true,
    env: ctx.env,
    homedir: ctx.homedir,
  };
  const result = ctx.values["from-clipboard"]
    ? asSetupError(() => storeTokenFromClipboard(input))
    : await asSetupErrorAsync(() => storeTokenFile(input));
  const refused = result.stored === false && result.reason !== "no-tty";
  return { json: result, exitCode: refused ? EXIT.SETUP : EXIT.OK };
}

/**
 * Every directory a worker can start in: each routed repo, or the root on a
 * single-repo project.
 * @param {object} ctx - CLI context
 * @param {object} config - Resolved block
 * @returns {string[]} Absolute directories
 */
function workerDirs(ctx, config) {
  const keys = Object.keys(config.repos?.entries ?? {});
  if (keys.length === 0) return [ctx.root];
  return keys.map(key =>
    asSetupError(() => resolveRepoDir(config, key, ctx.root))
  );
}

/**
 * `trust-status`: whether Claude Code has recorded workspace trust for each
 * worker directory. Exit 0 either way; setup asks the operator only about the
 * rows that are not `trusted: true`.
 * @param {object} ctx - CLI context
 * @returns {{ json: object }} `{file,dirs:[{dir,trusted}],needsTrust}`
 */
export function trustStatus(ctx) {
  const config = requireConfig(ctx);
  const report = readTrust({
    dirs: workerDirs(ctx, config),
    env: ctx.env,
    homedir: ctx.homedir,
  });
  return {
    json: {
      ...report,
      needsTrust: report.dirs
        .filter(row => row.trusted !== true)
        .map(row => row.dir),
    },
  };
}

/**
 * `coexistence`: what this project's run logs say about the scheduled intake
 * loops that compete with the manager. Exit 0 either way.
 * @param {object} ctx - CLI context
 * @returns {{ json: object }} `{windowHours,loops:[...],live}`
 */
export function coexistence(ctx) {
  const config = requireConfig(ctx);
  const report = readCoexistence({
    root: ctx.root,
    now: ctx.now(),
    stall: config.stall,
  });
  return {
    json: {
      ...report,
      live: report.loops.filter(row => row.recent).map(row => row.loop),
    },
  };
}
