#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const baseSkills = fs
  .readdirSync(path.join(REPO_ROOT, "plugins/src/base/skills"))
  .filter(n => n.startsWith("lisa-"))
  .map(n => n.slice("lisa-".length));

/** @param {string} s */
function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** @param {string} content */
function rewrite(content) {
  let out = content;
  for (const name of [...baseSkills].sort((a, b) => b.length - a.length)) {
    out = out.replace(
      new RegExp(`/lisa:${esc(name)} skill`, "g"),
      `/lisa-${name} skill`
    );
    out = out.replace(
      new RegExp(`name:\\\\s\\*${esc(name)}(?![a-z0-9-])`, "g"),
      `name:\\\\s*lisa-${name}`
    );
    out = out.replace(
      new RegExp(`skills/${esc(name)}/`, "g"),
      `skills/lisa-${name}/`
    );
    out = out.replace(
      new RegExp(`\\["${esc(name)}",`, "g"),
      `["lisa-${name}",`
    );
  }
  return out;
}

/** @param {string} dir */
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith(".ts")) {
      const original = fs.readFileSync(p, "utf8");
      const updated = rewrite(original);
      if (updated !== original) fs.writeFileSync(p, updated);
    }
  }
}

walk(path.join(REPO_ROOT, "tests"));
console.log("Fixed test assertions.");
