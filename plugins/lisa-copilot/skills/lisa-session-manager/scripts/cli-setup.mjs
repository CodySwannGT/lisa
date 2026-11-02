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
  detectRepoLayout,
  draftHints,
  notifyProvider,
  resolveRepoDir,
} from "./config.mjs";
import { defaultProjectSlug } from "./isolation.mjs";
import {
  readTokenFromClipboard,
  readTokenFromPrompt,
  resolveStateDir,
  storeToken as storeTokenFile,
  storeTokenFromClipboard,
} from "./launch.mjs";
import {
  loadTokenSecrets,
  storeTokenInProvider,
  telegramSecretName,
} from "./token-store.mjs";
import {
  coexistence as readCoexistence,
  trustStatus as readTrust,
} from "./setup-checks.mjs";

/**
 * `init-config [--slug <slug>] [--notify none|telegram] [--write]`: the
 * default block for this project, written to `.lisa.config.json` only with
 * `--write` and only when no block exists in `.lisa.config.json` or
 * `.lisa.config.local.json` (`layer` names the file that has one). Non-secret fields only; the token
 * never goes here. Repos are the routable children `detectRepoLayout` finds
 * under `projects/`, else directly under the root (linked worktrees and second
 * clones of one remote left out), each with drafted hints. `--notify` defaults
 * to `none` (no notification channel, so no state dir); `telegram` adds the
 * per-project state dir. Anything else exits 2.
 * @param {object} ctx - CLI context
 * @returns {{ json: object }} `{written,block,...}`
 */
export function initConfig(ctx) {
  const { global, local } = loadProject(ctx.root);
  // A block in EITHER layer is existing configuration. Checking only the
  // global file let `--write` add a generated global block under a
  // local-only one; the local layer then overrode it field by field (say
  // `notify.provider` with no `stateDir`) and the merged config failed
  // validation, breaking `start` and `store-token` (CodySwannGT/lisa#4571).
  for (const [layer, config] of [
    ["global", global],
    ["local", local],
  ]) {
    if (config?.sessionManager) {
      return {
        json: {
          written: false,
          reason: "exists",
          layer,
          block: config.sessionManager,
        },
      };
    }
  }
  const slug =
    ctx.values.slug ?? defaultProjectSlug(ctx.root, global?.github?.repo);
  const { reposRoot, repos: detectedRepos } = detectRepoLayout(ctx.root);
  const hints = Object.fromEntries(
    detectedRepos.map(name => [
      name,
      draftHints(path.join(ctx.root, reposRoot, name), name),
    ])
  );
  const block = asSetupError(() =>
    buildDefaultBlock({
      projectSlug: slug,
      detectedRepos,
      hints,
      reposRoot,
      notify: ctx.values.notify ?? "none",
    })
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
 * `store-token [--replace] [--from-clipboard] [--vault-project <id>]`: store
 * the bot token. With a secrets provider configured (`secrets.provider` set
 * and not `env`) it goes into the provider as `TELEGRAM_BOT_TOKEN_<NAME>`
 * and nothing is written to disk: a plaintext `<stateDir>/.env` left by an
 * older setup is migrated (stored, read back and compared, then deleted), and
 * an already-stored token is kept (exit 0) unless `--replace` is given
 * (#4555). With no provider it is written to `<stateDir>/.env` as before,
 * and an existing file is kept (exit 2) unless `--replace`.
 *
 * Either way the token is read from the operator's terminal (echo off) or,
 * with `--from-clipboard`, from the system clipboard; with no TTY it prints
 * the two commands that work instead and exits 0 with `stored:false`. The
 * token is never printed.
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object, exitCode: number }>} Outcome
 */
export async function storeToken(ctx) {
  const config = requireConfig(ctx);
  if (notifyProvider(config) !== "telegram") {
    throw new CliError(
      `sessionManager.notify.provider is "none", so there is no bot token ` +
        `to store. To use Telegram, set notify to {"provider":"telegram",` +
        `"stateDir":"~/.claude/channels/telegram-<project>"} and run ` +
        `store-token again.`,
      EXIT.SETUP
    );
  }
  const input = {
    stateDir: config.notify?.stateDir,
    scriptsDir: ctx.scriptsDir,
    projectRoot: ctx.root,
    replace: ctx.values.replace === true,
    env: ctx.env,
    homedir: ctx.homedir,
  };
  const secrets = await asSetupErrorAsync(() =>
    loadTokenSecrets(ctx.root, ctx.env)
  );
  const result =
    secrets === null
      ? await storeInFile(ctx, input)
      : await asSetupErrorAsync(() =>
          storeInProvider(ctx, input, { ...secrets, name: config.name })
        );
  const refused = result.stored === false && result.reason !== "no-tty";
  return { json: result, exitCode: refused ? EXIT.SETUP : EXIT.OK };
}

/**
 * The no-provider path: `<stateDir>/.env`, as before #4555.
 * @param {object} ctx - CLI context
 * @param {object} input - Store input
 * @returns {Promise<object>} Outcome, with `storage:"file"` once stored
 */
async function storeInFile(ctx, input) {
  const result = ctx.values["from-clipboard"]
    ? asSetupError(() => storeTokenFromClipboard(input))
    : await asSetupErrorAsync(() => storeTokenFile(input));
  return result.stored ? { ...result, storage: "file" } : result;
}

/**
 * The provider path: see {@link storeTokenInProvider}. The token reader
 * (prompt or clipboard) runs only when there is no plaintext file to migrate
 * and no stored token to keep.
 * @param {object} ctx - CLI context
 * @param {object} input - Store input
 * @param {{ cfg: object, adapter: object, name: string }} secrets - Provider
 *   config, adapter and the manager name
 * @returns {Promise<object>} Outcome
 */
function storeInProvider(ctx, input, { cfg, adapter, name }) {
  const secret = telegramSecretName(name);
  const vaultProject = ctx.values["vault-project"];
  return storeTokenInProvider({
    cfg,
    adapter,
    name: secret,
    stateDir: resolveStateDir(input.stateDir, input),
    replace: input.replace,
    vaultProject,
    readToken: () =>
      ctx.values["from-clipboard"]
        ? readTokenFromClipboard()
        : readTokenFromPrompt({ ...input, label: secret, vaultProject }),
  });
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
