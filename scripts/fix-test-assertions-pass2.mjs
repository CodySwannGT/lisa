#!/usr/bin/env node
/**
 * Second-pass fixes for test files after skill/command namespace migration.
 */
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
    const prefixed = `lisa-${name}`;

    // Path segments
    out = out.replace(
      new RegExp(`skills/${esc(name)}/`, "g"),
      `skills/${prefixed}/`
    );
    out = out.replace(
      new RegExp(`skills/${esc(name)}",`, "g"),
      `skills/${prefixed}",`
    );
    out = out.replace(
      new RegExp(`readSkill\\([^,]+,\\s*"${esc(name)}"\\)`, "g"),
      match => match.replace(`"${name}"`, `"${prefixed}"`)
    );
    out = out.replace(new RegExp(`"${esc(name)}"`, "g"), `"${prefixed}"`);
    out = out.replace(new RegExp(`'${esc(name)}'`, "g"), `'${prefixed}'`);

    // Skill-tool arming / invocation in tests
    out = out.replace(
      new RegExp(`skill=lisa:${esc(name)}`, "g"),
      `skill=${prefixed}`
    );

    // Content assertions for migrated skill references (not slash commands)
    out = out.replace(
      new RegExp(`(?<!/|/)lisa:${esc(name)}(?![:/a-z])`, "g"),
      prefixed
    );
    out = out.replace(
      new RegExp(`toContain\\("lisa:${esc(name)}"\\)`, "g"),
      `toContain("${prefixed}")`
    );
    out = out.replace(
      new RegExp(`not\\.toContain\\("lisa:${esc(name)}"\\)`, "g"),
      `not.toContain("${prefixed}")`
    );
  }

  // Undo accidental double-prefix from repeated runs
  out = out.replace(/lisa-lisa-/g, "lisa-");

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
console.log("Applied second-pass test fixes.");
