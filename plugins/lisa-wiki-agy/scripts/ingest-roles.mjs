#!/usr/bin/env node
/**
 * ingest-roles.mjs — roles connector. Dependency-free. Ingests the wiki's own staff
 * roster (config.staff[] + wiki/staff/*.md) into a sanitized source note. Emits a
 * proposed cursor; the kernel advances state. Does NOT run any subagent.
 *
 * Usage:
 *   node ingest-roles.mjs [--config <p>] [--wiki <root>] [--source-dir <dir>]
 *     [--state <file>] [--emit-meta <file>]
 */
import fs from "node:fs";
import path from "node:path";
import {
  loadConfig,
  walkFiles,
  writeSanitizedSourceNote,
} from "./_wiki-lib.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i !== -1 ? argv[i + 1] : d;
};
const { config } = loadConfig(opt("--config"));
const wikiRoot = path.resolve(opt("--wiki", config?.wikiRoot ?? "wiki"));
const sourceDir = path.resolve(
  opt("--source-dir", path.join(wikiRoot, "sources", "roles"))
);
const emitMeta = opt("--emit-meta");

const staff = Array.isArray(config?.staff) ? config.staff : [];
const staffDir = path.join(wikiRoot, "staff");
const staffPages = fs.existsSync(staffDir)
  ? walkFiles(staffDir, { ext: ".md" })
  : [];
const date = new Date().toISOString().slice(0, 10);

const rosterRows = staff.length
  ? staff
      .map(
        s =>
          `- **${s.role}** (\`${s.id}\`)${s.expertise ? ` — ${s.expertise}` : ""}${s.owns?.categories ? ` · owns: ${s.owns.categories.join(", ")}` : ""}`
      )
      .join("\n")
  : "_(no roles declared in config.staff[])_";

const notePath = path.join(sourceDir, `${date}-roles.md`);
const note = `---
type: source
created: ${date}
updated: ${date}
related: []
sources: []
source_system: roles
---

# digital staff roster (${date})

Declared roles: ${staff.length}; staff doc pages: ${staffPages.length}.

## Roles
${rosterRows}

## Staff pages
${staffPages.length ? staffPages.map(p => `- \`${path.relative(wikiRoot, p)}\``).join("\n") : "_(none)_"}
`;

const safety = writeSanitizedSourceNote(notePath, note, {
  sourceId: path.relative(process.cwd(), notePath),
  sourceSystem: "roles",
});

const meta = {
  connector: "roles",
  profile: "project",
  ranAt: new Date().toISOString(),
  proposedCursor: {
    roles: staff.length,
    pages: staffPages.length,
    lastIngest: date,
  },
  sourceNotes: [path.relative(process.cwd(), notePath)],
  safety: {
    reviewRequired: safety.reviewRequired,
    findings: safety.findings,
  },
};
if (emitMeta) {
  fs.mkdirSync(path.dirname(emitMeta), { recursive: true });
  fs.writeFileSync(emitMeta, `${JSON.stringify(meta, null, 2)}\n`);
}

console.log(
  `✓ roles connector: ${staff.length} role(s), ${staffPages.length} page(s) → ${path.relative(process.cwd(), notePath)}`
);
