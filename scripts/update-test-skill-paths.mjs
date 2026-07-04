#!/usr/bin/env node
/**
 * Update test file skill paths after base-plugin skill namespace migration.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const BASE_SKILLS_DIR = path.join(
  REPO_ROOT,
  "plugins",
  "src",
  "base",
  "skills"
);

const baseSkillNames = fs
  .readdirSync(BASE_SKILLS_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .filter(name => name.startsWith("lisa-"))
  .map(name => name.slice("lisa-".length));

/** @param {string} content */
function rewrite(content) {
  let out = content;
  for (const name of baseSkillNames.sort((a, b) => b.length - a.length)) {
    const oldPath = `skills/${name}/`;
    const newPath = `skills/lisa-${name}/`;
    out = out.split(oldPath).join(newPath);
    // readSkill(root, "implement") style
    out = out.replace(
      new RegExp(`readSkill\\(([^,]+),\\s*"${name}"\\)`, "g"),
      `readSkill($1, "lisa-${name}")`
    );
    out = out.replace(new RegExp(`%s/${name}"`, "g"), `%s/lisa-${name}"`);
  }
  return out;
}

/** @param {string} dir */
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p);
      continue;
    }
    if (!/\.(ts|md|sh)$/.test(entry.name)) continue;
    const original = fs.readFileSync(p, "utf8");
    const updated = rewrite(original);
    if (updated !== original) fs.writeFileSync(p, updated);
  }
}

walk(path.join(REPO_ROOT, "tests"));
walk(path.join(REPO_ROOT, "plugins", "src", "base", "hooks"));
console.log("Updated test and hook skill paths.");
