#!/usr/bin/env node
/**
 * One-shot migration: namespace Lisa base-plugin skills and commands.
 *
 * - Skills: `implement` → `lisa-implement` (directory + frontmatter `name`)
 * - Commands: nest under `commands/lisa/` for colon-scoped slash surfaces
 * - Skill references: `lisa:foo-bar` → `lisa-foo-bar` (Skill tool / prose)
 * - Command pass-throughs: `/lisa:foo-bar` → `/lisa-foo-bar` in delegator bodies
 *
 * @module scripts/migrate-skill-command-namespace
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const BASE_SRC = path.join(REPO_ROOT, "plugins", "src", "base");
const SKILLS_DIR = path.join(BASE_SRC, "skills");
const COMMANDS_DIR = path.join(BASE_SRC, "commands");
const LISA_COMMANDS_DIR = path.join(COMMANDS_DIR, "lisa");

/** @param {string} name */
function prefixedSkillName(name) {
  return name.startsWith("lisa-") ? name : `lisa-${name}`;
}

/** Rename skill directories and frontmatter `name` fields. */
function migrateSkills() {
  const entries = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();

  for (const oldName of entries) {
    const newName = prefixedSkillName(oldName);
    const oldDir = path.join(SKILLS_DIR, oldName);
    const newDir = path.join(SKILLS_DIR, newName);
    if (oldName !== newName) {
      fs.renameSync(oldDir, newDir);
    }
    const skillMd = path.join(newDir, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;
    let content = fs.readFileSync(skillMd, "utf8");
    content = content.replace(/^name:\s*.+$/m, `name: ${newName}`);
    fs.writeFileSync(skillMd, content);
  }
}

/** Move every command file under `commands/lisa/`, preserving subdirs. */
function migrateCommands() {
  if (!fs.existsSync(COMMANDS_DIR)) return;
  fs.mkdirSync(LISA_COMMANDS_DIR, { recursive: true });

  /** @param {string} dir @param {string} rel */
  function walk(dir, rel = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      const src = path.join(dir, entry.name);
      if (
        entry.name === "lisa" &&
        entry.isDirectory() &&
        dir === COMMANDS_DIR
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(src, entryRel);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      const dest = path.join(LISA_COMMANDS_DIR, entryRel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(src, dest);
    }
  }

  walk(COMMANDS_DIR);

  // Remove empty directories left behind (except commands/ and commands/lisa/).
  /** @param {string} dir */
  function pruneEmpty(dir) {
    if (dir === COMMANDS_DIR || dir === LISA_COMMANDS_DIR) return;
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) pruneEmpty(path.join(dir, entry.name));
    }
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
  pruneEmpty(COMMANDS_DIR);
}

/**
 * @param {string} content
 * @returns {string}
 */
function rewriteSkillReferences(content) {
  let out = content;

  // Command pass-through delegators: `/lisa:foo` skill → `/lisa-foo` skill
  out = out.replace(
    /Use the \/lisa:([a-z][a-z0-9-]*) skill/g,
    (_m, skill) => `Use the /${prefixedSkillName(skill)} skill`
  );

  // Inline skill refs without leading slash: `lisa:foo-bar` → `lisa-foo-bar`
  // Skip slash commands like `/lisa:setup:jira` (multi-colon) and `/lisa:debrief:apply`.
  out = out.replace(
    /(?<![/:])lisa:([a-z][a-z0-9-]*)(?![a-z0-9-:])/g,
    (_m, skill) => prefixedSkillName(skill)
  );

  return out;
}

/** Rewrite skill references across plugins/src/base. */
function rewriteBaseReferences() {
  /** @param {string} dir */
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(md|mdc|sh|json|agent\.md)$/i.test(entry.name)) continue;
      const original = fs.readFileSync(p, "utf8");
      const updated = rewriteSkillReferences(original);
      if (updated !== original) fs.writeFileSync(p, updated);
    }
  }
  walk(BASE_SRC);
}

migrateSkills();
migrateCommands();
rewriteBaseReferences();
console.log("Migrated base plugin skill/command namespace.");
