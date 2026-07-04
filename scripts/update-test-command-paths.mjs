#!/usr/bin/env node
/**
 * Update test command paths after base-plugin command namespace migration.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** @param {string} content */
function rewrite(content) {
  let out = content;

  // Base command paths: commands/<file> -> commands/lisa/<file>
  out = out.replace(/commands\/((?!lisa\/)[^"'`\s]+\.md)/g, "commands/lisa/$1");

  // Lifecycle skill folder reads: skills/<lifecycle>/SKILL.md in test arrays
  for (const skill of [
    "debrief",
    "implement",
    "intake",
    "monitor",
    "plan",
    "research",
    "verify",
  ]) {
    out = out.replace(
      new RegExp(`(["\`])${skill}(["\`])`, "g"),
      `$1lisa-${skill}$2`
    );
    out = out.replace(new RegExp(`/%s/${skill}"`, "g"), `/%s/lisa-${skill}"`);
    out = out.replace(
      new RegExp(`skills/${skill}/`, "g"),
      `skills/lisa-${skill}/`
    );
  }

  // Build-intake skills in orchestration tests
  for (const skill of [
    "github-build-intake",
    "jira-build-intake",
    "linear-build-intake",
    "github-prd-intake",
    "prd-backlink",
    "tracker-write",
    "usage-accounting",
  ]) {
    out = out.replace(
      new RegExp(`skills/${skill}/`, "g"),
      `skills/lisa-${skill}/`
    );
  }

  // Command delegator expectations
  out = out.replace(
    /delegates to\s+\n?\s*`\/lisa:doctor`/g,
    "delegates to `/lisa:doctor`"
  );
  out = out.replace(
    /Use the \/lisa:doctor skill/g,
    "Use the /lisa-doctor skill"
  );

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
    if (!/\.(ts|md)$/.test(entry.name)) continue;
    const original = fs.readFileSync(p, "utf8");
    const updated = rewrite(original);
    if (updated !== original) fs.writeFileSync(p, updated);
  }
}

walk(path.join(REPO_ROOT, "tests"));
console.log("Updated test command paths.");
