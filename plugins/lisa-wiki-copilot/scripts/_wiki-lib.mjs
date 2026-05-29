/**
 * _wiki-lib.mjs — shared, dependency-free helpers for the lisa-wiki validators
 * (lint-wiki, diff-guard, rewrite-refs, verify-migration). Node built-ins only,
 * so the scripts stay portable to any downstream repo that installs the plugin.
 */
import fs from "node:fs";
import path from "node:path";

/** Read and parse a JSON file, or return undefined if missing/invalid. */
export function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** Resolve the plugin root from a script in scripts/ (parent of scripts/). */
export function pluginRootFrom(scriptDir) {
  return path.dirname(scriptDir);
}

/** Load the project config (wiki/lisa-wiki.config.json by default). */
export function loadConfig(configPath) {
  const resolved = path.resolve(configPath ?? "wiki/lisa-wiki.config.json");
  const config = readJsonSafe(resolved);
  return { config, configPath: resolved };
}

/** Load the canonical structure manifest shipped with the plugin. */
export function loadStructure(pluginRoot) {
  return readJsonSafe(
    path.join(pluginRoot, "schema", "wiki-structure.schema.json")
  );
}

/** Recursively list files under dir matching an optional extension filter. */
export function walkFiles(dir, { ext } = {}) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        stack.push(full);
      } else if (entry.isFile()) {
        if (!ext || full.endsWith(ext)) out.push(full);
      }
    }
  }
  return out.sort();
}

/**
 * Minimal frontmatter detector. Returns whether a leading `--- ... ---` block
 * exists and the top-level keys it declares (enough to check required fields;
 * NOT a full YAML parser).
 */
export function parseFrontmatter(text) {
  const lines = text.split("\n");
  if (lines[0].trim() !== "---") return { has: false, keys: [], body: text };
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return { has: false, keys: [], body: text };
  const keys = [];
  for (let i = 1; i < closeIdx; i += 1) {
    const m = lines[i].match(/^([A-Za-z][\w-]*):/);
    if (m) keys.push(m[1]);
  }
  const body = lines.slice(closeIdx + 1).join("\n");
  return { has: true, keys, body };
}

/**
 * Extract internal markdown link targets ([txt](target)) — excludes external
 * (http/https/mailto), anchors, and template tokens. Anchors are stripped.
 */
export function extractMarkdownLinks(text) {
  const targets = [];
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let target = m[1].trim();
    if (!target || target.startsWith("#")) continue;
    if (target.includes("{{") || target.includes("<") || target.includes(">"))
      continue; // template token / placeholder / angle-bracket autolink
    target = target.split(/\s+/)[0]; // drop optional link title: (url "title")
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target) || target.startsWith("mailto:"))
      continue;
    target = target.split("#")[0].trim();
    if (target) targets.push(target);
  }
  return targets;
}

/** Extract plain-text `Source: <path>.md` citations that look like wiki paths. */
export function extractCitations(text) {
  const cites = [];
  const re = /Source:\s*([^\s)]+\.md)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const c = m[1];
    if (c.includes("{{") || c.includes("<") || c.includes(">")) continue; // template token / placeholder example
    cites.push(c);
  }
  return cites;
}

/** Convert a tiny glob (supporting ** and *) to a RegExp anchored full-match. */
export function globToRegExp(glob) {
  let re = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i += 1;
        if (glob[i + 1] === "/") i += 1; // consume trailing slash of **/
      } else {
        re += "[^/]*";
      }
    } else if ("\\^$+?.()|[]{}".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re);
}

/** Secret-detection patterns (kept minimal + high-signal). */
export const SECRET_PATTERNS = [
  { name: "Slack token", re: /xox[pbar]-[A-Za-z0-9-]{10,}/ },
  { name: "AWS access key", re: /AKIA[0-9A-Z]{16}/ },
  {
    name: "private key header",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  },
  { name: "bearer token", re: /bearer\s+[A-Za-z0-9._-]{20,}/i },
  {
    name: "client secret assignment",
    re: /client_secret["'\s:=]+[A-Za-z0-9._-]{16,}/i,
  },
];

/** Text-ish file extensions allowed inside a wiki (others flagged as binaries). */
export const TEXT_EXTS = new Set([
  ".md",
  ".mdx",
  ".json",
  ".jsonl",
  ".txt",
  ".yml",
  ".yaml",
  ".toml",
  ".csv",
  ".tsv",
  ".svg",
  ".gitkeep",
]);

/** Severity-tagged result accumulator. */
export function makeReport() {
  const items = [];
  return {
    add(group, id, status, message, file) {
      items.push({ group, id, status, message, ...(file ? { file } : {}) });
    },
    items,
  };
}
