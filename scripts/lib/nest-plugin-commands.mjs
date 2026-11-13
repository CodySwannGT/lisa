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

/**
 * Frontmatter keys that only Claude Code honours on commands.
 *
 * `disable-model-invocation: true` keeps a command typeable by a person while
 * removing its description from Claude's context, so the model's listing is not
 * a second copy of the skills the commands pass through to. Cursor, Agy, and
 * Copilot have no documented equivalent, so their variants drop the key rather
 * than ship a field whose meaning on that agent is unknown. Parity gap: on
 * those agents the commands stay visible to the model, as they were before.
 */
const CLAUDE_ONLY_COMMAND_KEYS = ["disable-model-invocation"];

/**
 * Remove Claude-only frontmatter keys from every command file in a built
 * per-agent variant. No-op when the variant ships no commands.
 * @param {string} pluginDir Built per-agent variant directory.
 */
export function stripClaudeOnlyCommandKeys(pluginDir) {
  const commandsDir = path.join(pluginDir, "commands");
  if (!fs.existsSync(commandsDir)) return;
  const keyLine = new RegExp(
    `^(?:${CLAUDE_ONLY_COMMAND_KEYS.join("|")}):.*\\n`,
    "gm"
  );
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        const text = fs.readFileSync(full, "utf8");
        const match = text.match(/^---\n[\s\S]*?\n---/);
        if (!match) continue;
        const stripped = match[0].replace(keyLine, "");
        if (stripped !== match[0]) {
          fs.writeFileSync(full, text.replace(match[0], stripped));
        }
      }
    }
  };
  walk(commandsDir);
}
