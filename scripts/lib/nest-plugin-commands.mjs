/**
 * Relocate a built plugin variant's `commands/` tree under `commands/lisa/`.
 *
 * Claude Code prefixes plugin commands with the plugin name, so the Claude
 * artifact ships flat commands (`commands/implement.md` → `/lisa:implement`);
 * a nested `commands/lisa/` there double-namespaces every command
 * (`/lisa:lisa:implement`). Cursor, Agy, and Copilot surface plugin commands
 * WITHOUT a plugin-name prefix, so a flat layout would expose bare colliding
 * names like `/implement` — the collision e0856eddd originally fixed. The
 * per-agent variants therefore manufacture the namespace with a directory:
 * `commands/lisa/implement.md` → `/lisa:implement`.
 * @module scripts/lib/nest-plugin-commands
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Move every entry of `<pluginDir>/commands/` into `<pluginDir>/commands/lisa/`.
 * No-op when the variant ships no commands. Idempotent: a tree that is already
 * a lone `lisa/` directory is left untouched.
 * @param {string} pluginDir Built per-agent variant directory.
 */
export function nestCommandsUnderLisa(pluginDir) {
  const commandsDir = path.join(pluginDir, "commands");
  if (!fs.existsSync(commandsDir)) return;
  const entries = fs.readdirSync(commandsDir);
  if (entries.length === 1 && entries[0] === "lisa") return;
  const stagingDir = path.join(pluginDir, "commands.nest-staging");
  fs.renameSync(commandsDir, stagingDir);
  fs.mkdirSync(commandsDir, { recursive: true });
  fs.renameSync(stagingDir, path.join(commandsDir, "lisa"));
}
