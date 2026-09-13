import fs from "node:fs";
import path from "node:path";

/**
 * Link inline citations of bundled rules after variant paths are finalized.
 * Unknown and host-owned paths stay literal. A bare rule name prefers the
 * complete reference rule when the plugin also has an eager summary.
 *
 * Parity limit: Codex and OpenCode copy skills into separate installed trees
 * and still retain these legacy source citations. This variant-local rewrite
 * does not repair those installer paths; it covers Copilot and Cursor only.
 * @param {string} root Generated plugin directory.
 * @param {"copilot" | "cursor"} variant Target rule layout.
 * @returns {void}
 */
export function rewritePluginRuleCitations(root, variant) {
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(file);
      } else if (entry.isFile() && /\.mdc?$/.test(entry.name)) {
        const source = fs.readFileSync(file, "utf8");
        const rewritten = source.replace(
          /`\.claude\/rules\/(?:(eager|reference)\/)?([A-Za-z0-9._-]+)\.md(#[^`]+)?`/g,
          (citation, tier, name, fragment = "") => {
            const candidates = (tier ? [tier] : ["reference", "eager", ""]).map(
              candidate =>
                variant === "cursor"
                  ? `rules/${name}${candidate === "reference" ? "-reference" : ""}.mdc`
                  : `rules/${candidate ? `${candidate}/` : ""}${name}.md`
            );
            const target = candidates.find(candidate =>
              fs.existsSync(path.join(root, candidate))
            );
            if (!target) return citation;
            const relative = path
              .relative(path.dirname(file), path.join(root, target))
              .split(path.sep)
              .join("/");
            return `[\`${target}${fragment}\`](${relative}${fragment})`;
          }
        );
        if (rewritten !== source) fs.writeFileSync(file, rewritten);
      }
    }
  };
  walk(root);
}
