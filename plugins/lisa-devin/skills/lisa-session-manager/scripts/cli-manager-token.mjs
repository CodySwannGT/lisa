/**
 * The Telegram-token half of the session-manager `start` subcommand (#4555),
 * split out of cli-manager.mjs to keep it under the line budget: where the
 * bot token comes from ({@link telegramToken}), and the tmux launch that
 * hands a provider-held token to the manager's session on stdin, never in
 * argv ({@link launchWithToken}). The token value never reaches a return
 * value that is printed, an error message or a log line.
 * @module session-manager/cli-manager-token
 */
import path from "node:path";

import {
  CliError,
  EXIT,
  asSetupError,
  asSetupErrorAsync,
  run,
} from "./cli-runtime.mjs";
import { buildSourcedLaunch, buildStoreTokenCommand } from "./launch.mjs";
import {
  loadTokenSecrets,
  resolveTelegramToken,
  telegramSecretName,
} from "./token-store.mjs";
import { shellQuote } from "./token.mjs";

/**
 * Where `start` gets the Telegram bot token (#4555). With a secrets provider
 * it is resolved once from the provider (exit 2 for a leftover plaintext
 * file, naming the `store-token` command that migrates it; exit 1 when the
 * provider cannot answer). With none, the plugin reads `<stateDir>/.env`.
 * The value is kept off the returned JSON; `shellVars` is the foreground
 * line's way to resolve it in the operator's own shell instead.
 * @param {object} ctx - CLI context
 * @param {string} managerName - `sessionManager.name`
 * @param {string} stateDir - Resolved state dir
 * @returns {Promise<{ source: "file" } | { source: "provider",
 *   secret: string, value: string, shellVars: Record<string, string> }>}
 *   Token source
 */
export async function telegramToken(ctx, managerName, stateDir) {
  const secrets = await asSetupErrorAsync(() =>
    loadTokenSecrets(ctx.root, ctx.env)
  );
  if (secrets === null) return { source: "file" };
  const secret = telegramSecretName(managerName);
  const value = await asSetupErrorAsync(() =>
    resolveTelegramToken({
      ...secrets,
      name: secret,
      stateDir,
      fixCommand: buildStoreTokenCommand({
        scriptsDir: ctx.scriptsDir,
        projectRoot: ctx.root,
      }),
    })
  );
  const resolver = path.resolve(
    ctx.scriptsDir,
    "../../lisa-secrets-access/scripts/resolve-secret.mjs"
  );
  return {
    source: "provider",
    secret,
    value,
    shellVars: {
      TELEGRAM_BOT_TOKEN: `$(node ${shellQuote(resolver)} get ${secret})`,
    },
  };
}

/**
 * Start the manager's tmux session with the bot token on tmux's stdin
 * (`start-server ; source-file -`), never in argv. tmux's own stderr is never
 * passed through: a parse error can quote the line, which holds the token.
 * @param {{ ctx: object, argv: string[], env: object,
 *   token: { value: string }, foreground: () => string }} input - Context,
 *   the launch argv, the scrubbed env, the token and the foreground line
 */
export function launchWithToken({ ctx, argv, env, token, foreground }) {
  const sourced = asSetupError(() =>
    buildSourcedLaunch(argv, { TELEGRAM_BOT_TOKEN: token.value })
  );
  const result = run("tmux", sourced.argv, {
    env,
    cwd: ctx.root,
    input: sourced.input,
  });
  if (result.missing) throw new CliError("tmux is not on PATH.", EXIT.SETUP);
  if (result.status !== 0) {
    throw new CliError(
      `tmux could not start the manager's session (exit ` +
        `${String(result.status)}). tmux's own error is not shown, because ` +
        `the command it read carries the bot token. Run the launch in the ` +
        `foreground to see the error:\n  ${foreground()}`,
      EXIT.FAILURE
    );
  }
}
